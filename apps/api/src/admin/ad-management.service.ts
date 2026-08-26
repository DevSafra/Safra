import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type AdvertiserCreateInput,
  type CampaignCreateInput,
  type CampaignUpdateInput,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { assertCanWrite } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** How many days one billing period covers. Used only to walk a campaign's window. */
const PERIOD_DAYS: Record<string, number> = { weekly: 7, monthly: 30, quarterly: 90 };

/**
 * Creating advertisers and campaigns — §9.3's الإعلانات, the write half.
 *
 * ## Separate from `AdvertisingService`, which reads
 *
 * That service answers the registry and moves a campaign between `active` and `paused`. This one
 * brings campaigns into existence and bills them. They have different permissions, different audit
 * obligations and very different failure modes — creating a campaign issues invoices, and pausing
 * one does not.
 *
 * ## An advertiser is not a partner
 *
 * The schema says so at length and it shapes this service: an advertiser sells nothing through
 * SAFRA, has no commission rate and never enters the P-002 verification queue. Creating one is a
 * small administrative act, not an onboarding.
 */
@Injectable()
export class AdManagementService {
  private readonly logger = new Logger(AdManagementService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async createAdvertiser(
    claims: AccessTokenClaims | undefined,
    input: AdvertiserCreateInput,
  ): Promise<{ reference: string }> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    return this.db.transaction(async (tx) => {
      const cityId = await this.cityId(tx as unknown as Database, input.citySlug);

      /* Scoped on the write path: a regional operator creates advertisers in their own cities. */
      assertCanWrite(claims, cityId);

      const made = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO advertisers (name, kind, city_id, contact_email, contact_phone)
        VALUES (${input.name}, ${input.kind}::advertiser_kind, ${cityId}::uuid,
                ${input.contactEmail ?? null}, ${input.contactPhone ?? null})
        RETURNING id, reference
      `);

      const row = made.rows.at(0);

      if (!row) throw new Error('Advertiser insert returned no row.');

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'advertiser.created',
          subjectType: 'advertiser',
          subjectId: row.id,
          /* The name and the kind. The contact details are PII and stay out of the payload. */
          after: { name: input.name, kind: input.kind, city: input.citySlug },
        },
        tx as unknown as Database,
      );

      this.logger.log(`Advertiser ${row.reference} created by ${claims.sub}.`);

      return { reference: row.reference };
    });
  }

  /**
   * Creates a campaign and issues every invoice it will ever be billed for.
   *
   * ## Why the invoices are issued now rather than by a job
   *
   * A campaign's window is fixed at creation, so every period is already known — there is nothing
   * for a scheduled job to discover later, and a job that generates them is a job that can fail
   * silently and leave a month unbilled. Issuing them here means the advertiser can be told what
   * the campaign costs in total before it runs.
   *
   * They are issued `due`. Nothing reaches the ledger until finance marks one paid: a claim is not
   * revenue, and SAFRA may never be paid.
   */
  async createCampaign(
    claims: AccessTokenClaims | undefined,
    input: CampaignCreateInput,
  ): Promise<{ reference: string; invoices: number }> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    return this.db.transaction(async (tx) => {
      const handle = tx as unknown as Database;
      const cityId = await this.cityId(handle, input.citySlug);

      assertCanWrite(claims, cityId);

      const advertiser = await tx.execute<{ id: string }>(sql`
        SELECT id FROM advertisers
        WHERE reference = ${input.advertiserReference} AND deleted_at IS NULL
      `);

      const advertiserId = advertiser.rows.at(0)?.id;

      if (!advertiserId) throw badRequest(ERROR.ADVERTISER_NOT_FOUND);

      const currencyId = input.priceCurrency
        ? await this.currencyId(handle, input.priceCurrency)
        : null;

      const made = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO ad_campaigns
          (advertiser_id, city_id, status, billing_period, price_amount, price_currency_id,
           starts_at, ends_at, headline_ar, headline_en, headline_de, target_url,
           created_by_user_id)
        VALUES (
          ${advertiserId}::uuid, ${cityId}::uuid, 'draft',
          ${input.billingPeriod}::ad_billing_period,
          ${input.priceAmount ?? null}::numeric, ${currencyId}::uuid,
          ${input.startsOn}::date, ${input.endsOn}::date,
          ${input.headlineAr}, ${input.headlineEn}, ${input.headlineDe},
          ${input.targetUrl}, ${claims.sub}::uuid
        )
        RETURNING id, reference
      `);

      const row = made.rows.at(0);

      if (!row) throw new Error('Campaign insert returned no row.');

      const invoices =
        input.priceAmount && currencyId
          ? await this.issueInvoices(handle, row.id, input, currencyId)
          : 0;

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'ad_campaign.created',
          subjectType: 'ad_campaign',
          subjectId: row.id,
          after: {
            advertiser: input.advertiserReference,
            city: input.citySlug,
            startsAt: input.startsOn,
            expiresAt: input.endsOn,
            billingPeriod: input.billingPeriod,
            amount: input.priceAmount ?? null,
            currency: input.priceCurrency ?? null,
            invoices,
          },
        },
        handle,
      );

