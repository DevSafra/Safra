import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { DisputeRequestService } from './dispute-request.service.js';
import { DisputeService } from '../admin/dispute.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * النزاعات from the asking side, against a real PostgreSQL.
 *
 * ## Why the boundary is most of this file
 *
 * Opening a dispute FREEZES the partner's payout for that booking — the console derives the freeze
 * from "does this booking have a dispute that is not resolved or rejected". So this is an endpoint
 * through which a customer stops money moving. If a caller could name a booking that is not theirs,
 * they could freeze a stranger's payout, repeatedly, for nothing.
 *
 * So the tests that matter are: somebody else's booking is a 404, an unpaid booking is refused, and a
 * second dispute of the same reason is refused. The happy path is one test; the boundary is five.
 *
 * ## And the freeze is asserted through the ADMIN service
 *
 * Not by reading the table. The freeze is what the payout run consults, so the assertion that means
 * anything is that `frozenBookingReferences` — the real function, the one the money path calls —
 * returns this booking once a dispute exists.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Long enough to pass the schema's minimum, and recognisable in an assertion. */
const ACCOUNT =
  'The apartment was locked when we arrived and nobody answered the phone all evening.';

describeIfDb('DisputeRequestService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const disputes = new DisputeRequestService(db);
  /*
    The real one the payout path uses, so the freeze is asserted rather than assumed.

    A real `AuditService` too. Only `frozenBookingReferences` is called here and it audits nothing,
    but a stub would be a claim about which methods audit — and that claim would be wrong the first
    time somebody adds a read that does.
  */
  const console_ = new DisputeService(
    db,
    new AuditService(db),
    new WalletService(db, new FxRateService(db, new AuditService(db))),
    new LedgerService(db),
    new FxRateService(db, new AuditService(db)),
    /* The notifier only announces a closure; these suites assert the closure itself. */
    { closed: () => Promise.resolve() } as never,
  );

  let profileId = '';
  let userId = '';
  let otherProfileId = '';
  let otherUserId = '';
  let partnerId = '';
  let paidBooking = '';
  let unpaidBooking = '';
  let othersBooking = '';

  const customer = (profile = profileId, sub = userId): AccessTokenClaims => ({
    sub,
    role: 'customer',
    permissions: [],
    locale: 'ar',
    customerProfileId: profile,
  });

  /** A partner has no customer profile, which is how the service refuses them. */
  const partner = (): AccessTokenClaims => ({
    sub: otherUserId,
    role: 'partner',
    permissions: [],
    locale: 'ar',
    partnerId,
  });

  const open = (overrides: Partial<Parameters<typeof disputes.open>[1]> = {}) =>
    disputes.open(customer(), {
      bookingReference: paidBooking,
      kind: 'property_unavailable',
      title: 'الشقة كانت مغلقة',
      description: ACCOUNT,
      ...overrides,
    });

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── Raising one ───────────────────────────────────────────────────────────

  it('opens a dispute on the customer’s own paid booking', async () => {
    const raised = await open();

    expect(raised.reference).toMatch(/^DSP-\d+$/);
    expect(raised.bookingReference).toBe(paidBooking);
    expect(raised.kind).toBe('property_unavailable');
    expect(raised.status).toBe('open');
    expect(raised.description).toContain('locked when we arrived');
    /* Nothing has been decided yet, so there is no resolution to show. */
    expect(raised.resolution).toBeNull();
    expect(raised.closedAt).toBeNull();
  });

  /**
   * The reason this endpoint is dangerous, and the assertion that it works.
   *
   * The freeze is derived rather than flagged, so this asks the function the payout run asks.
   */
  it('freezes the partner’s payout for that booking', async () => {
    expect(await console_.frozenBookingReferences()).not.toContain(paidBooking);

    await open();

    expect(await console_.frozenBookingReferences()).toContain(paidBooking);
  });

  it('records the partner and the customer from the BOOKING, not from the request', async () => {
    const raised = await open();

    const row = await db.execute<{ partner_id: string; customer_profile_id: string }>(sql`
      SELECT partner_id, customer_profile_id FROM disputes WHERE reference = ${raised.reference}
    `);

    expect(row.rows[0]?.partner_id).toBe(partnerId);
    expect(row.rows[0]?.customer_profile_id).toBe(profileId);
  });

  /**
   * `opened_by_user_id` stays NULL, which is the schema's stated meaning: it says a STAFF member
   * raised it. Writing the customer's id there would make that question unanswerable.
   */
  it('leaves opened_by_user_id null when the customer raises it', async () => {
    const raised = await open();

    const row = await db.execute<{ opened_by_user_id: string | null }>(sql`
      SELECT opened_by_user_id FROM disputes WHERE reference = ${raised.reference}
    `);

    expect(row.rows[0]?.opened_by_user_id).toBeNull();
  });

  // ─── The boundary ──────────────────────────────────────────────────────────

  /** A `BKG-` reference is sequential, so this must be indistinguishable from "does not exist". */
  it('is a 404 for somebody else’s booking', async () => {
    await expect(open({ bookingReference: othersBooking })).rejects.toMatchObject({
      status: 404,
    });
  });

  it('is a 404 for a booking that does not exist', async () => {
    await expect(open({ bookingReference: 'BKG-2000-000001' })).rejects.toMatchObject({
      status: 404,
    });
  });

  /**
   * Their own booking, and nothing has been paid — so a 400 that SAYS so, not a 404.
   *
   * The distinction is deliberate: 404 is the enumeration boundary, and this reader is looking at
   * their own booking and needs to know why the button did nothing.
   */
  it('refuses a booking nobody has paid for, and says why', async () => {
    await expect(open({ bookingReference: unpaidBooking })).rejects.toMatchObject({
      status: 400,
      response: { code: 'dispute.booking_not_disputable' },
    });
  });

  it('refuses a second dispute of the same reason while the first is open', async () => {
    await open();

    await expect(open()).rejects.toMatchObject({
      status: 400,
      response: { code: 'dispute.already_open' },
    });
  });

  /** The schema's own note: a booking can be disputed twice for DIFFERENT reasons. */
  it('allows a second dispute for a different reason', async () => {
    await open();

    const second = await open({ kind: 'not_as_described' });

    expect(second.kind).toBe('not_as_described');
  });

  /** Once answered, the reason is free again — the block is on a LIVE dispute, not on history. */
  it('allows the same reason again once the first is resolved', async () => {
    const first = await open();

    await db.execute(sql`
      UPDATE disputes SET status = 'resolved', resolution = 'Refunded in full.', closed_at = now()
      WHERE reference = ${first.reference}
    `);

    expect((await open()).reference).not.toBe(first.reference);
  });

  it('refuses a partner, who has no dispute reason to raise', async () => {
    await expect(
      disputes.open(partner(), {
        bookingReference: paidBooking,
        kind: 'complaint',
        title: 'شكوى',
        description: ACCOUNT,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('refuses an anonymous caller', async () => {
    await expect(
      disputes.open(undefined, {
        bookingReference: paidBooking,
        kind: 'complaint',
        title: 'شكوى',
        description: ACCOUNT,
      }),
    ).rejects.toMatchObject({ status: 401 });
  });

  // ─── Redaction ─────────────────────────────────────────────────────────────

  /**
   * Both prose fields are masked, and the count is reported.
   *
   * A dispute is where somebody is most likely to write "just call me" — they are upset and they want
   * a person. The rule is the same as everywhere else, and saying how many spans went is what stops
   * them waiting for a call that cannot come.
   */
  it('masks contact details in the title and the description', async () => {
    const raised = await open({
      title: 'اتصلوا بي على 0955123456',
      description: `${ACCOUNT} My number is 0955123456.`,
    });

    expect(raised.title).not.toContain('0955123456');
    expect(raised.description).not.toContain('0955123456');
    expect(raised.redactedCount).toBeGreaterThanOrEqual(2);
  });

  // ─── Reading them back ─────────────────────────────────────────────────────

  it('lists the caller’s own disputes and nobody else’s', async () => {
    const mine = await open();

    /* One raised by the other customer on their own booking. */
    await disputes.open(customer(otherProfileId, otherUserId), {
      bookingReference: othersBooking,
      kind: 'complaint',
      title: 'شكوى أخرى',
      description: ACCOUNT,
    });

    const listed = await disputes.list(customer(), { limit: 20 });
    const references = listed.items.map((item) => item.reference);

    expect(references).toContain(mine.reference);
    expect(references).toHaveLength(1);
  });

  it('is a 404 reading another customer’s dispute', async () => {
    const theirs = await disputes.open(customer(otherProfileId, otherUserId), {
      bookingReference: othersBooking,
      kind: 'complaint',
      title: 'شكوى أخرى',
      description: ACCOUNT,
    });

    await expect(disputes.detail(customer(), theirs.reference)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('refuses a malformed reference without reaching the table', async () => {
    await expect(disputes.detail(customer(), 'not-a-reference')).rejects.toMatchObject({
      status: 404,
    });
  });

  /** The resolution IS shown once staff close it: it is the answer they were waiting for. */
  it('shows the resolution once the dispute is closed', async () => {
    const raised = await open();

    await db.execute(sql`
      UPDATE disputes
      SET status = 'resolved', resolution = 'عُوّض العميل بالكامل.', closed_at = now()
      WHERE reference = ${raised.reference}
    `);

    const seen = await disputes.detail(customer(), raised.reference);

    expect(seen.status).toBe('resolved');
    expect(seen.resolution).toBe('عُوّض العميل بالكامل.');
    expect(seen.closedAt).not.toBeNull();
  });

  // ─── The form's picker ─────────────────────────────────────────────────────

  it('offers only the caller’s own paid bookings', async () => {
    const offered = await disputes.disputableBookings(customer());
    const references = offered.map((booking) => booking.reference);

    expect(references).toContain(paidBooking);
    /* Nothing paid for, and nothing belonging to anybody else. */
    expect(references).not.toContain(unpaidBooking);
    expect(references).not.toContain(othersBooking);
  });

  /**
   * Two customers, one partner, three bookings: one paid, one unpaid, one somebody else's.
   *
   * Built as one statement so the ids come back together and no test depends on another's fixtures.
   */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      profile_id: string;
      user_id: string;
      other_profile_id: string;
      other_user_id: string;
      partner_id: string;
      paid_reference: string;
      unpaid_reference: string;
      others_reference: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)            AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('dsp-one-' || gen_random_uuid() || '@safra.test', '+963900000080',
                'customer', 'active')
        RETURNING id
      ), cu2 AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('dsp-two-' || gen_random_uuid() || '@safra.test', '+963900000081',
                'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('dsp-partner-' || gen_random_uuid() || '@safra.test', '+963900000082',
                'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزاع واحد', 'dsp-one-' || gen_random_uuid() || '@safra.test',
               '+963900000080', false
        FROM cu RETURNING id
      ), cp2 AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu2.id, 'نزاع اثنان', 'dsp-two-' || gen_random_uuid() || '@safra.test',
               '+963900000081', false
        FROM cu2 RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Dispute Test', 'نزاع', ref.city_id, 'x',
               '+963900000082', 'dsp-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'dsp-test-' || gen_random_uuid(), 'عقار النزاع', 'Dispute', 'Streit', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id, property_id
      ), paid AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 10, current_date - 8, 2, 'completed'::booking_status, now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING reference
      ), unpaid AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 40, current_date + 42, 2, 'pending_payment'::booking_status,
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING reference
      ), others AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp2.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date - 30, current_date - 28, 2, 'completed'::booking_status, now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp2, un, pr, ref RETURNING reference
      )
      SELECT cp.id AS profile_id, cu.id AS user_id,
             cp2.id AS other_profile_id, cu2.id AS other_user_id,
             pa.id AS partner_id,
             paid.reference AS paid_reference,
             unpaid.reference AS unpaid_reference,
             others.reference AS others_reference
      FROM cp, cu, cp2, cu2, pa, paid, unpaid, others
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    profileId = row.profile_id;
    userId = row.user_id;
    otherProfileId = row.other_profile_id;
    otherUserId = row.other_user_id;
    partnerId = row.partner_id;
    paidBooking = row.paid_reference;
    unpaidBooking = row.unpaid_reference;
    othersBooking = row.others_reference;
  }
});
