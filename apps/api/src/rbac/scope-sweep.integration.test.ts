import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { PartnerApplicationService } from '../partner/partner-application.service.js';
import { PayoutService } from '../payouts/payout.service.js';
import { RefundService } from '../payments/refund.service.js';
import { ReviewService as AdminReviewService } from '../admin/review.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The `O-sec-13` pass, as behaviour: the services this sweep newly scoped, refusing across cities.
 *
 * ## Why this file exists beside `scope-coverage.test.ts`
 *
 * That one answers «is there a route nobody has thought about» by reading the tree. It cannot tell
 * a `scopeFilter` on the right column from one on the wrong column — it only sees that the symbol
 * is present. This one runs the query.
 *
 * Both are needed and neither substitutes for the other. Four unscoped services were found by hand
 * over three weeks and eleven more in one pass on 2026-08-27; the static sweep is what stops a
 * twelfth being added, and this is what stops the eleven being «fixed» in name only.
 *
 * ## Every refusal has its opposite
 *
 * A service that refused everybody would satisfy every refusal here on its own, so each case does
 * the same call twice — once from outside the scope, once from inside it. That discipline is the
 * reason `security tests need an opposite control` is written where it is.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the O-sec-13 sweep, in behaviour', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let home: string | null = null;
  let away: string | null = null;
  let staffId = '';
  let run = 0;

  const scopedTo = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'operations_manager',
      permissions: ['booking.read_all', 'payout.read', 'review.moderate'],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'none' },
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    run += 1;

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 2`);

    home = cities.rows[0]?.id ?? null;
    away = cities.rows[1]?.id ?? null;

    /* Two distinguishable cities, or nothing below measures anything. */
    expect(home, 'a city to be scoped to').toBeTruthy();
    expect(away, 'and a different one to be scoped away from').toBeTruthy();

    const staff = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('sweep-s-' || gen_random_uuid() || '@safra.test', '+963900000110',
              'operations_manager', 'active')
      RETURNING id::text`);

    staffId = staff.rows[0]?.id ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* ── Refunds — money back to a customer ───────────────────────────────────────────────────── */

  it('refuses a refund quote on another city’s booking, and answers one in its own', async () => {
    /* Only `db` is exercised: `quote` reads and computes, and never reaches a provider. */
    const refunds = new RefundService(
      db,
      {} as never,
      {} as never,
      new AuditService(db),
      {} as never,
      {} as never,
      {} as never,
    );

    const theirs = await booking(away);
    const ours = await booking(home);

    await expect(refunds.quote(theirs, scopedTo(home))).rejects.toMatchObject({
      response: { code: ERROR.BOOKING_NOT_FOUND },
    });

    /* The control: the same call for a booking in the reader's own city. */
    const quoted = await refunds.quote(ours, scopedTo(home));

    expect(quoted).toBeTruthy();
  });

  /* ── Payouts — money that left the company ────────────────────────────────────────────────── */

  it('shows a payout to its own region and refuses to mark another’s paid', async () => {
    const payouts = new PayoutService(db, new AuditService(db), {} as never, {} as never);

    const mine = await payout(home);
    const other = await payout(away);

    const page = await payouts.listForStaff({ limit: 25, page: 1 }, scopedTo(home));
    const seen = page.items.map((row) => (row as { reference: string }).reference);

    expect(seen, 'the payout in scope is listed').toContain(mine.reference);
    expect(seen, 'and the one outside it is not').not.toContain(other.reference);

    await expect(
      payouts.markPaid(other.id, { paidReference: 'TRF-1' }, scopedTo(home)),
    ).rejects.toMatchObject({ response: { code: ERROR.PAYOUT_NOT_FOUND } });

    /* Untouched: a refusal that still moved the row would pass an assertion about the error. */
    const after = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM partner_payouts WHERE id = ${other.id}::uuid`);

    expect(after.rows[0]?.status).toBe('scheduled');
  });

  /* ── Review moderation — hiding somebody's words ──────────────────────────────────────────── */

  it('refuses to moderate a review about another city’s property', async () => {
    const { ReviewService } = await import('../reviews/review.service.js');
    const reviews = new ReviewService(db, new AuditService(db), {} as never, {} as never);

    const theirs = await review(away);
    const ours = await review(home);

    await expect(
      reviews.moderate(scopedTo(home), theirs, {
        decision: 'uphold',
        note: 'خارج النطاق.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.REVIEW_NOT_FOUND } });

    const queue = await reviews.listReported({ limit: 25, page: 1 }, scopedTo(home));
    const listed = queue.items.map((row) => (row as { reference: string }).reference);

    expect(listed, 'the one in scope is in the queue').toContain(ours);
    expect(listed, 'the one outside it is not').not.toContain(theirs);
  });

  /* ── Partnership requests — accepting one creates a partner ───────────────────────────────── */

  it('refuses to read or accept a request from another city', async () => {
    const applications = new PartnerApplicationService(
      db,
      new AuditService(db),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    const theirs = await application(away);
    const ours = await application(home);

    await expect(applications.detail(theirs, scopedTo(home))).rejects.toMatchObject({
      response: { code: ERROR.PARTNER_APPLICATION_NOT_FOUND },
    });

    const seen = await applications.detail(ours, scopedTo(home));

    expect(seen.reference).toBe(ours);
  });

  /* ── The badges beside the queues ─────────────────────────────────────────────────────────── */

  it('counts only what the reader could open', async () => {
    const review = new AdminReviewService(
      db,
      new AuditService(db),
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await application(away);
    await application(away);

    const mine = await review.attentionCounts(scopedTo(home));
    const everything = await review.attentionCounts(undefined);

    expect(
      Number(everything['partner_applications_open']),
      'the unscoped count sees the two just made',
    ).toBeGreaterThanOrEqual(2);

    expect(
      Number(mine['partner_applications_open']),
      'and the scoped one does not',
    ).toBeLessThan(Number(everything['partner_applications_open']));
  });

  /* ── Fixtures ─────────────────────────────────────────────────────────────────────────────── */

  async function partnerIn(cityId: string | null): Promise<{ id: string }> {
    const email = `sweep-p-${process.pid}-${run}-${Math.random().toString(36).slice(2)}@safra.test`;
    const made = await db.execute<{ id: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES (${email}, '+963900000111', 'partner', 'active') RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Sweep', 'مسح', ${cityId}::uuid,
             'x', '+963900000111', ${email}, 'approved'
      FROM u RETURNING id::text`);

    const row = made.rows[0];

    if (!row) throw new Error('fixture partner was not created');

    return row;
  }

  /** A published property, its unit, and a confirmed booking on it — all in one named city. */
  async function stay(cityId: string | null) {
    const partner = await partnerIn(cityId);
    const made = await db.execute<{
      reference: string;
      property_id: string;
      unit_id: string;
      customer_profile_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM currencies WHERE code = 'USD') AS currency_id,
               (SELECT id FROM property_types LIMIT 1)        AS type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('sweep-c-' || gen_random_uuid() || '@safra.test', '+963900000112',
                'customer', 'active') RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'عميل المسح', 'sweep-cp-' || gen_random_uuid() || '@safra.test',
               '+963900000112', false FROM cu RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT ${partner.id}::uuid, ${cityId}::uuid, ref.type_id, ref.policy_id,
               'sweep-' || gen_random_uuid(), 'عقار', 'Prop', 'Prop', 'x', 'published'
        FROM ref RETURNING id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status, paid_at,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT cp.id, un.id, pr.id, ${partner.id}::uuid, ${cityId}::uuid,
             current_date + 500, current_date + 502, 2, 'confirmed'::booking_status, now(),
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
      FROM cp, un, pr, ref
      RETURNING reference, property_id, unit_id, customer_profile_id`);

    const row = made.rows[0];

    if (!row) throw new Error('fixture booking was not created');

    return { ...row, partnerId: partner.id };
  }

  const booking = async (cityId: string | null): Promise<string> =>
    (await stay(cityId)).reference;

  /** A scheduled payout for a partner in a named city. */
  async function payout(
    cityId: string | null,
  ): Promise<{ id: string; reference: string }> {
    const partner = await partnerIn(cityId);
    const made = await db.execute<{ id: string; reference: string }>(sql`
      INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end,
                                   gross_amount, fine_amount, net_amount, status, scheduled_for,
                                   released_at, released_by_user_id)
      SELECT ${partner.id}::uuid, (SELECT id FROM currencies WHERE code = 'USD'),
             current_date - 30, current_date - 1, '100.00', '0.00', '100.00',
             -- scheduled requires a release: partner_payouts_released_evidence.
             -- (No backticks in a comment inside a sql template: one would end the string.)
             'scheduled'::payout_status, current_date, now(), ${staffId}::uuid
      RETURNING id::text, reference`);

    const row = made.rows[0];

    if (!row) throw new Error('fixture payout was not created');

    return row;
  }

  /** A reported review on a property in a named city. */
  async function review(cityId: string | null): Promise<string> {
    const made = await stay(cityId);
    const row = await db.execute<{ reference: string }>(sql`
      INSERT INTO reviews (booking_id, property_id, unit_id, partner_id, customer_profile_id,
                           rating, body, status, report_status, reported_at)
      SELECT b.id, ${made.property_id}::uuid, ${made.unit_id}::uuid, ${made.partnerId}::uuid,
             ${made.customer_profile_id}::uuid, 3, 'تعليق للاختبار.',
             'published'::review_status, 'open'::review_report_status, now()
      FROM bookings b WHERE b.reference = ${made.reference}
      RETURNING reference`);

    const made2 = row.rows[0];

    if (!made2) throw new Error('fixture review was not created');

    return made2.reference;
  }

  /** A partnership request naming a city. */
  async function application(cityId: string | null): Promise<string> {
    const email = `sweep-a-${process.pid}-${run}-${Math.random().toString(36).slice(2)}@safra.test`;
    const made = await db.execute<{ reference: string }>(sql`
      INSERT INTO partner_applications
        (contact_name, email, phone, legal_name, display_name, partner_type_id, city_id,
         address, property_count, preferred_locale, status)
      SELECT 'مقدّم الطلب', ${email}, '+963900000113', 'Sweep Legal', 'مسح',
             (SELECT id FROM partner_types LIMIT 1), ${cityId}::uuid, 'x', 1, 'ar',
             'submitted'::partner_application_status
      RETURNING reference`);

    const row = made.rows[0];

    if (!row) throw new Error('fixture application was not created');

    return row.reference;
  }
});