      this.logger.log(
        `Campaign ${row.reference} created by ${claims.sub} with ${invoices} invoice(s).`,
      );

      return { reference: row.reference, invoices };
    });
  }

  /**
   * One invoice per billing period, at the campaign's price.
   *
   * The last period is TRUNCATED to the campaign's end rather than extended past it: an advertiser
   * running to the 20th is not billed to the 30th, and a period that outlives its own campaign
   * would be a bill for placement nobody could receive.
   *
   * Every period is charged the full `price_amount`. Pro-rating a short final period is a business
   * decision about what a period costs, not an engineering one, and inventing a formula here would
   * make it silently.
   */
  private async issueInvoices(
    tx: Database,
    campaignId: string,
    input: CampaignCreateInput,
    currencyId: string,
  ): Promise<number> {
    const days = PERIOD_DAYS[input.billingPeriod] ?? 30;
    const start = new Date(`${input.startsOn}T00:00:00Z`);
    const end = new Date(`${input.endsOn}T00:00:00Z`);

    let issued = 0;
    let periodStart = start;

    /*
      Bounded, and the bound is not decoration: a weekly campaign spanning a decade would otherwise
      write five hundred rows in one transaction. 120 periods is ten years of monthly or two of
      weekly — past that the window is a data-entry mistake rather than a campaign.
    */
    while (periodStart < end && issued < 120) {
      const next = new Date(periodStart.getTime() + days * 86_400_000);

      /*
        A remainder shorter than a full period is MERGED into this one, not billed as its own.

        1 September to 1 December is 91 days: three whole months and a day. Issuing a fourth
        invoice for that day — at the full monthly price, because a period costs what a period
        costs — is a bill no advertiser would accept and nobody would have meant. The last invoice
        covers 31 days instead.

        Checked against the period AFTER next, so «is there another whole period left» is the
        question rather than «did we overshoot».
      */
      const following = new Date(next.getTime() + days * 86_400_000);
      const periodEnd = next > end || following > end ? end : next;

      await tx.execute(sql`
        INSERT INTO ad_invoices (campaign_id, period_start, period_end, amount, currency_id)
        VALUES (${campaignId}::uuid, ${periodStart.toISOString()}::timestamptz,
                ${periodEnd.toISOString()}::timestamptz,
                ${input.priceAmount}::numeric, ${currencyId}::uuid)
        ON CONFLICT (campaign_id, period_start) DO NOTHING
      `);

      issued += 1;
      periodStart = periodEnd >= end ? end : next;
    }

    return issued;
  }

  /** Editing the creative. The window and the price are not editable — see the contract. */
  async updateCampaign(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: CampaignUpdateInput,
  ): Promise<void> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    await this.db.transaction(async (tx) => {
      const found = await tx.execute<{
        id: string;
        city_id: string;
        headline_ar: string;
        target_url: string;
      }>(sql`
        SELECT id, city_id, headline_ar, target_url FROM ad_campaigns
        WHERE reference = ${reference} AND deleted_at IS NULL
      `);

      const campaign = found.rows.at(0);

      if (!campaign) throw notFound(ERROR.CAMPAIGN_NOT_FOUND);

      assertCanWrite(claims, campaign.city_id);

      const keep = (given: string | undefined, current: string): string =>
        given ?? current;

      await tx.execute(sql`
        UPDATE ad_campaigns SET
          headline_ar = coalesce(${input.headlineAr ?? null}, headline_ar),
          headline_en = coalesce(${input.headlineEn ?? null}, headline_en),
          headline_de = coalesce(${input.headlineDe ?? null}, headline_de),
          target_url  = ${keep(input.targetUrl, campaign.target_url)},
          updated_at  = now()
        WHERE id = ${campaign.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'ad_campaign.updated',
          subjectType: 'ad_campaign',
          subjectId: campaign.id,
          before: { headline: campaign.headline_ar, targetUrl: campaign.target_url },
          after: {
            headline: input.headlineAr ?? campaign.headline_ar,
            targetUrl: keep(input.targetUrl, campaign.target_url),
          },
        },
        tx as unknown as Database,
      );
    });
  }

  private async cityId(tx: Database, slug: string): Promise<string> {
    const rows = await tx.execute<{ id: string }>(sql`
      SELECT id FROM cities WHERE slug = ${slug} AND deleted_at IS NULL
    `);

    const id = rows.rows.at(0)?.id;

    if (!id) throw badRequest(ERROR.GEO_CITY_NOT_FOUND);

    return id;
  }

  private async currencyId(tx: Database, code: string): Promise<string> {
    const rows = await tx.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${code} AND is_active
    `);

    const id = rows.rows.at(0)?.id;

    if (!id) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    return id;
  }
}
