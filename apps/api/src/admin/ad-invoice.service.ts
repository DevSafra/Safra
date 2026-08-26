import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, ERROR, offsetPage, type OffsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export interface AdInvoiceRow {
  readonly reference: string;
  readonly campaign: string;
  readonly advertiser: string;
  readonly city: string;
  readonly periodStart: string;
  readonly periodEnd: string;
  readonly amount: string;
  readonly currency: string;
  readonly status: string;
  readonly paidAt: string | null;
}

/**
 * What advertisers owe, and recording that they paid — §9.3's الإعلانات, the money half.
 *
 * ## An invoice becomes revenue when it is PAID, not when it is issued
 *
 * A `due` invoice is a claim: SAFRA has billed somebody and may never be paid. Posting it to the
 * ledger at issue would put revenue in the books for a campaign nobody funded, and every figure
 * derived from the ledger would carry it. The pair is posted in the same transaction as the status
 * change, so the books and the invoice cannot disagree.
 *
 * ## `ad_payment` ↔ `ad_revenue`, and not `customer_payment`
 *
 * An advertiser is not a customer and sells nothing through the platform. الدفع's «حُصّل اليوم»
 * counter filters on `customer_payment`; folding ad money into it would overstate booking revenue
 * with money that has nothing to do with a stay.
 */
@Injectable()
export class AdInvoiceService {
  private readonly logger = new Logger(AdInvoiceService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
  ) {}

  /** The row count for a page, capped, over the same `FROM … WHERE` the list uses. */
  private async countOf(fromWhere: SQL): Promise<number> {
    const rows = await this.db.execute<{ total: string }>(sql`
      SELECT count(*)::text AS total FROM (
        SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}
      ) AS capped
    `);

    return Number(rows.rows[0]?.total ?? 0);
  }

  async list(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<AdInvoiceRow>> {
    const conditions: SQL[] = [
      sql`i.deleted_at IS NULL`,
      /* Scoped by the CAMPAIGN's city: a regional operator sees their own region's billing. */
      scopeFilter(query.actor, 'c.city_id'),
    ];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(sql`(i.reference ILIKE ${term} OR a.name ILIKE ${term}
                           OR c.reference ILIKE ${term})`);
    }

    /* One fragment, used by both queries below — see `countOf`. */
    const fromWhere = sql`
      FROM ad_invoices i
      JOIN ad_campaigns c ON c.id = i.campaign_id
      JOIN advertisers a  ON a.id = c.advertiser_id
      JOIN cities ci      ON ci.id = c.city_id
      JOIN currencies cur ON cur.id = i.currency_id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [result, total] = await Promise.all([
      this.db.execute<{
        reference: string;
        campaign: string;
        advertiser: string;
        city: string;
        period_start: string;
        period_end: string;
        amount: string;
        currency: string;
        status: string;
        paid_at: string | null;
      }>(sql`
        SELECT i.reference, c.reference AS campaign, a.name AS advertiser, ci.name_ar AS city,
               to_char(i.period_start AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS period_start,
               to_char(i.period_end   AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS period_end,
               i.amount::text AS amount, cur.code AS currency,
               i.status::text AS status,
               to_char(i.paid_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS paid_at
        ${fromWhere}
        ORDER BY i.period_start DESC, i.id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        campaign: row.campaign,
        advertiser: row.advertiser,
        city: row.city,
        periodStart: row.period_start,
        periodEnd: row.period_end,
        amount: row.amount,
        currency: row.currency,
        status: row.status,
        paidAt: row.paid_at,
      })),
      total,
      query,
    );
  }

  /**
   * Records that an advertiser paid, and books the revenue.
   *
   * Only a `due` invoice can be paid: paying one twice would post the revenue twice, and voiding
   * then paying is a different decision that should be made deliberately rather than by a retry.
   * The row is locked so two finance officers clicking together cannot both succeed.
   */
  async markPaid(
    claims: AccessTokenClaims | undefined,
    reference: string,
    note: string,
  ): Promise<void> {
    if (!claims?.sub) throw badRequest(ERROR.INTERNAL_ACTOR_REQUIRED);

    await this.db.transaction(async (tx) => {
      const found = await tx.execute<{
        id: string;
        campaign_id: string;
        city_id: string;
        status: string;
        amount: string;
        currency_id: string;
        currency_code: string;
        campaign_reference: string;
      }>(sql`
        SELECT i.id, i.campaign_id, c.city_id, i.status::text AS status,
               i.amount::text AS amount, i.currency_id, cur.code AS currency_code,
               c.reference AS campaign_reference
        FROM ad_invoices i
        JOIN ad_campaigns c ON c.id = i.campaign_id
        JOIN currencies cur ON cur.id = i.currency_id
        WHERE i.reference = ${reference} AND i.deleted_at IS NULL
        FOR UPDATE OF i
      `);

      const invoice = found.rows.at(0);

      if (!invoice) throw notFound(ERROR.AD_INVOICE_NOT_FOUND);

      /* Scope on the write path: a caller can name any reference, so the list is not the gate. */
      assertCanWrite(claims, invoice.city_id);

      if (invoice.status !== 'due') throw badRequest(ERROR.AD_INVOICE_NOT_DUE);

      await tx.execute(sql`
        UPDATE ad_invoices
        SET status = 'paid', paid_at = now(), paid_by_user_id = ${claims.sub}::uuid,
            updated_at = now()
        WHERE id = ${invoice.id}::uuid
      `);

      /*
        The books, in the same transaction.

        `ad_payment` is the money arriving; `ad_revenue` is what SAFRA earned. Two legs, balanced,
        in the invoice's own currency — which needs a rate to SYP like every other ledger entry, so
        an invoice in a currency with no rate REFUSES rather than being booked at parity.
      */
      await this.ledger.post(
        tx as unknown as Database,
        [
          {
            account: 'ad_payment',
            direction: 'debit',
            amount: invoice.amount,
            description: `Advertising payment for ${invoice.campaign_reference}`,
          },
          {
            account: 'ad_revenue',
            direction: 'credit',
            amount: invoice.amount,
            description: `Advertising revenue for ${invoice.campaign_reference}`,
          },
        ],
        {
          currencyId: invoice.currency_id,
          fxRateToSyp: await this.fx.rateToSyp(invoice.currency_code),
          createdByUserId: claims.sub,
        },
      );

      await this.audit.record(
        {
          actorUserId: claims.sub,
          actorRole: claims.role,
          action: 'ad_invoice.paid',
          subjectType: 'ad_invoice',
          subjectId: invoice.id,
          before: { status: 'due' },
          after: {
            status: 'paid',
            amount: invoice.amount,
            currency: invoice.currency_code,
            campaign: invoice.campaign_reference,
          },
          reason: note,
        },
        tx as unknown as Database,
      );

      this.logger.log(
        `Ad invoice ${reference} marked paid by ${claims.sub} ` +
          `(${invoice.amount} ${invoice.currency_code}).`,
      );
    });
  }
}
