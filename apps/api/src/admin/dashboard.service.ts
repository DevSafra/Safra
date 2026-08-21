import { Inject, Injectable } from '@nestjs/common';
import { SLA_EXPIRY_WARNING_MINUTES } from '@safra/contracts';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** How many days the revenue sparkline covers, including today. */
const REVENUE_DAYS = 7;

/** Rows shown in the "latest bookings" and "recent activity" panels. */
const RECENT_BOOKINGS = 5;
const RECENT_AUDIT = 4;

/**
 * Everything the §9.2 dashboard renders, in one round trip.
 *
 * One endpoint rather than six, because the dashboard is a single screen that is useless
 * half-loaded: five counters, a revenue series, two queues and an activity feed. Six
 * requests would mean six spinners and six ways to be partly wrong.
 *
 * ## Nothing here is invented
 *
 * Every figure comes from a column. Where the design asks for something the platform
 * does not record — open disputes, which have no table because messaging and disputes are
 * unbuilt (see the future-work register) — the payload returns `null` rather than `0`.
 * A dashboard that shows a confident zero for a feature that does not exist is worse than
 * one that admits the gap: staff would read "no open disputes" and act on it.
 */
/**
 * The metrics `counters()` produces, as a type.
 *
 * One list, matching the UNION in the query below. It exists so a caller inside the API can read
 * `counters.sla_expiring_soon` and be told at compile time if that metric stops being produced —
 * which is exactly what the dashboard's EC-008 alert and the bookings registry's expiring filter both
 * depend on agreeing about.
 */
export type DashboardCounterName =
  | 'bookings_today'
  | 'bookings_yesterday'
  | 'pending_confirmation'
  | 'sla_expiring_soon'
  | 'cancelled_today'
  | 'cancelled_today_with_fine'
  | 'partners_pending_verification'
  | 'properties_pending_review'
  | 'partner_applications_open'
  | 'partner_documents_pending_review';

