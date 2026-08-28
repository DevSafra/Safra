import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  type OffsetPage,
  type PageQuery,
  offsetPage,
} from '@safra/contracts';

/**
 * How many rows each section of a customer's record shows.
 *
 * A customer with four hundred bookings must not turn the screen into four hundred rows (rule 2).
 * The true total is reported beside each list, so «the last ten» is never mistaken for «all ten».
 */
const RECENT = 10;

import { DATABASE } from '../database/database.module.js';
import { notFound } from '../common/errors/app-error.js';
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
    /*
      Soft-deleted rows are GONE, and the registry has to agree with the detail screen.

      A soft delete is what this platform means by removal (P-003): every read filters it, so the
      row disappears. These two registries did not, so a removed partner or listing stayed in the
      table and its link answered 404 — the console showing a row nobody can open.

      Found on 2026-08-21 by `navigation.spec.ts`, which walks every registry link and reported
      `/properties → /properties/PRO-103501 (404)` after a partner reset soft-deleted a listing.
      The customers registry already had it, which is what makes this an omission rather than a
      decision.
    */
    const conditions: SQL[] = [
      scopeFilter(query.actor, 'pt.city_id'),
      sql`pt.deleted_at IS NULL`,
    ];

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
             -- name_ar, not code: this registry is read on the Arabic-only console, and the
             -- column beside it already localizes. code printed «accommodation» in a النوع
             -- column, which is English a person reads — the one thing the copy rule forbids.
             -- (No backticks in here: this is a JS template literal, and one would close it.)
             coalesce(ty.name_ar, '—') AS partner_type,
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
    /* The same omission as `partners` above, and the one the browser suite actually caught. */
    const conditions: SQL[] = [
      scopeFilter(query.actor, 'pr.city_id'),
      sql`pr.deleted_at IS NULL`,
    ];

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
  /**
   * ONE customer, and everything the platform has recorded about them.
   *
   * ## Why this exists
   *
   * العملاء was a registry with no way in — a support agent who found somebody had to re-search
   * their name in الحجوزات and had nowhere to see the wallet movements, the disputes or what the
   * platform had sent them. Bashar asked for a record «where I can find, see and track all its
   * information and moves on the system» (2026-08-26).
   *
   * ## Contact details are shown, and that is consistent rather than new
   *
   * `booking-detail.service.ts` has sent `cp.email` and `cp.phone` to any reader of a booking since
   * §9.4 was built, so this discloses nothing the console did not already display one click away.
   * It does NOT weaken EC-010: that flow verifies an INBOUND CALLER before booking details are read
   * out, which is a different question from what a member of staff sees on a record they navigated
   * to. Both are gated on `customer.read`.
   *
   * ## Every list is bounded, and says so
   *
   * A customer with four hundred bookings must not turn this into four hundred rows (rule 2). Each
   * section takes the most recent `RECENT` and reports the true total beside it, so a reader can
   * tell «the last ten» from «all ten». Five small indexed queries rather than one join: joining
   * six one-to-many relations in a single statement multiplies the rows and then needs them
   * de-duplicated in code.
   */
  async customerDetail(reference: string) {
    const profile = await this.db.execute<{
      id: string;
      reference: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      is_guest: boolean;
      created_at: string;
      account_status: string | null;
      locale: string | null;
      wallet_balance: string | null;
      wallet_currency: string | null;
    }>(sql`
      SELECT c.id, c.reference, c.full_name, c.email, c.phone, c.is_guest,
             to_char(c.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at,
             u.status::text AS account_status,
             u.preferred_locale AS locale,
             w.balance::text AS wallet_balance,
             cur.code AS wallet_currency
      FROM customer_profiles c
      LEFT JOIN users u       ON u.id = c.user_id
      LEFT JOIN wallets w     ON w.customer_profile_id = c.id AND w.deleted_at IS NULL
      LEFT JOIN currencies cur ON cur.id = w.currency_id
      WHERE c.reference = ${reference} AND c.deleted_at IS NULL
      LIMIT 1
    `);

    const customer = profile.rows[0];

    if (!customer) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    const id = customer.id;

    const [bookings, wallet, reviews, disputes, notices] = await Promise.all([
      this.db.execute<{
        reference: string;
        status: string;
        check_in: string;
        total_amount: string;
        currency_code: string;
        property: string | null;
        created_at: string;
        total: string;
      }>(sql`
        SELECT b.reference, b.status::text AS status, b.check_in::text,
               b.total_amount::text AS total_amount, cur.code AS currency_code,
               coalesce(pr.name_ar, pr.name_en) AS property,
               b.created_at::text,
               count(*) OVER ()::text AS total
        FROM bookings b
        JOIN currencies cur ON cur.id = b.currency_id
        JOIN properties pr  ON pr.id = b.property_id
        WHERE b.customer_profile_id = ${id} AND b.deleted_at IS NULL
        ORDER BY b.created_at DESC
        LIMIT ${RECENT}
      `),
      this.db.execute<{
        direction: string;
        reason: string;
        amount: string;
        currency_code: string;
        created_at: string;
        total: string;
      }>(sql`
        SELECT t.direction::text AS direction, t.reason::text AS reason,
               t.amount::text AS amount, cur.code AS currency_code,
               t.created_at::text, count(*) OVER ()::text AS total
        FROM wallet_transactions t
        JOIN wallets w      ON w.id = t.wallet_id
        JOIN currencies cur ON cur.id = w.currency_id
        WHERE w.customer_profile_id = ${id}
        ORDER BY t.created_at DESC
        LIMIT ${RECENT}
      `),
      this.db.execute<{
        rating: number;
        status: string;
        created_at: string;
        property: string | null;
        total: string;
      }>(sql`
        SELECT r.rating, r.status::text AS status, r.created_at::text,
               coalesce(pr.name_ar, pr.name_en) AS property,
               count(*) OVER ()::text AS total
        FROM reviews r
        JOIN properties pr ON pr.id = r.property_id
        WHERE r.customer_profile_id = ${id}
        ORDER BY r.created_at DESC
        LIMIT ${RECENT}
      `),
      this.db.execute<{
        reference: string;
        kind: string;
        status: string;
        created_at: string;
        booking_reference: string | null;
        total: string;
      }>(sql`
        SELECT d.reference, d.kind::text AS kind, d.status::text AS status,
               d.created_at::text, b.reference AS booking_reference,
               count(*) OVER ()::text AS total
        FROM disputes d
        LEFT JOIN bookings b ON b.id = d.booking_id
        WHERE d.customer_profile_id = ${id}
        ORDER BY d.created_at DESC
        LIMIT ${RECENT}
      `),
      /*
        What the platform SENT them — the half of «moves on the system» a customer never asks about
        and support always needs. The row carries no recipient, subject or body by design, so this
        is the template and its state, never the message.
      */
      this.db.execute<{
        template_key: string;
        channel: string;
        status: string;
        created_at: string;
        total: string;
      }>(sql`
        SELECT n.template_key, n.channel::text AS channel, n.status::text AS status,
               n.created_at::text, count(*) OVER ()::text AS total
        FROM notifications n
        WHERE n.customer_profile_id = ${id}
        ORDER BY n.created_at DESC
        LIMIT ${RECENT}
      `),
    ]);

    /** The window function reports the unlimited total on every row; absent when there are none. */
    const totalOf = (rows: { total: string }[]): number => Number(rows[0]?.total ?? 0);

    return {
      reference: customer.reference,
      fullName: customer.full_name,
      email: customer.email,
      phone: customer.phone,
      isGuest: customer.is_guest,
      createdAt: customer.created_at,
      accountStatus: customer.account_status,
      locale: customer.locale,
      wallet:
        customer.wallet_balance === null
          ? null
          : { balance: customer.wallet_balance, currency: customer.wallet_currency },
      bookings: {
        total: totalOf(bookings.rows),
        items: bookings.rows.map((row) => ({
          reference: row.reference,
          status: row.status,
          checkIn: row.check_in,
          amount: row.total_amount,
          currency: row.currency_code,
          property: row.property,
        })),
      },
      wallets: {
        total: totalOf(wallet.rows),
        items: wallet.rows.map((row) => ({
          direction: row.direction,
          reason: row.reason,
          amount: row.amount,
          currency: row.currency_code,
          at: row.created_at,
        })),
      },
      reviews: {
        total: totalOf(reviews.rows),
        items: reviews.rows.map((row) => ({
          rating: row.rating,
          status: row.status,
          property: row.property,
          at: row.created_at,
        })),
      },
      disputes: {
        total: totalOf(disputes.rows),
        items: disputes.rows.map((row) => ({
          reference: row.reference,
          kind: row.kind,
          status: row.status,
          bookingReference: row.booking_reference,
          at: row.created_at,
        })),
      },
      notifications: {
        total: totalOf(notices.rows),
        items: notices.rows.map((row) => ({
          templateKey: row.template_key,
          channel: row.channel,
          status: row.status,
          at: row.created_at,
        })),
      },
    };
  }

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
        /*
          Already SELECTed and typed, and never mapped out — so the registry ordered by it and
          could not say which rows it had put at the top. «New since I last looked» needs the
          row's own age, and `lastActivity` is a different fact: a customer who booked this
          morning has recent activity and is not new.
        */
        createdAt: row.created_at,
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
  /** When the profile itself was created — what «new» is measured against. */
  readonly createdAt: string;
}
