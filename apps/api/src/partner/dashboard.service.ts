import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * لوحة التحكم — everything the partner dashboard renders, in one round trip (design handoff §7.1).
 *
 * ## One endpoint, not six
 *
 * The screen draws four KPI cards, the pending-request queue, a month calendar and an alerts
 * panel. Six endpoints would be six round trips on the screen a partner opens most often, and rule
 * 2 forbids exactly that shape. Each section below is one indexed query; none of them scans.
 *
 * ## Everything is scoped by the TOKEN
 *
 * `requirePartnerId` reads the partner id from the verified claims. No method here accepts a
 * partner id, so "show me another partner's dashboard" is a question this service cannot be asked
 * — the same property `listOwn` has, and the reason partner isolation is structural rather than
 * remembered.
 *
 * ## What this refuses to compute
 *
 * A KPI with no data underneath it returns `null`, never zero. «٠٪ إشغال» is a claim — it says the
 * partner sold nothing — and a partner with no units has not sold nothing, they have no data. The
 * same for response speed: a partner who has never been asked to confirm a booking has no response
 * time, and inventing "0 minutes" would flatter them into thinking a metric is being met.
 *
 * The payout line is the sharpest case and has its own rules — see `payoutLine`.
 */
@Injectable()
export class PartnerDashboardService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async overview(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.BOOKING_READ_OWN);

    /*
      Sequential rather than Promise.all, deliberately.

      Each of these is a short indexed query and the pool is shared with every other request. Six
      concurrent connections per dashboard view is how a pool gets exhausted by a screen that looks
      cheap — rule 2 treats connections as the scarce resource, and the round trip saved here is
      measured in single-digit milliseconds against a local database.
    */
    const earnings = await this.earnings(partnerId);
    const bookings = await this.activeBookings(partnerId);
    const occupancy = await this.occupancy(partnerId);
    const response = await this.responseSpeed(partnerId);
    const pendingRequests = await this.pendingRequests(partnerId);
    const calendar = await this.calendar(partnerId);
    const alerts = await this.alerts(partnerId);
    const payout = await this.payoutLine(partnerId);

    return {
      kpis: { earnings, bookings, occupancy, response },
      pendingRequests,
      calendar,
      alerts,
      payout,
    };
  }

  /**
   * What the partner earned this calendar month, and the month before it.
   *
   * `partner_payable_amount` is the booking's own snapshot of what SAFRA owes after commission —
   * frozen at creation, so this cannot drift when the commission rate changes. It is an
   * OBLIGATION, and the copy calls it أرباح (earnings), which is what it is. It is emphatically not
   * the payout line: see `payoutLine`.
   *
   * Counted on `completed` and `confirmed` only. A `pending_confirmation` booking may still be
   * refused and a cancelled one earns nothing, so including either would show a partner money that
   * can evaporate.
   */
  private async earnings(partnerId: string) {
    const result = await this.db.execute<{
      currency_code: string | null;
      this_month: string;
      last_month: string;
    }>(sql`
      SELECT c.code AS currency_code,
             coalesce(sum(b.partner_payable_amount)
               FILTER (WHERE b.check_in >= date_trunc('month', now())::date), 0)::text
               AS this_month,
             coalesce(sum(b.partner_payable_amount)
               FILTER (WHERE b.check_in >= (date_trunc('month', now()) - interval '1 month')::date
                         AND b.check_in <  date_trunc('month', now())::date), 0)::text
               AS last_month
      FROM bookings b
      JOIN currencies c ON c.id = b.currency_id
      WHERE b.partner_id = ${partnerId}
        AND b.status IN ('confirmed', 'completed')
        AND b.check_in >= (date_trunc('month', now()) - interval '1 month')::date
      GROUP BY c.code
      ORDER BY sum(b.partner_payable_amount) DESC
      LIMIT 1
    `);

    const row = result.rows[0];

    /*
      No bookings in either month is not zero earnings — it is no data, and the card says «—».
      A confident «$0» reads as "you sold nothing", which is a different and possibly false claim.
    */
    if (!row) return null;

    const thisMonth = Number(row.this_month);
    const lastMonth = Number(row.last_month);

    return {
      amount: row.this_month,
      currencyCode: row.currency_code,
      previousAmount: row.last_month,
      /* Null rather than +100% when the comparison month is empty — there is no ratio to a zero. */
      changePercent:
        lastMonth > 0 ? Math.round(((thisMonth - lastMonth) / lastMonth) * 100) : null,
    };
  }

  /** Confirmed bookings still ahead of, or inside, their stay — and how many arrive this week. */
  private async activeBookings(partnerId: string) {
    const result = await this.db.execute<{ active: number; arriving: number }>(sql`
      SELECT count(*) FILTER (WHERE b.status IN ('confirmed', 'checked_in'))::int AS active,
             count(*) FILTER (WHERE b.status = 'confirmed'
                                AND b.check_in >= current_date
                                AND b.check_in <  current_date + 7)::int AS arriving
      FROM bookings b
      WHERE b.partner_id = ${partnerId}
        AND b.check_out >= current_date
    `);

    return {
      active: result.rows[0]?.active ?? 0,
      arrivingThisWeek: result.rows[0]?.arriving ?? 0,
    };
  }

  /**
   * Occupancy this month: nights sold ÷ nights the partner had to sell.
   *
   * The denominator is units × days elapsed so far this month, not units × days in the month. A
   * partner is judged on the nights that have HAPPENED; counting the rest of the month as unsold
   * would show occupancy falling every day until the month turns.
   */
  private async occupancy(partnerId: string) {
    const result = await this.db.execute<{
      unit_count: number;
      booked_nights: number;
      elapsed_days: number;
    }>(sql`
      WITH own_units AS (
        SELECT un.id
        FROM units un
        JOIN properties pr ON pr.id = un.property_id
        WHERE pr.partner_id = ${partnerId}
          AND un.deleted_at IS NULL
          AND pr.deleted_at IS NULL
      ), nights AS (
        -- Nights, not bookings. A booking spanning the month boundary counts only the nights
        -- inside this month, which generate_series clipped to the month gives directly.
        -- (SQL comments, not JS ones: a backtick inside a template literal ends the string.)
        SELECT count(*)::int AS n
        FROM bookings b
        JOIN own_units u ON u.id = b.unit_id
        CROSS JOIN LATERAL generate_series(
          greatest(b.check_in, date_trunc('month', now())::date),
          least(b.check_out - 1, current_date),
          interval '1 day'
        ) AS d
        WHERE b.status IN ('confirmed', 'checked_in', 'completed')
      )
      SELECT (SELECT count(*)::int FROM own_units) AS unit_count,
             (SELECT n FROM nights) AS booked_nights,
             (date_part('day', now()))::int AS elapsed_days
    `);

    const row = result.rows[0];
    const capacity = (row?.unit_count ?? 0) * (row?.elapsed_days ?? 0);

    /* No units, or the first day of the month: no denominator, so no percentage to report. */
    if (!row || capacity === 0) return null;

    return {
      percent: Math.round((row.booked_nights / capacity) * 100),
      bookedNights: row.booked_nights,
      availableNights: capacity,
    };
  }

  /**
   * How quickly this partner answers a booking request, as a MEDIAN over the last 90 days.
   *
   * Median rather than mean: one booking confirmed after a fortnight's holiday would drag a mean
   * into meaninglessness, and the number exists to tell a partner whether they are keeping up.
   *
   * Only bookings that were actually confirmed by a decision are measured — a booking auto-expired
   * by the SLA sweep has no response time, and counting it as the full two hours would be
   * measuring the clock rather than the partner.
   */
  private async responseSpeed(partnerId: string) {
    const result = await this.db.execute<{
      median_minutes: string | null;
      n: number;
    }>(sql`
      SELECT percentile_cont(0.5) WITHIN GROUP (
               ORDER BY extract(epoch FROM (b.confirmed_at - b.created_at)) / 60
             )::text AS median_minutes,
             count(*)::int AS n
      FROM bookings b
      WHERE b.partner_id = ${partnerId}
        AND b.confirmed_at IS NOT NULL
        AND b.created_at >= now() - interval '90 days'
    `);

    const row = result.rows[0];

    /* Never asked to confirm anything: no response time exists, and «—» says so honestly. */
    if (!row || row.n === 0 || row.median_minutes === null) return null;

    return { medianMinutes: Math.round(Number(row.median_minutes)), sampleSize: row.n };
  }

  /**
   * طلبات حجز بانتظار ردك — the §7.1 queue, with the SLA clock the fine attaches to.
   *
   * `confirmation_deadline_at` is the booking's own snapshot of when the two hours run out, so this
   * cannot disagree with the sweep that actually levies the fine. Ordered by deadline, because the
   * only useful ordering for a queue with a clock is "what expires first".
   */
  private async pendingRequests(partnerId: string) {
    const result = await this.db.execute<{
      reference: string;
      unit_name: string;
      property_name: string;
      check_in: string;
      check_out: string;
      nights: number;
      guests: number;
      amount: string;
      currency_code: string;
      deadline_at: string | null;
    }>(sql`
      SELECT b.reference,
             un.name_ar AS unit_name,
             pr.name_ar AS property_name,
             b.check_in::text, b.check_out::text,
             (b.check_out - b.check_in)::int AS nights,
             (b.guests_adults + coalesce(b.guests_children, 0))::int AS guests,
             b.total_amount::text AS amount,
             c.code AS currency_code,
             b.confirmation_deadline_at::text AS deadline_at
      FROM bookings b
      JOIN units un ON un.id = b.unit_id
      JOIN properties pr ON pr.id = b.property_id
      JOIN currencies c ON c.id = b.currency_id
      WHERE b.partner_id = ${partnerId}
        AND b.status = 'pending_confirmation'
      ORDER BY b.confirmation_deadline_at NULLS LAST
      LIMIT 10
    `);

    return result.rows.map((row) => ({
      reference: row.reference,
      unitName: row.unit_name,
      propertyName: row.property_name,
      checkIn: row.check_in,
      checkOut: row.check_out,
      nights: row.nights,
      guests: row.guests,
      amount: row.amount,
      currencyCode: row.currency_code,
      deadlineAt: row.deadline_at,
    }));
  }

  /**
   * تقويم — this month for ONE unit, the way §7.1 draws it.
   *
   * One unit rather than all of them, because the design's grid is a single month of squares and a
   * partner with six units has no room for six grids on a dashboard. The unit chosen is their
   * first by creation, which is stable across reloads; the full per-unit calendar is its own
   * screen (`GET /partner/units/:id/calendar`).
   *
   * Days are derived from `generate_series` and LEFT JOINed onto `availability_days`, so a month
   * with no rows still returns thirty squares. Building the grid from the table's rows instead
   * would draw a half-empty month whenever nobody had touched the calendar — which looks like
   * missing data rather than an available month.
   */
  private async calendar(partnerId: string) {
    const unit = await this.db.execute<{
      id: string;
      name_ar: string;
      base_price: string;
      currency_code: string;
    }>(sql`
      SELECT un.id, un.name_ar, un.base_price::text, c.code AS currency_code
      FROM units un
      JOIN properties pr ON pr.id = un.property_id
      JOIN currencies c ON c.id = un.currency_id
      WHERE pr.partner_id = ${partnerId}
        AND un.deleted_at IS NULL
        AND pr.deleted_at IS NULL
      ORDER BY un.created_at
      LIMIT 1
    `);

    const row = unit.rows[0];

    if (!row) return null;

    const days = await this.db.execute<{
      date: string;
      status: string;
      price: string | null;
    }>(sql`
      SELECT d::date::text AS date,
             coalesce(ad.status::text, 'available') AS status,
             coalesce(ad.price, ${row.base_price})::text AS price
      FROM generate_series(
             date_trunc('month', now())::date,
             (date_trunc('month', now()) + interval '1 month - 1 day')::date,
             interval '1 day'
           ) AS d
      LEFT JOIN availability_days ad ON ad.unit_id = ${row.id} AND ad.date = d::date
      ORDER BY d
    `);

    /*
      A day with a booking on it reads as booked even where `availability_days` says otherwise.
      The two can disagree — a booking is written by the booking flow and the calendar by the
      partner — and when they do, the BOOKING is the fact: somebody is arriving.
    */
    const booked = await this.db.execute<{ date: string }>(sql`
      SELECT d::date::text AS date
      FROM bookings b
      CROSS JOIN LATERAL generate_series(b.check_in, b.check_out - 1, interval '1 day') AS d
      WHERE b.unit_id = ${row.id}
        AND b.status IN ('confirmed', 'checked_in', 'completed')
        AND d >= date_trunc('month', now())::date
        AND d <  date_trunc('month', now()) + interval '1 month'
    `);

    const bookedDates = new Set(booked.rows.map((r) => r.date));

    return {
      unitName: row.name_ar,
      defaultPrice: row.base_price,
      currencyCode: row.currency_code,
      days: days.rows.map((day) => ({
        date: day.date,
        status: bookedDates.has(day.date) ? 'booked' : day.status,
        price: day.price,
      })),
    };
  }

  /**
   * المخالفات والتنبيهات — what SAFRA has recorded against this partner, most recent first.
   *
   * Waived violations are excluded. A fine that was reversed is not a live alert, and leaving it on
   * the dashboard would keep telling a partner they owe something they do not.
   */
  private async alerts(partnerId: string) {
    const result = await this.db.execute<{
      kind: string;
      fine_amount: string | null;
      currency_code: string | null;
      booking_reference: string | null;
      created_at: string;
    }>(sql`
      SELECT v.kind::text,
             v.fine_amount::text,
             c.code AS currency_code,
             b.reference AS booking_reference,
             v.created_at::text
      FROM partner_violations v
      LEFT JOIN currencies c ON c.id = v.fine_currency_id
      LEFT JOIN bookings b ON b.id = v.booking_id
      WHERE v.partner_id = ${partnerId}
        AND v.waived_at IS NULL
      ORDER BY v.created_at DESC
      LIMIT 5
    `);

    return result.rows.map((row) => ({
      kind: row.kind,
      fineAmount: row.fine_amount,
      currencyCode: row.currency_code,
      bookingReference: row.booking_reference,
      createdAt: row.created_at,
    }));
  }

  /**
   * The §7.1 payout line — *"تحويل مستحقات 1,240$ مجدول يوم الخميس"*.
   *
   * ## The rule this exists to keep
   *
   * It reads a `partner_payouts` ROW or it returns null. It never sums `partner_payable_amount`
   * into a sentence about a transfer. Those two numbers answer different questions — "what are we
   * owed" and "what is being sent, when" — and presenting the first as the second, to the person it
   * is owed to, is the one failure mode a dashboard about somebody's money must not have. The
   * console's الدفع screen made the same refusal before the ledger existed.
   *
   * ## Why both statuses, and why they are labelled apart
   *
   * `scheduled` is the handoff's line: a transfer with a date. `accruing` is the open period money
   * is landing in — also a real ledger row, also an event rather than an inference, but NOT a
   * scheduled transfer. Both are returned, and the `status` travels with the amount so the screen
   * cannot render one as the other. A partner reading «قيد التجميع» has been told the truth; a
   * partner reading «مجدول» about an accruing balance has not.
   *
   * `scheduled` wins when both exist, because a dated transfer is the more actionable fact.
   */
  private async payoutLine(partnerId: string) {
    const result = await this.db.execute<{
      reference: string;
      net_amount: string;
      currency_code: string;
      status: string;
      scheduled_for: string | null;
    }>(sql`
      SELECT p.reference, p.net_amount::text, c.code AS currency_code,
             p.status::text, p.scheduled_for::text
      FROM partner_payouts p
      JOIN currencies c ON c.id = p.currency_id
      WHERE p.partner_id = ${partnerId}
        AND p.status IN ('scheduled', 'accruing')
      ORDER BY (p.status = 'scheduled') DESC, p.period_start DESC
      LIMIT 1
    `);

    const row = result.rows[0];

    /* No payout row: the line is ABSENT. Not «$0 مجدول», which would be a transfer that is not. */
    if (!row) return null;

    return {
      reference: row.reference,
      netAmount: row.net_amount,
      currencyCode: row.currency_code,
      status: row.status,
      scheduledFor: row.scheduled_for,
    };
  }
}