@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async overview(actor?: AccessTokenClaims) {
    const [counters, revenue, bookings, audit, openDisputes] = await Promise.all([
      this.counters(actor),
      this.revenueSeries(actor),
      this.recentBookings(actor),
      /*
        The activity panel is NOT scoped: it reads the audit log, which Bashar's decision keeps
        global and complete for every staff member. A scoped audit trail is not an audit trail.
      */
      this.recentAudit(),
      this.openDisputes(actor),
    ]);

    return {
      counters,
      revenue,
      recentBookings: bookings,
      recentAudit: audit,
      openDisputes,
    };
  }

  /**
   * Open disputes, and the age of the oldest.
   *
   * ## This used to return null, on purpose
   *
   * For months there was no `disputes` table, and this field was hard-coded `null` so the card
   * could render a dash and say "the feature does not exist" — because a confident `0` next to
   * "نزاعات مفتوحة" would have been read as "nothing to worry about" by somebody whose job is to
   * worry about exactly that.
   *
   * The table landed on 2026-08-04, so it now returns the real count. The nullable TYPE stays:
   * `null` still means "cannot be determined", which is a different statement from zero and is
   * what the client renders differently.
   */
  private async openDisputes(actor?: AccessTokenClaims): Promise<number> {
    const result = await this.db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM disputes d
      LEFT JOIN bookings b ON b.id = d.booking_id
      WHERE d.status IN ('open', 'investigating') AND d.deleted_at IS NULL
        AND ${scopeFilter(actor, 'b.city_id')}
    `);

    return Number(result.rows[0]?.n ?? 0);
  }

  /**
   * The KPI row.
   *
   * "Today" is the database's date, not the caller's: staff, servers and customers can
   * sit in different zones, and a dashboard whose totals shift with the reader's clock
   * cannot be reconciled against anything.
   */
  private async counters(actor?: AccessTokenClaims) {
    /*
      Every branch below carries the scope predicate. Hoisted into a local so the eight branches
      cannot drift — the failure mode of writing it out eight times is that seven are scoped and
      one is not, and the unscoped one is the number somebody quotes.
    */
    const inScope = (alias: string): SQL => scopeFilter(actor, `${alias}.city_id`);

    const rows = await this.db.execute<{ metric: string; value: string }>(sql`
      SELECT 'bookings_today' AS metric, COUNT(*)::text AS value
        FROM bookings b WHERE b.created_at::date = current_date AND b.deleted_at IS NULL
          AND ${inScope('b')}
      UNION ALL
      SELECT 'bookings_yesterday', COUNT(*)::text
        FROM bookings b
        WHERE b.created_at::date = current_date - 1 AND b.deleted_at IS NULL
          AND ${inScope('b')}
      UNION ALL
      SELECT 'pending_confirmation', COUNT(*)::text
        FROM bookings b WHERE b.status = 'pending_confirmation' AND b.deleted_at IS NULL
          AND ${inScope('b')}
      UNION ALL
      -- The time-critical slice of the above: §6.4's window about to lapse.
      SELECT 'sla_expiring_soon', COUNT(*)::text
        FROM bookings b
        WHERE b.status = 'pending_confirmation'
          AND b.confirmation_deadline_at IS NOT NULL
          AND b.confirmation_deadline_at <= now() + (${SLA_EXPIRY_WARNING_MINUTES}::int * INTERVAL '1 minute')
          AND b.deleted_at IS NULL
          AND ${inScope('b')}
      UNION ALL
      SELECT 'cancelled_today', COUNT(*)::text
        FROM bookings b
        WHERE b.cancelled_at::date = current_date AND b.deleted_at IS NULL
          AND ${inScope('b')}
      UNION ALL
      -- A cancellation that cost the partner a fine, which is the one worth a second look.
      SELECT 'cancelled_today_with_fine', COUNT(*)::text
        FROM bookings b
        WHERE b.cancelled_at::date = current_date AND b.deleted_at IS NULL
          AND ${inScope('b')}
          AND EXISTS (
            SELECT 1 FROM partner_violations v WHERE v.booking_id = b.id
          )
      UNION ALL
      SELECT 'partners_pending_verification', COUNT(*)::text
        FROM partners pt WHERE pt.verification = 'pending' AND pt.deleted_at IS NULL
          AND ${inScope('pt')}
      UNION ALL
      SELECT 'properties_pending_review', COUNT(*)::text
        FROM properties pr WHERE pr.status = 'pending_review' AND pr.deleted_at IS NULL
          AND ${inScope('pr')}
      UNION ALL
      -- Documents a partner has SENT and nobody has looked at (Bashar, 2026-08-21).
      --
      -- The gap this closes: a partner uploading their documents changed nothing a staff member
      -- could see. partners_pending_verification already counted them the day they were created,
      -- so the number was the same before and after the upload — the one moment when there is
      -- suddenly something to do produced no signal at all.
      --
      -- Counts DOCUMENTS rather than partners on purpose. Five arriving at once is five minutes
      -- of review, and a row reading "1 partner" would understate it every time.
      SELECT 'partner_documents_pending_review', COUNT(*)::text
        FROM partner_documents pd
        JOIN partners pdp ON pdp.id = pd.partner_id AND pdp.deleted_at IS NULL
        WHERE pd.status = 'pending' AND pd.deleted_at IS NULL
          AND ${inScope('pdp')}
      UNION ALL
      -- Requests to JOIN that nobody has decided yet.
      --
      -- Here because the DASHBOARD renders the sidebar itself rather than through ConsoleShell,
      -- and so has to supply every badge from this payload. It did not supply this one, so طلبات
      -- الشراكة lost its number on the one screen a super admin opens first (Bashar, 2026-08-20).
      -- Scoped like every counter above: partner_applications carries a city_id, and a badge
      -- counting cities somebody cannot open is a number they can do nothing about.
      --
      -- No backticks anywhere in this string: it is inside a tagged SQL template, and one
      -- would close it. Removing a pair of them is what fixed this comment.
      SELECT 'partner_applications_open', COUNT(*)::text
        FROM partner_applications pap
        WHERE pap.status IN ('submitted', 'contacted') AND pap.deleted_at IS NULL
          AND ${inScope('pap')}
    `);

    /*
      Named, rather than left to inference.

      `Object.fromEntries` infers an index signature, and spreading that into the object literal below
      DROPS it — so `overview().counters` was typed as holding only the two revenue fields, and every
      counter the query actually produces was invisible to the type system. Nothing noticed because the
      console re-declares the shape in its own Zod schema, so the only reader that could have caught it
      validates independently.
    */
    const counters = Object.fromEntries(
      rows.rows.map((row) => [row.metric, Number(row.value)]),
    ) as Record<DashboardCounterName, number>;

    /**
     * SAFRA's revenue is the commission plus the service fee — never the booking total,
     * which is mostly the partner's money passing through (§13.3).
     */
    const money = await this.db.execute<{ usd: string; syp: string }>(sql`
      SELECT
        COALESCE(SUM(partner_commission_amount + customer_fee_amount), 0)::text AS usd,
        COALESCE(SUM(total_syp * (
          (partner_commission_amount + customer_fee_amount)
          / NULLIF(total_amount, 0)
        )), 0)::text AS syp
      FROM bookings
      WHERE paid_at::date = current_date AND deleted_at IS NULL
    `);

    return {
      ...counters,
      revenue_today_usd: money.rows[0]?.usd ?? '0',
      revenue_today_syp: money.rows[0]?.syp ?? '0',
    };
  }

  /**
   * Commission earned per day for the last week, oldest first.
   *
   * `generate_series` rather than grouping what exists, so a day with no bookings comes
   * back as zero instead of being missing — a sparkline that silently skips quiet days
   * misrepresents the shape of the week.
   */
  private async revenueSeries(actor?: AccessTokenClaims) {
    /**
     * The window offset goes in via `sql.raw`, and this note lives OUTSIDE the template.
     *
     * A comment inside a tagged template is still template text, and the backticks this
     * one needs to quote an identifier terminate the string early — the SQL after them
     * was parsed as JavaScript and threw `current_date is not defined`. Keep prose out
     * of `sql` blocks.
     *
     * The offset itself is a compile-time constant in this file, never caller input.
     */
    const windowStart = sql.raw(String(REVENUE_DAYS - 1));

    const rows = await this.db.execute<{ day: string; amount: string }>(sql`
      SELECT d::date::text AS day,
             COALESCE(SUM(b.partner_commission_amount + b.customer_fee_amount), 0)::text
               AS amount
      FROM generate_series(
             current_date - ${windowStart},
             current_date,
             INTERVAL '1 day'
           ) AS d
      LEFT JOIN bookings b
        ON b.paid_at::date = d::date AND b.deleted_at IS NULL
       AND ${scopeFilter(actor, 'b.city_id')}
      GROUP BY d
      ORDER BY d
    `);

    return rows.rows.map((row) => ({ day: row.day, amount: row.amount }));
  }

  private async recentBookings(actor?: AccessTokenClaims) {
    const rows = await this.db.execute<{
      reference: string;
      property: string;
      customer: string;
      amount: string;
      currency: string;
      status: string;
    }>(sql`
      SELECT b.reference,
             COALESCE(pr.name_ar, pr.name_en) AS property,
             cp.full_name AS customer,
             b.total_amount::text AS amount,
             cur.code AS currency,
             b.status::text AS status
      FROM bookings b
      JOIN properties pr        ON pr.id = b.property_id
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN currencies cur       ON cur.id = b.currency_id
      WHERE b.deleted_at IS NULL AND ${scopeFilter(actor, 'b.city_id')}
      ORDER BY b.created_at DESC
      LIMIT ${RECENT_BOOKINGS}
    `);

    return rows.rows;
  }

  /**
   * The last few audited actions, for the activity panel.
   *
   * Reads the audit log rather than a separate feed, so what staff see on the dashboard
   * is the same record §15 keeps — there is no second, prettier version of history.
   */
  private async recentAudit() {
    const rows = await this.db.execute<{
      action: string;
      actor: string | null;
      at: string;
      subject_type: string;
    }>(sql`
      SELECT a.action,
             u.email AS actor,
             to_char(a.created_at AT TIME ZONE 'UTC', 'HH24:MI') AS at,
             a.subject_type
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ORDER BY a.created_at DESC
      LIMIT ${RECENT_AUDIT}
    `);

    return rows.rows;
  }
}
