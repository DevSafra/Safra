import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PARTNER_EMPLOYEE_PERMISSIONS, PERMISSIONS as P } from '@safra/contracts';

import { PartnerDashboardService } from './dashboard.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * What لوحة التحكم tells an EMPLOYEE about the business's money.
 *
 * ## The gap a route-permission test cannot see
 *
 * `employee-reach.test.ts` asks whether an employee can call a handler. That catches an owner-only
 * ROUTE left open, and it caught six. It cannot catch this, because the dashboard is legitimately
 * an employee's screen — they need the day's bookings, the pending requests and the calendar. The
 * problem is not the route, it is what rides along in the PAYLOAD.
 *
 * `overview()` guards on `BOOKING_READ_OWN`, which an employee holds, and then assembles
 * `kpis.earnings` and `payout` unconditionally. Neither is bounded by a permission at any point
 * after the guard.
 *
 * `PARTNER_EMPLOYEE_PERMISSIONS` withholds `PAYOUT_READ_OWN` in as many words — *"a receptionist
 * should not learn what the business earns; an owner who wants that for an accountant can ask for
 * it explicitly"*. The payouts SCREEN honours that: `/partner/payouts` requires the permission and
 * refuses. The dashboard is the landing page, so an employee is told on arrival what the payouts
 * screen exists to withhold from them.
 *
 * This is the same shape as the six routes and as `score`/`tier`: the code was right while
 * "whoever is signed in" meant "the owner", and every one of those places stopped being right on
 * the same day, silently.
 *
 * ## What the fix has to preserve
 *
 * Not "hide the dashboard from employees" — it is most of their job. The two money fields become
 * `null` for a caller without `PAYOUT_READ_OWN`, exactly as `score` and `tier` did on the profile.
 * The owner's own dashboard is unchanged, which is what the last two assertions hold.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the dashboard, read by an employee', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: PartnerDashboardService;
  let partnerId = '';

  /** An employee's real claims: the EMPLOYER's partner id, and the allow-list, nothing else. */
  const employee = (): AccessTokenClaims =>
    ({
      sub: '00000000-0000-0000-0000-0000000000e1',
      role: 'partner_employee',
      partnerId,
      permissions: [...PARTNER_EMPLOYEE_PERMISSIONS],
    }) as unknown as AccessTokenClaims;

  const owner = (): AccessTokenClaims =>
    ({
      sub: '00000000-0000-0000-0000-0000000000e2',
      role: 'partner',
      partnerId,
      permissions: [P.BOOKING_READ_OWN, P.PAYOUT_READ_OWN],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    service = new PartnerDashboardService(db);

    const made = await db.execute<{ partner: string }>(sql`
      WITH ou AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('dash-owner-' || gen_random_uuid() || '@safra.test', '+963900000800',
                'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT ou.id, (SELECT id FROM partner_types LIMIT 1), 'Dash Co', 'لوحة',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000800', 'dash@safra.test', 'approved'
        FROM ou
        RETURNING id
      )
      SELECT id AS partner FROM pa
    `);

    partnerId = made.rows[0]?.partner ?? '';

    /*
      One CONFIRMED booking checking in this month, so `earnings` has something to sum.

      The city comes from `ref`, NOT from a join back to `properties`. A data-modifying CTE's rows
      are invisible to a plain table read in the SAME statement — Postgres takes one snapshot for
      the whole statement — so an earlier `JOIN properties p ON p.id = un.property_id` matched
      nothing and the INSERT wrote ZERO rows without erroring. `INSERT … SELECT` over an empty
      select is not a failure, so the fixture looked correct and `earnings` stayed null. The owner
      control below is the only reason that surfaced.

      (The explanation lives out here rather than inside the template because a backtick ENDS a
      `sql` tagged template — the same trap that has cost time twice today.)

      `kpis.earnings` is null when there are no bookings in either month — "no data", which the
      card renders as «—». So without this the employee assertion below would pass on an empty
      fixture and prove nothing, which is the trap the payout half of this file already documents.
    */
    await db.execute(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id,
               (SELECT id FROM currencies LIMIT 1) AS currency_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT ${partnerId}::uuid, ref.city_id, ref.type_id, ref.policy_id,
               'dash-emp-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x', 'published'
        FROM ref RETURNING id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Unit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id, property_id, currency_id
      ), cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('Dash Guest', 'dash-emp-guest-' || gen_random_uuid() || '@safra.test',
                '+963900000801', true)
        RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                            confirmed_at)
      SELECT cp.id, un.id, un.property_id, ${partnerId}::uuid, ref.city_id,
             greatest(date_trunc('month', now())::date, current_date),
             greatest(date_trunc('month', now())::date, current_date) + 2,
             2, 'confirmed'::booking_status,
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             un.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb,
             now() - interval '30 minute'
      FROM cp, un, ref
    `);

    /*
      A SCHEDULED transfer, so `payoutLine` has something to return.

      Without it the line is null for everybody and the two assertions below pass while proving
      nothing — the vacuity that made an earlier version of this file green over the defect it was
      written to catch. Money has to be on the record for withholding it to mean anything.

      The columns are what `partner_payouts`' own CHECK constraints demand of a `scheduled` row:
      `net = gross - fine`, and a release has to have happened. They rejected three shapes before
      this one, which is the table doing its job.
    */
    await db.execute(sql`
      INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end,
                                   gross_amount, fine_amount, net_amount, status,
                                   scheduled_for, released_at)
      VALUES (${partnerId}::uuid, (SELECT id FROM currencies LIMIT 1),
              date_trunc('month', now())::date, now()::date,
              1500.00, 260.00, 1240.00, 'scheduled',
              (now() + interval '3 days')::date, now())
    `);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /* The screen still works for them — this is about one field, not about access. */
  it('still gives an employee the operational dashboard', async () => {
    const view = await service.overview(employee());

    expect(view).toHaveProperty('pendingRequests');
    expect(view).toHaveProperty('calendar');
  });

  it('does not tell an employee about a scheduled transfer', async () => {
    const view = await service.overview(employee());

    expect(view.payout).toBeNull();
  });

  /**
   * The sharper of the two, and the one that was fixed from a code read rather than a failing test.
   *
   * «ما ربحته هذا الشهر» is almost word for word the sentence `PARTNER_EMPLOYEE_PERMISSIONS` uses
   * to explain why `PAYOUT_READ_OWN` is withheld — "a receptionist should not learn what the
   * business earns". A fix nothing exercises is the shape that has been wrong repeatedly today, so
   * this is the assertion that makes it a fixed bug rather than a believed one.
   */
  it('does not tell an employee what the business earned', async () => {
    const view = await service.overview(employee());

    expect(view.kpis.earnings).toBeNull();
  });

  it('still tells the owner what they earned', async () => {
    const view = await service.overview(owner());

    expect(view.kpis.earnings).not.toBeNull();
  });

  /*
    And the owner's own dashboard is untouched: withholding must not become hiding.

    This assertion is what keeps the one above honest. If the payout line were null for everybody —
    because the fixture has no money, or because a fix over-corrected — the employee test would
    pass while proving nothing.
  */
  it('still tells the owner about their scheduled transfer', async () => {
    const view = await service.overview(owner());

    expect(view.payout).not.toBeNull();
  });
});
