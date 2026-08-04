import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';

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
@Injectable()
export class DashboardService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async overview() {
    const [counters, revenue, bookings, audit] = await Promise.all([
      this.counters(),
      this.revenueSeries(),
      this.recentBookings(),
      this.recentAudit(),
    ]);

    return {
      counters,
      revenue,
      recentBookings: bookings,
      recentAudit: audit,
      /**
       * Explicitly absent, not zero. Disputes are not implemented; the console shows a
       * dash and a note rather than a number nobody should trust.
       */
      openDisputes: null,
    };
  }

  /**
   * The KPI row.
   *
   * "Today" is the database's date, not the caller's: staff, servers and customers can
   * sit in different zones, and a dashboard whose totals shift with the reader's clock
   * cannot be reconciled against anything.
   */
  private async counters() {
    const rows = await this.db.execute<{ metric: string; value: string }>(sql`
      SELECT 'bookings_today' AS metric, COUNT(*)::text AS value
        FROM bookings WHERE created_at::date = current_date AND deleted_at IS NULL
      UNION ALL
      SELECT 'bookings_yesterday', COUNT(*)::text
        FROM bookings
        WHERE created_at::date = current_date - 1 AND deleted_at IS NULL
      UNION ALL
      SELECT 'pending_confirmation', COUNT(*)::text
        FROM bookings WHERE status = 'pending_confirmation' AND deleted_at IS NULL
      UNION ALL
      -- The time-critical slice of the above: §6.4's window about to lapse.
      SELECT 'sla_expiring_soon', COUNT(*)::text
        FROM bookings
        WHERE status = 'pending_confirmation'
          AND confirmation_deadline_at IS NOT NULL
          AND confirmation_deadline_at <= now() + INTERVAL '30 minutes'
          AND deleted_at IS NULL
      UNION ALL
      SELECT 'cancelled_today', COUNT(*)::text
        FROM bookings
        WHERE cancelled_at::date = current_date AND deleted_at IS NULL
      UNION ALL
      -- A cancellation that cost the partner a fine, which is the one worth a second look.
      SELECT 'cancelled_today_with_fine', COUNT(*)::text
        FROM bookings b
        WHERE b.cancelled_at::date = current_date AND b.deleted_at IS NULL
          AND EXISTS (
            SELECT 1 FROM partner_violations v WHERE v.booking_id = b.id
          )
      UNION ALL
      SELECT 'partners_pending_verification', COUNT(*)::text
        FROM partners WHERE verification = 'pending' AND deleted_at IS NULL
      UNION ALL
      SELECT 'properties_pending_review', COUNT(*)::text
        FROM properties WHERE status = 'pending_review' AND deleted_at IS NULL
    `);

    const counters = Object.fromEntries(
      rows.rows.map((row) => [row.metric, Number(row.value)]),
    );

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
  private async revenueSeries() {
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
      GROUP BY d
      ORDER BY d
    `);

    return rows.rows.map((row) => ({ day: row.day, amount: row.amount }));
  }

  private async recentBookings() {
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
      WHERE b.deleted_at IS NULL
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
