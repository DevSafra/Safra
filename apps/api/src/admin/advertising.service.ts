import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';

import type { Database } from '@safra/db';
import { COUNT_CAP, ERROR, type OffsetPage, offsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import { badRequest, notFound } from '../common/errors/app-error.js';

export const campaignStatusSchema = z
  .object({
    /**
     * `active` or `paused` only.
     *
     * `expired` is reached by the calendar, not by a person — setting it by hand would let a
     * campaign be marked expired while its window is still open, and the advertiser has paid for
     * that window. `draft` is where a campaign starts and is not somewhere to go back to.
     */
    status: z.enum(['active', 'paused']),
    reason: z.string().trim().max(500).optional(),
  })
  .strict();

export type CampaignStatusInput = z.infer<typeof campaignStatusSchema>;

export interface CampaignRow {
  readonly reference: string;
  readonly advertiser: string;
  readonly advertiserKind: string;
  readonly city: string;
  readonly status: string;
  readonly billingPeriod: string;
  readonly priceAmount: string | null;
  readonly priceCurrency: string | null;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly impressions: number;
  readonly clicks: number;
  /** Whole days until `endsAt`; negative once past. Drives "ينتهي بعد 4 أيام". */
  readonly daysRemaining: number;
}

export interface AdCounters {
  readonly active: number;
  readonly paused: number;
  readonly endingWithinWeek: number;
  readonly impressions30d: number;
  readonly clicks30d: number;
}

/**
 * الإعلانات — targeted advertising (design handoff §8).
 *
 * ## The rule that shapes what this service does NOT expose
 *
 * "موسومة دائماً «إعلان شريك» ولا تُخلط بترتيب البحث الطبيعي." There is no ranking, boosting or
 * priority anywhere in this service or its table, because the moment one exists somebody will use
 * it to lift a paid listing in search results, and the promise that ads never mix with organic
 * ranking stops being true. Placement is by city and by moment — after a booking is confirmed —
 * and that is all.
 *
 * ## Status changes are audited
 *
 * Pausing a campaign an advertiser has paid for is a commercial act. Who did it and why is
 * recorded, which is also the answer when the advertiser asks why their ad stopped.
 */
@Injectable()
export class AdvertisingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** The row count for a page, capped, over the same `FROM … WHERE` the list uses. */
  private async countOf(fromWhere: SQL): Promise<number> {
    /*
      Counted over a LIMIT-ed subquery, so the database stops reading at COUNT_CAP + 1 rows
      instead of scanning the whole matching set. An uncapped count(*) is unbounded work on
      every page view of an ever-growing table — which rule 2 forbids — and nobody reading a
      console table needs to know the exact size of a set they will never page through.
    */
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  /** `OFFSET` for a 1-based page. */
  private pageOffset(query: { page: number; limit: number }): SQL {
    return sql`OFFSET ${(query.page - 1) * query.limit}`;
  }

  async counters(actor?: AccessTokenClaims): Promise<AdCounters> {
    const result = await this.db.execute<{
      active: string;
      paused: string;
      ending_within_week: string;
      impressions_30d: string;
      clicks_30d: string;
    }>(sql`
      SELECT
        count(*) FILTER (WHERE c.status = 'active')::text  AS active,
        count(*) FILTER (WHERE c.status = 'paused')::text  AS paused,
        count(*) FILTER (WHERE c.status = 'active'
                           AND c.ends_at <= now() + interval '7 days')::text
          AS ending_within_week,
        -- Lifetime counters restricted to campaigns that RAN in the window. Impressions are a
        -- running total rather than an event log, so this is "campaigns active recently", which
        -- is the honest reading and is labelled as such on the screen.
        coalesce(sum(c.impressions) FILTER (WHERE c.ends_at >= current_date - interval '30 days'), 0)::text
          AS impressions_30d,
        coalesce(sum(c.clicks) FILTER (WHERE c.ends_at >= current_date - interval '30 days'), 0)::text
          AS clicks_30d
      FROM ad_campaigns c
      WHERE c.deleted_at IS NULL AND ${scopeFilter(actor, 'c.city_id')}
    `);

    const row = result.rows[0];

    return {
      active: Number(row?.active ?? 0),
      paused: Number(row?.paused ?? 0),
      endingWithinWeek: Number(row?.ending_within_week ?? 0),
      impressions30d: Number(row?.impressions_30d ?? 0),
      clicks30d: Number(row?.clicks_30d ?? 0),
    };
  }

  async list(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<CampaignRow>> {
    const conditions: SQL[] = [
      sql`c.deleted_at IS NULL`,
      scopeFilter(query.actor, 'c.city_id'),
    ];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(c.reference ILIKE ${query.q + '%'}
             OR a.name ILIKE ${term}
             OR ci.name_ar ILIKE ${term})`,
      );
    }

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM ad_campaigns c
      JOIN advertisers a  ON a.id = c.advertiser_id
      LEFT JOIN cities ci ON ci.id = c.city_id
      LEFT JOIN currencies cur ON cur.id = c.price_currency_id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<CampaignRowSql>(sql`
      SELECT c.id, c.reference,
             a.name              AS advertiser,
             a.kind::text         AS advertiser_kind,
             ci.name_ar           AS city,
             c.status::text       AS status,
             c.billing_period::text AS billing_period,
             c.price_amount::text AS price_amount,
             cur.code             AS price_currency,
             -- Cast to text and coerce in TypeScript. A bigint reaches the driver as a STRING, to
             -- avoid silent precision loss, so selecting it bare yields "2860" where the response
             -- schema expects 2860 -- which failed the parse and blanked the whole screen.
             -- Number() is exact to 2^53, nine orders of magnitude beyond any impression count.
             -- (No backticks in a comment inside a sql template: one would end the string.)
             c.impressions::text AS impressions,
             c.clicks::text      AS clicks,
             to_char(c.starts_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS starts_at,
             to_char(c.ends_at   AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS ends_at,
             floor(extract(epoch FROM (c.ends_at - now())) / 86400)::int AS days_remaining,
             c.created_at
      ${fromWhere}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        advertiser: row.advertiser,
        advertiserKind: row.advertiser_kind,
        city: row.city ?? '—',
        status: row.status,
        billingPeriod: row.billing_period,
        priceAmount: row.price_amount,
        priceCurrency: row.price_currency,
        startsAt: row.starts_at,
        endsAt: row.ends_at,
        impressions: Number(row.impressions),
        clicks: Number(row.clicks),
        daysRemaining: row.days_remaining,
      })),
      total,
      query,
    );
  }

  /** Pauses or resumes a campaign. Audited, because the advertiser paid for the window. */
  async setStatus(
    actor: AccessTokenClaims | undefined,
    reference: string,
    input: CampaignStatusInput,
  ): Promise<CampaignRow> {
    const found = await this.db.execute<{
      id: string;
      status: string;
      city_id: string | null;
    }>(sql`
      SELECT id, status::text AS status, city_id FROM ad_campaigns
      WHERE reference = ${reference} AND deleted_at IS NULL
      LIMIT 1
    `);

    const campaign = found.rows[0];

    if (!campaign) throw notFound(ERROR.CAMPAIGN_NOT_FOUND);

    // Scope on the write path: a caller can name any reference, so the list is not the gate.
    assertCanWrite(actor, campaign.city_id);

    /*
      An expired campaign cannot be reactivated by flipping the status: its paid window has
      closed, and resuming it would deliver impressions nobody bought. A new campaign is the
      correct answer, and the refusal says so rather than appearing to work.
    */
    if (campaign.status === 'expired') {
      throw badRequest(ERROR.CAMPAIGN_EXPIRED);
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE ad_campaigns SET status = ${input.status}::ad_status
        WHERE id = ${campaign.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: actor?.sub,
          actorRole: actor?.role,
          action: `ad_campaign.${input.status === 'paused' ? 'paused' : 'resumed'}`,
          subjectType: 'ad_campaign',
          subjectId: campaign.id,
          before: { status: campaign.status },
          after: { status: input.status },
          reason: input.reason ?? null,
        },
        tx as unknown as Database,
      );
    });

    const reread = await this.list({ limit: 1, page: 1, q: reference });
    const view = reread.items[0];

    if (!view) throw notFound(ERROR.CAMPAIGN_NOT_FOUND);

    return view;
  }
}

interface CampaignRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  advertiser: string;
  advertiser_kind: string;
  city: string | null;
  status: string;
  billing_period: string;
  price_amount: string | null;
  price_currency: string | null;
  impressions: string;
  clicks: string;
  starts_at: string;
  ends_at: string;
  days_remaining: number;
  created_at: string;
}
