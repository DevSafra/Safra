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
    /*
      Money is the OWNER's, and the dashboard is read by employees now (2026-08-23).

      `PAYOUT_READ_OWN` is deliberately absent from `PARTNER_EMPLOYEE_PERMISSIONS`, on the stated
      reasoning that a receptionist should not learn what the business earns. Two lines on this
      screen said it anyway: «ما ربحته هذا الشهر» and «تحويل مستحقات 1,240$ مجدول يوم الخميس».

      Both were assembled unconditionally — the only guard on this method is `BOOKING_READ_OWN`,
      which employees hold because reading the booking queue is the job. So the permission was
      withheld and the fact was published, which is the same shape as `score`/`tier` and as the six
      owner-only routes: correct code that stopped being correct when "whoever is signed in" stopped
      meaning "the owner".

      The rest of the dashboard is emphatically NOT hidden. It is most of an employee's work, and
      withholding must not become hiding.
    */
    const money = (claims?.permissions ?? []).includes(P.PAYOUT_READ_OWN);
    const earnings = money ? await this.earnings(partnerId) : null;
    const bookings = await this.activeBookings(partnerId);
    const occupancy = await this.occupancy(partnerId);
    const response = await this.responseSpeed(partnerId);
    const pendingRequests = await this.pendingRequests(partnerId);
    const calendar = await this.calendar(partnerId);
    const alerts = await this.alerts(partnerId);
    const violations = await this.violationSummary(partnerId);
    const notices = await this.notices(partnerId, money);
    const payout = money ? await this.payoutLine(partnerId) : null;

    return {
      kpis: { earnings, bookings, occupancy, response },
      pendingRequests,
      calendar,
      alerts,
      violations,
      notices,
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
   * تقويم — this month across the partner's WHOLE portfolio.
   *
   * ## Why not one unit
   *
   * It used to draw the partner's first unit by creation date. That is a defensible sample of one
   * and a misleading picture of a business: a partner with six units saw one unit's month on the
   * screen they open every morning, with nothing saying so beyond a unit name in the heading. The
   * dashboard's job is «كيف حال الشهر», and the answer to that is not one room.
   *
   * ## What a square means now
   *
   * Per day: how many units are booked, how many the partner has taken off sale, and how many are
   * still open. The per-unit month, with the editor, is its own screen — reached from عقاراتي —
   * so nothing is lost by aggregating here.
   *
   * ## Why it does not get slower with the portfolio
   *
   * The obvious query is units × days and then GROUP BY, which is 15,500 rows for a 500-unit
   * partner before it aggregates anything. This one expands the BOOKINGS that exist and the
   * availability rows that exist, which are bounded by what the partner actually did rather than
   * by how much they own, and both are indexed by `unit_id`. The response is thirty-one rows
   * whatever the portfolio looks like.
   *
   * Inactive units are excluded: a unit taken off sale entirely is not inventory, and counting it
   * as "available" would overstate what a customer can book.
   */
  private async calendar(partnerId: string) {
    const summary = await this.db.execute<{
      unit_count: number;
      property_count: number;
      from_price: string | null;
      currency_code: string | null;
    }>(sql`
      SELECT count(*)::int                AS unit_count,
             count(DISTINCT pr.id)::int   AS property_count,
             min(un.base_price)::text     AS from_price,
             min(c.code)                  AS currency_code
      FROM units un
      JOIN properties pr ON pr.id = un.property_id
      JOIN currencies c  ON c.id = un.currency_id
      WHERE pr.partner_id = ${partnerId}
        AND un.deleted_at IS NULL
        AND pr.deleted_at IS NULL
        AND un.is_active = true
    `);

    const totals = summary.rows[0];

    /* No sellable unit means no portfolio to draw, which the screen says in words. */
    if (!totals || totals.unit_count === 0) return null;

    const days = await this.db.execute<{
      date: string;
      booked: number;
      blocked: number;
    }>(sql`
      WITH unit_list AS (
        SELECT un.id
        FROM units un
        JOIN properties pr ON pr.id = un.property_id
        WHERE pr.partner_id = ${partnerId}
          AND un.deleted_at IS NULL
          AND pr.deleted_at IS NULL
          AND un.is_active = true
      ), month AS (
        SELECT date_trunc('month', now())::date                              AS first_day,
               (date_trunc('month', now()) + interval '1 month - 1 day')::date AS last_day
      ), day_list AS (
        SELECT d::date AS date
        FROM month, generate_series(month.first_day, month.last_day, interval '1 day') AS d
      ), booked_days AS (
        -- Expands the bookings that EXIST, not every unit against every day. A booking is the
        -- fact: where the calendar and a booking disagree, somebody is arriving.
        SELECT DISTINCT b.unit_id, d::date AS date
        FROM bookings b
        JOIN unit_list ul ON ul.id = b.unit_id
        CROSS JOIN LATERAL generate_series(b.check_in, b.check_out - 1, interval '1 day') AS d
        CROSS JOIN month
        WHERE b.status IN ('confirmed', 'checked_in', 'completed')
          AND d::date BETWEEN month.first_day AND month.last_day
      ), blocked_days AS (
        SELECT ad.unit_id, ad.date
        FROM availability_days ad
        JOIN unit_list ul ON ul.id = ad.unit_id
        CROSS JOIN month
        WHERE ad.status IN ('closed', 'maintenance')
          AND ad.date BETWEEN month.first_day AND month.last_day
      )
      SELECT day_list.date::text AS date,
             (SELECT count(*) FROM booked_days bd WHERE bd.date = day_list.date)::int AS booked,
             -- A unit both booked and closed counts ONCE, as booked. Counting it twice would let
             -- booked + blocked exceed the portfolio and make "available" negative.
             (SELECT count(*) FROM blocked_days bl
               WHERE bl.date = day_list.date
                 AND NOT EXISTS (
                   SELECT 1 FROM booked_days bd
                   WHERE bd.unit_id = bl.unit_id AND bd.date = bl.date
                 ))::int AS blocked
      FROM day_list
      ORDER BY day_list.date
    `);

    return {
      unitCount: totals.unit_count,
      propertyCount: totals.property_count,
      fromPrice: totals.from_price ?? '0',
      currencyCode: totals.currency_code ?? 'USD',
      days: days.rows.map((day) => ({
        date: day.date,
        booked: day.booked,
        blocked: day.blocked,
        /* Derived rather than selected, so the three can never sum to something else. */
        available: Math.max(0, totals.unit_count - day.booked - day.blocked),
      })),
    };
  }

  /**
   * المخالفات والتنبيهات — what SAFRA has recorded against this partner, most recent first.
   *
   * Waived violations are excluded. A fine that was reversed is not a live alert, and leaving it on
   * the dashboard would keep telling a partner they owe something they do not.
   */
  /**
   * How many violations are OPEN, and the furthest any of them has been taken.
   *
   * ## Why a count when `alerts` already returns rows
   *
   * `alerts` is `LIMIT 5` — a list to read, not a figure. A partner with nine open violations sees
   * five bullets and no indication there are more, which is the shape of understatement a screen
   * about enforcement must not have. The card states the number; the list stays a list.
   *
   * ## OPEN means not waived, matching `alerts`
   *
   * A waived violation stays on the record and stays on المخالفات — the partner needs to see that
   * SAFRA acted — but it is settled, so counting it as something demanding attention would make the
   * notification permanent. Same predicate as the list above, deliberately, so the card and the
   * bullets can never disagree about what they are describing.
   *
   * ## `stage` comes back so the card can say WHICH rung
   *
   * The ladder's furthest point is the useful summary: «غرامة» matters more than the count, and a
   * partner at `suspension` should not read the same word as one merely recorded. Ordered by the
   * enum's own progression rather than alphabetically, which would put `fined` before `recorded`.
   */
  /**
   * The in-app enforcement notices — what the platform has TOLD this partner.
   *
   * ## Why they are on the dashboard rather than behind their own section
   *
   * A notification is read when somebody arrives, and this is where they arrive. A section would
   * also need a capability of its own, and none of the eleven fits: these notices span violations,
   * suspension and money, so gating them on `VIOLATION_READ` would hide a suspension notice from a
   * reader entitled to see the suspension banner two inches above it.
   *
   * ## What a row carries, and what it deliberately does not
   *
   * The template and the date. No prose: the detail lives on the record the notice concerns —
   * مخالفات renders the description, the warning note, the fine and the waiver — and a copy here
   * would be a second version of those sentences, free to drift from the one an appeal turns on.
   * It is also the standing requirement that a notification POINT at an authenticated page rather
   * than restate sensitive detail outside one.
   *
   * ## The money rule, applied to the same facts
   *
   * `partner.fined` and `partner.fine_waived` are withheld from a reader without
   * `PAYOUT_READ_OWN`, exactly as `earnings` and the payout line are, and exactly as the violations
   * list withholds every figure from the same reader. A notice saying a fine happened is a fact
   * about the business's money; hiding the amount and announcing the event would be withholding in
   * name only.
   */
  private async notices(partnerId: string, money: boolean) {
    const withheld = money
      ? sql``
      : sql`AND n.template_key NOT IN ('partner.fined', 'partner.fine_waived')`;

    const result = await this.db.execute<{ template_key: string; at: string }>(sql`
      SELECT n.template_key,
             to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS at
      FROM notifications n
      WHERE n.partner_id = ${partnerId}
        AND n.channel = 'in_app'
        AND n.deleted_at IS NULL
        ${withheld}
      ORDER BY n.created_at DESC
      LIMIT 10
    `);

    return result.rows.map((row) => ({ templateKey: row.template_key, at: row.at }));
  }

  private async violationSummary(partnerId: string) {
    const result = await this.db.execute<{ open: number; stage: string | null }>(sql`
      SELECT count(*)::int AS open,
             max(array_position(
               ARRAY['recorded','warned','fined','suspension']::text[], v.stage::text
             )) AS stage
      FROM partner_violations v
      WHERE v.partner_id = ${partnerId}
        AND v.waived_at IS NULL
        AND v.deleted_at IS NULL
    `);

    const row = result.rows[0];
    const ladder = ['recorded', 'warned', 'fined', 'suspension'];
    /* `max(array_position(...))` returns the 1-based rung, or null when there are no rows. */
    const rung =
      row?.stage === null || row?.stage === undefined ? null : Number(row.stage);

    return {
      open: row?.open ?? 0,
      furthestStage: rung === null ? null : (ladder[rung - 1] ?? null),
    };
  }

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
