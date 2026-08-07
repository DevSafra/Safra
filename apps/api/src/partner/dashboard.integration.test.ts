import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { PartnerDashboardService } from './dashboard.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * لوحة التحكم against a REAL PostgreSQL (design handoff §7.1).
 *
 * ## What is worth proving here
 *
 * Two things, and neither is visible to a unit test with a mocked database:
 *
 * 1. **Isolation.** Every figure on this screen is one partner's business. A join written one
 *    table too wide would show partner A their competitor's occupancy, and it would look entirely
 *    plausible — there is no shape to the number that says whose it is. So the fixtures build TWO
 *    partners with different data and assert the boundary between them.
 * 2. **Null is not zero.** The service returns null where the platform has no data, and «٠٪
 *    إشغال» is a claim rather than an absence. A mock would happily return whatever it was told.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('PartnerDashboardService', () => {
  const db: Database = createDatabase(DATABASE_URL ?? '', 2);
  const service = new PartnerDashboardService(db);

  /** The partner under test, and a NEIGHBOUR whose data must never appear. */
  let partnerId = '';
  let neighbourId = '';
  let unitId = '';
  let currencyId = '';

  const claims = (id: string): AccessTokenClaims => ({
    sub: '00000000-0000-0000-0000-000000000001',
    role: 'partner',
    permissions: [P.BOOKING_READ_OWN, P.PAYOUT_READ_OWN],
    locale: 'ar',
    totpEnabled: true,
    partnerId: id,
  });

  /**
   * A partner with one property, one unit, and nothing else.
   *
   * Each test builds the bookings it needs on top, so no test inherits another's state — the
   * lesson the payout suite learned when tests competed for shared fixtures and the failure
   * depended on the order they ran in.
   */
  async function makePartner(): Promise<{ partnerId: string; unitId: string }> {
    const made = await db.execute<{ partner_id: string; unit_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD') AS currency_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('dash-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'Dash Test', 'Dash Test', ref.city_id,
               'x', '+963900000000', 'dash@safra.test', 'approved'
        FROM u, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'dash-test-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Unit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id, property_id
      )
      SELECT pr.partner_id, un.id AS unit_id FROM un JOIN pr ON pr.id = un.property_id
    `);

    return {
      partnerId: made.rows[0]?.partner_id ?? '',
      unitId: made.rows[0]?.unit_id ?? '',
    };
  }

  /**
   * One booking on a unit, with dates given as day offsets from today.
   *
   * `status` decides which timestamps are set, the way the real flow does — a confirmed booking
   * has `confirmed_at`, a pending one has a deadline and neither.
   */
  async function makeBooking(options: {
    unit: string;
    partner: string;
    status: string;
    fromDay: number;
    nights: number;
    payable?: string;
  }): Promise<void> {
    const { unit, partner, status, fromDay, nights, payable = '186.00' } = options;

    await db.execute(sql`
      WITH cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('Dash Guest', 'dash-guest-' || gen_random_uuid() || '@safra.test',
                '+963900000001', true)
        RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                            confirmed_at, confirmation_deadline_at)
      SELECT cp.id, un.id, un.property_id, ${partner}, pr.city_id,
             (current_date + ${fromDay}::int)::date,
             (current_date + ${fromDay}::int + ${nights}::int)::date,
             2, ${status}::booking_status,
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', ${payable},
             un.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb,
             CASE WHEN ${status} IN ('confirmed','completed','checked_in')
                  THEN now() - interval '30 minute' END,
             CASE WHEN ${status} = 'pending_confirmation'
                  THEN now() + interval '2 hour' END
      FROM cp, units un JOIN properties pr ON pr.id = un.property_id
      WHERE un.id = ${unit}
    `);
  }

  beforeEach(async () => {
    const mine = await makePartner();
    const theirs = await makePartner();

    partnerId = mine.partnerId;
    unitId = mine.unitId;
    neighbourId = theirs.partnerId;

    const currency = await db.execute<{ id: string }>(
      sql`SELECT id FROM currencies WHERE code = 'USD'`,
    );
    currencyId = currency.rows[0]?.id ?? '';

    /* The neighbour is busy. None of this may show up on the partner's dashboard. */
    await makeBooking({
      unit: theirs.unitId,
      partner: theirs.partnerId,
      status: 'confirmed',
      fromDay: -2,
      nights: 4,
      payable: '999.00',
    });
    await makeBooking({
      unit: theirs.unitId,
      partner: theirs.partnerId,
      status: 'pending_confirmation',
      fromDay: 20,
      nights: 2,
    });
  });

  afterAll(async () => {
    await db.$client.end();
  });

  describe('isolation', () => {
    /*
      The single most important assertion on this screen. Every figure here is one partner's
      business, and a join one table too wide would show a competitor's numbers in a shape that
      looks entirely plausible.
    */
    it('shows none of a neighbouring partner’s bookings', async () => {
      const mine = await service.overview(claims(partnerId));

      expect(mine.pendingRequests).toHaveLength(0);
      expect(mine.kpis.bookings.active).toBe(0);
    });

    it('gives each partner their own pending queue', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'pending_confirmation',
        fromDay: 10,
        nights: 2,
      });

      const mine = await service.overview(claims(partnerId));
      const theirs = await service.overview(claims(neighbourId));

      expect(mine.pendingRequests).toHaveLength(1);
      expect(theirs.pendingRequests).toHaveLength(1);
      expect(mine.pendingRequests[0]?.reference).not.toBe(
        theirs.pendingRequests[0]?.reference,
      );
    });

    it('refuses a caller with no partner id rather than answering unscoped', async () => {
      const orphan = { ...claims(partnerId), partnerId: undefined };

      await expect(service.overview(orphan)).rejects.toThrow();
    });

    it('refuses a caller without the permission', async () => {
      const unarmed = { ...claims(partnerId), permissions: [] };

      await expect(service.overview(unarmed)).rejects.toThrow();
    });
  });

  describe('KPIs report absence as absence, never as zero', () => {
    it('returns null earnings for a partner with no bookings', async () => {
      const view = await service.overview(claims(partnerId));

      expect(view.kpis.earnings).toBeNull();
    });

    it('returns null response speed when nothing was ever confirmed', async () => {
      const view = await service.overview(claims(partnerId));

      expect(view.kpis.response).toBeNull();
    });

    /*
      Occupancy is the one that would mislead most. A partner with units and no bookings HAS an
      occupancy — zero — and that is a fact worth stating. A partner with no units does not, and
      the difference is the difference between "you sold nothing" and "we have nothing to tell
      you".
    */
    it('reports a real zero occupancy for a partner with units and no stays', async () => {
      const view = await service.overview(claims(partnerId));

      expect(view.kpis.occupancy?.percent).toBe(0);
      expect(view.kpis.occupancy?.bookedNights).toBe(0);
    });

    it('counts only confirmed and completed bookings as earnings', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'completed',
        fromDay: 1,
        nights: 2,
        payable: '500.00',
      });
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'cancelled',
        fromDay: 5,
        nights: 2,
        payable: '400.00',
      });

      const view = await service.overview(claims(partnerId));

      // The cancelled booking's 400 must not be in there.
      expect(Number(view.kpis.earnings?.amount)).toBe(500);
    });

    it('counts confirmed bookings as active and notices the ones arriving this week', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 2,
        nights: 2,
      });

      const view = await service.overview(claims(partnerId));

      expect(view.kpis.bookings.active).toBe(1);
      expect(view.kpis.bookings.arrivingThisWeek).toBe(1);
    });
  });

  describe('the pending queue', () => {
    it('carries the SLA deadline the fine attaches to', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'pending_confirmation',
        fromDay: 10,
        nights: 3,
      });

      const view = await service.overview(claims(partnerId));

      expect(view.pendingRequests[0]?.deadlineAt).not.toBeNull();
      expect(view.pendingRequests[0]?.nights).toBe(3);
    });

    it('holds only unanswered requests, not confirmed ones', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 10,
        nights: 2,
      });

      const view = await service.overview(claims(partnerId));

      expect(view.pendingRequests).toHaveLength(0);
    });
  });

  describe('the calendar', () => {
    it('returns a full month of days even when nothing has touched availability', async () => {
      const view = await service.overview(claims(partnerId));

      expect(view.calendar?.days.length).toBeGreaterThanOrEqual(28);
      expect(view.calendar?.days.every((d) => d.status === 'available')).toBe(true);
    });

    /*
      A booking beats the availability table. The two can disagree — one is written by the booking
      flow and the other by the partner — and when they do, somebody is arriving, which is the
      fact that matters.
    */
    it('paints a booked day as booked even where availability says available', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'confirmed',
        fromDay: 0,
        nights: 2,
      });

      const view = await service.overview(claims(partnerId));
      const today = new Date().toISOString().slice(0, 10);

      expect(view.calendar?.days.find((d) => d.date === today)?.status).toBe('booked');
    });

    it('returns no calendar for a partner with no units', async () => {
      await db.execute(sql`
        UPDATE units SET deleted_at = now()
        WHERE property_id IN (SELECT id FROM properties WHERE partner_id = ${partnerId})
      `);

      const view = await service.overview(claims(partnerId));

      expect(view.calendar).toBeNull();
    });
  });

  /**
   * The payout line — the rule the whole ledger was built to keep.
   *
   * Every one of these asserts the same thing from a different side: the line describes a ROW, or
   * it describes nothing. It must never be a sum of what bookings owe dressed up as a transfer.
   */
  describe('the payout line', () => {
    async function makePayout(status: string, scheduledFor: string | null) {
      await db.execute(sql`
        INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end,
                                     gross_amount, fine_amount, net_amount, status,
                                     scheduled_for, released_at)
        VALUES (${partnerId}, ${currencyId},
                date_trunc('month', now())::date,
                (date_trunc('month', now()) + interval '1 month - 1 day')::date,
                '1000.00', '0.00', '1000.00', ${status}::payout_status,
                ${scheduledFor}::date,
                CASE WHEN ${status} = 'scheduled' THEN now() END)
      `);
    }

    it('is absent when the partner has no payout row at all', async () => {
      await makeBooking({
        unit: unitId,
        partner: partnerId,
        status: 'completed',
        fromDay: -5,
        nights: 3,
        payable: '900.00',
      });

      const view = await service.overview(claims(partnerId));

      /*
        THE assertion. There is money owed — a completed booking with a payable amount — and the
        line is still null, because no transfer exists. Deriving one from the booking is exactly
        what this must never do.
      */
      expect(view.payout).toBeNull();
    });

    it('reports an accruing period as accruing, never as scheduled', async () => {
      await makePayout('accruing', null);

      const view = await service.overview(claims(partnerId));

      expect(view.payout?.status).toBe('accruing');
      expect(view.payout?.scheduledFor).toBeNull();
    });

    it('reports a scheduled transfer with its date', async () => {
      await makePayout('scheduled', '2026-12-24');

      const view = await service.overview(claims(partnerId));

      expect(view.payout?.status).toBe('scheduled');
      expect(view.payout?.scheduledFor).toBe('2026-12-24');
    });

    /* A dated transfer is the more actionable fact, so it wins when both exist. */
    it('prefers a scheduled transfer over an open accrual', async () => {
      await makePayout('accruing', null);
      await makePayout('scheduled', '2026-12-24');

      const view = await service.overview(claims(partnerId));

      expect(view.payout?.status).toBe('scheduled');
    });

    it('never shows a neighbouring partner’s payout', async () => {
      await makePayout('scheduled', '2026-12-24');

      const view = await service.overview(claims(neighbourId));

      expect(view.payout).toBeNull();
    });
  });

  describe('alerts', () => {
    it('omits a violation that was waived', async () => {
      await db.execute(sql`
        INSERT INTO partner_violations (partner_id, kind, fine_amount, fine_currency_id,
                                        waived_at, waived_reason)
        VALUES (${partnerId}, 'no_response', '10.00', ${currencyId}, now(), 'Goodwill.')
      `);

      const view = await service.overview(claims(partnerId));

      expect(view.alerts).toHaveLength(0);
    });

    it('reports a live violation with its fine', async () => {
      await db.execute(sql`
        INSERT INTO partner_violations (partner_id, kind, fine_amount, fine_currency_id)
        VALUES (${partnerId}, 'no_response', '10.00', ${currencyId})
      `);

      const view = await service.overview(claims(partnerId));

      expect(view.alerts[0]?.kind).toBe('no_response');
      expect(Number(view.alerts[0]?.fineAmount)).toBe(10);
    });
  });
});
