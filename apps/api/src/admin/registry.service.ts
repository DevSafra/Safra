import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, type OffsetPage, type PageQuery, offsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The console's registry reads: partners, properties and customers (design handoff §8).
 *
 * ## Why these three share a service
 *
 * They are the same operation on three tables — a page-numbered, searchable list of an
 * entity the operator then opens. Splitting them into three files would triple the paging
 * and the search-condition assembly for no boundary anybody has to respect; the
 * genuine domain logic (verifying a partner, reviewing a listing) already lives in
 * `ReviewService` and is untouched by this. This service reads; it never decides.
 *
 * Each list deliberately returns LESS than its detail screen: a customer row carries a name
 * and a booking count, never an email or a phone number. Making the registry safe to leave
 * open on a shared screen is worth more than saving the operator a click.
 */
@Injectable()
export class RegistryService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * The row count for a page, over the SAME `FROM … WHERE` the list uses.
   *
   * Sharing one fragment between the list and the count is the whole point, not tidiness: a count
   * built from a separately written predicate drifts from the list it describes, and "2,531 سجل"
   * above a table that runs out at 400 is worse than showing no total.
   *
   * `::text` because a `bigint` reaches the driver as a string.
   */
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
  private pageOffset(query: PageQuery): SQL {
    return sql`OFFSET ${(query.page - 1) * query.limit}`;
  }

  // ── الشركاء ────────────────────────────────────────────────────────────────

  /**
   * The partner registry.
   *
   * Returns `score` and `tier` because the design's table leads with them: a partner's score
   * is the number that decides their search ranking, so the operator needs to see it before
   * opening anybody. `avg_response_minutes`, `cancellation_count` and `complaint_count` are
   * the inputs to it and come along so the detail screen does not need a second round trip.
   */
  async partners(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<PartnerRow>> {
    const conditions: SQL[] = [scopeFilter(query.actor, 'pt.city_id')];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(pt.reference ILIKE ${query.q + '%'}
             OR pt.legal_name ILIKE ${term}
             OR pt.display_name ILIKE ${term})`,
      );
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM partners pt
      LEFT JOIN partner_types ty ON ty.id = pt.partner_type_id
      LEFT JOIN cities ci        ON ci.id = pt.city_id
      ${where}`;

    const [result, total] = await Promise.all([
      this.db.execute<PartnerRowSql>(sql`
      SELECT pt.id, pt.reference, pt.legal_name, pt.display_name,
             pt.score, pt.tier::text AS tier,
             pt.verification::text   AS verification,
             pt.suspended_at,
             pt.avg_response_minutes,
             pt.cancellation_count, pt.complaint_count,
             coalesce(ty.code, '—')  AS partner_type,
             coalesce(ci.name_ar, '—') AS city,
             to_char(pt.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
        ${fromWhere}
        ORDER BY pt.created_at DESC, pt.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        legalName: row.legal_name,
        displayName: row.display_name,
        partnerType: row.partner_type,
        city: row.city,
        score: row.score,
        tier: row.tier,
        verification: row.verification,
        suspended: row.suspended_at !== null,
        avgResponseMinutes: row.avg_response_minutes,
        cancellationCount: row.cancellation_count,
        complaintCount: row.complaint_count,
      })),
      total,
      query,
    );
  }

  // ── العقارات ───────────────────────────────────────────────────────────────

  /** The listing registry. Carries the partner name, as the design's الشريك column needs it. */
  async properties(query: {
    limit: number;
    page: number;
    q?: string | undefined;
    actor?: AccessTokenClaims | undefined;
  }): Promise<OffsetPage<PropertyRow>> {
    const conditions: SQL[] = [scopeFilter(query.actor, 'pr.city_id')];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(pr.reference ILIKE ${query.q + '%'}
             OR pr.name_ar ILIKE ${term}
             OR pr.name_en ILIKE ${term})`,
      );
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM properties pr
      LEFT JOIN property_types ty ON ty.id = pr.property_type_id
      LEFT JOIN cities ci         ON ci.id = pr.city_id
      LEFT JOIN partners pt       ON pt.id = pr.partner_id
      ${where}`;

    const [result, total] = await Promise.all([
      this.db.execute<PropertyRowSql>(sql`
      SELECT pr.id, pr.reference, pr.name_ar, pr.name_en,
             pr.status::text            AS status,
             coalesce(ty.code, '—')     AS property_type,
             coalesce(ci.name_ar, '—')  AS city,
             coalesce(pt.display_name, '—') AS partner,
             pt.reference               AS partner_reference,
             to_char(pr.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
        ${fromWhere}
        ORDER BY pr.created_at DESC, pr.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        propertyType: row.property_type,
        city: row.city,
        partner: row.partner,
        partnerReference: row.partner_reference,
        status: row.status,
      })),
      total,
      query,
    );
  }

  // ── العملاء ────────────────────────────────────────────────────────────────

  /**
   * The customer registry.
   *
   * `is_guest` drives the design's النوع column: a guest holds only the data from one
   * booking and can be upgraded to a full account, which is a different support conversation
   * from a registered customer who has forgotten their password.
   *
   * The booking count and wallet balance are joined rather than counted per row — a
   * correlated subquery here would be an N+1 inside one statement, which is the shape that
   * looks fine at 4,891 customers and stops working at half a million.
   */
  async customers(query: {
    limit: number;
    page: number;
    q?: string | undefined;
  }): Promise<OffsetPage<CustomerRow>> {
    const conditions: SQL[] = [sql`c.deleted_at IS NULL`];

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(c.reference ILIKE ${query.q + '%'} OR c.full_name ILIKE ${term})`,
      );
    }

    const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM customer_profiles c
      LEFT JOIN (
      SELECT customer_profile_id, count(*) AS n, max(created_at) AS last_at
      FROM bookings GROUP BY customer_profile_id
      ) b ON b.customer_profile_id = c.id
      LEFT JOIN wallets w     ON w.customer_profile_id = c.id AND w.deleted_at IS NULL
      LEFT JOIN currencies cur ON cur.id = w.currency_id
      ${where}`;

    const [result, total] = await Promise.all([
      this.db.execute<CustomerRowSql>(sql`
      SELECT c.id, c.reference, c.full_name, c.is_guest,
             coalesce(b.n, 0)::int      AS bookings,
             w.balance::text            AS wallet_balance,
             cur.code                   AS wallet_currency,
             to_char(coalesce(b.last_at, c.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD')
               AS last_activity,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
        ${fromWhere}
        ORDER BY c.created_at DESC, c.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      result.rows.map((row) => ({
        reference: row.reference,
        fullName: row.full_name,
        isGuest: row.is_guest,
        bookings: row.bookings,
        walletBalance: row.wallet_balance,
        walletCurrency: row.wallet_currency,
        lastActivity: row.last_activity,
      })),
      total,
      query,
    );
  }
}

// ── Row shapes ───────────────────────────────────────────────────────────────

interface PartnerRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  legal_name: string;
  display_name: string;
  partner_type: string;
  city: string;
  score: number;
  tier: string;
  verification: string;
  suspended_at: string | null;
  avg_response_minutes: number | null;
  cancellation_count: number;
  complaint_count: number;
  created_at: string;
}

export interface PartnerRow {
  readonly reference: string;
  readonly legalName: string;
  readonly displayName: string;
  readonly partnerType: string;
  readonly city: string;
  readonly score: number;
  readonly tier: string;
  readonly verification: string;
  readonly suspended: boolean;
  readonly avgResponseMinutes: number | null;
  readonly cancellationCount: number;
  readonly complaintCount: number;
}

interface PropertyRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  name_ar: string;
  name_en: string | null;
  property_type: string;
  city: string;
  partner: string;
  partner_reference: string | null;
  status: string;
  created_at: string;
}

export interface PropertyRow {
  readonly reference: string;
  readonly nameAr: string;
  readonly nameEn: string | null;
  readonly propertyType: string;
  readonly city: string;
  readonly partner: string;
  readonly partnerReference: string | null;
  readonly status: string;
}

interface CustomerRowSql extends Record<string, unknown> {
  id: string;
  reference: string;
  full_name: string;
  is_guest: boolean;
  bookings: number;
  wallet_balance: string | null;
  wallet_currency: string | null;
  last_activity: string;
  created_at: string;
}

export interface CustomerRow {
  readonly reference: string;
  readonly fullName: string;
  readonly isGuest: boolean;
  readonly bookings: number;
  readonly walletBalance: string | null;
  readonly walletCurrency: string | null;
  readonly lastActivity: string;
}
