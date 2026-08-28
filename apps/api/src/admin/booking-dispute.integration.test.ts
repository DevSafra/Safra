import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { DisputeService } from './dispute.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A dispute opened from the booking screen, and the four consequences that follow it.
 *
 * ## What this is really protecting
 *
 * Bashar asked for the booking's status to follow reality (2026-08-25), and moving a booking into
 * `disputed` has one implication that is far larger than the label: **`disputed` was not in
 * `BLOCKING_STATUSES`**. A live booking leaving `confirmed` or `checked_in` for a status outside
 * the exclusion constraint would have released its nights for sale — while the guest disputing the
 * room was still standing in it. EC-006 and EC-007 are raised ON ARRIVAL, so that is the ordinary
 * case, not the edge one.
 *
 * So the assertion that matters most here is not "the status moved". It is «the dates are still
 * held», asked of the database rather than of a list in TypeScript: a second booking for the same
 * unit and the same nights must still be refused.
 *
 * ## And the way back
 *
 * §6.2 defines `Disputed` as a booking that HAS an open dispute. Closing the last one makes that
 * untrue, so the overlay has to lift — and if it did not, the booking would sit outside
 * `PayoutService`'s `status = 'completed'` predicate for ever, silently, and the partner would
 * never be paid for a stay that was resolved in their favour.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const STAFF = (sub: string): AccessTokenClaims =>
  ({
    sub,
    role: 'operations_manager',
    permissions: ['dispute.manage'],
  }) as unknown as AccessTokenClaims;

/** The same member, but able to write in ONE named city and nowhere else. */
const SCOPED = (sub: string, cityId: string): AccessTokenClaims =>
  ({
    sub,
    role: 'operations_manager',
    permissions: ['dispute.manage'],
    scope: { kind: 'cities', cityIds: [cityId], outside: 'none' },
  }) as unknown as AccessTokenClaims;

describeIfDb('a dispute opened on a booking', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const disputes = new DisputeService(
    db,
    new AuditService(db),
    new WalletService(db, new FxRateService(db, new AuditService(db))),
    new LedgerService(db),
    new FxRateService(db, new AuditService(db)),
    /* The notifier only announces a closure; these suites assert the closure itself. */
    { closed: () => Promise.resolve() } as never,
  );

  let reference = '';
  let staffId = '';
  let checkIn = '';
  let checkOut = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const statusOf = async (ref: string): Promise<string> => {
    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM bookings WHERE reference = ${ref}
    `);

    return rows.rows[0]?.status ?? '';
  };

  /** This booking's only dispute — the fixture opens exactly one. */
  const onlyReference = async (): Promise<string> => {
    const rows = await db.execute<{ reference: string }>(sql`
      SELECT d.reference FROM disputes d
      JOIN bookings b ON b.id = d.booking_id
      WHERE b.reference = ${reference}
      ORDER BY d.created_at DESC LIMIT 1
    `);

    const only = rows.rows[0];

    if (!only) throw new Error('the fixture opened no dispute');

    return only.reference;
  };

  const disputeRow = async (): Promise<{
    status: string;
    assigned_to_user_id: string | null;
  }> => {
    const rows = await db.execute<{
      status: string;
      assigned_to_user_id: string | null;
    }>(sql`
      SELECT d.status::text AS status, d.assigned_to_user_id::text AS assigned_to_user_id
      FROM disputes d
      JOIN bookings b ON b.id = d.booking_id
      WHERE b.reference = ${reference}
      ORDER BY d.created_at DESC LIMIT 1
    `);

    const only = rows.rows[0];

    if (!only) throw new Error('the fixture opened no dispute');

    return only;
  };

  /**
   * Whether THIS booking's payout is frozen, asked the way `PayoutService` asks it.
   *
   * Counted rather than listed so «still frozen» is a number that cannot quietly become a
   * different booking's freeze.
   */
  const frozenCount = async (): Promise<number> => {
    const rows = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM disputes d
      JOIN bookings b ON b.id = d.booking_id
      WHERE b.reference = ${reference}
        AND d.status IN ('open', 'investigating') AND d.deleted_at IS NULL
    `);

    return Number(rows.rows[0]?.n ?? 0);
  };

  const open = (kind = 'not_as_described') =>
    disputes.openForBooking(STAFF(staffId), {
      bookingReference: reference,
      kind,
      title: 'الغرفة لا تطابق الوصف',
      description: 'أفاد العميل بأن الغرفة أصغر بكثير مما ظهر في الصور المنشورة.',
    });

  /**
   * The account a staff member takes down reaches the QUEUE they will read it from.
   *
   * `openForBooking` and the customer's own route both store a `description`, redacted on the way
   * in — and until 2026-08-27 no staff surface selected it. The queue showed a 120-character title,
   * the booking screen showed a count, and that was the whole of what an operator had while
   * deciding to uphold a complaint, release a frozen payout and credit somebody's wallet. Measured
   * that day: 22 of 22 open disputes carried one and not one was on a screen.
   *
   * Asserted through `list()` rather than by reading the column, because the column was never the
   * problem — the projection was. A test on the row would have passed throughout.
   */
  it('carries the account somebody gave into the queue', async () => {
    await open();

    /*
      FILTERED to this booking, not page one of everything.
    
      Written as `page: 1, limit: 25` first, which passed alone and failed inside `pnpm verify` the
      same hour: the queue puts unresolved disputes oldest-first, so a dispute created just now
      sorts LAST among them — and once the shared database held more than 25 open disputes it fell
      off page one. A test whose subject has to be in the first 25 rows of a table other suites
      write to is asserting about the size of the backlog, not about the projection.
    */
    const queue = await disputes.list({
      page: 1,
      limit: 25,
      q: reference,
      actor: STAFF(staffId),
    });
    const mine = queue.items.find((row) => row.bookingReference === reference);

    expect(mine, 'the dispute is in the queue').toBeDefined();
    expect(mine?.description, 'and the queue carries what was said').toBe(
      'أفاد العميل بأن الغرفة أصغر بكثير مما ظهر في الصور المنشورة.',
    );

    /* The control: the title is NOT the description, so this cannot pass by reading the headline. */
    expect(mine?.title).not.toBe(mine?.description);
  });

  /**
   * ── «استلام»: taking a dispute (Bashar, 2026-08-27) ─────────────────────
   *
   * He asked for a control on every dispute that brings the sidebar badge down. The assertion that
   * matters is the PAIR: the badge stops counting it AND the partner's money stays frozen. A button
   * that only did the first would report an empty queue over money the platform is still holding,
   * which is the failure this whole design exists to prevent.
   */
  it('takes a dispute without releasing the money', async () => {
    await open();

    const before = await frozenCount();

    await disputes.acknowledge(STAFF(staffId), await onlyReference());

    const row = await disputeRow();

    expect(row.status, 'somebody has it now').toBe('investigating');
    expect(row.assigned_to_user_id, 'and the row says who').toBe(staffId);

    /*
      The half that must NOT move. `frozenBookingReferences` is what stops a payout, and it reads
      the same UNRESOLVED set — so taking a dispute has to leave it exactly as it was.
    */
    expect(await frozenCount(), 'the payout is still frozen').toBe(before);
  });

  /** Taking one that is already taken changes nothing and writes no audit row. */
  it('is idempotent, and does not audit a second take', async () => {
    await open();

    const reference = await onlyReference();

    expect(await disputes.acknowledge(STAFF(staffId), reference)).toStrictEqual({
      acknowledged: true,
    });
    expect(await disputes.acknowledge(STAFF(staffId), reference)).toStrictEqual({
      acknowledged: false,
    });

    /* Scoped to THIS dispute: `audit_log` is append-only and shared with every other suite. */
    const audited = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM audit_log a
      JOIN disputes d ON d.id = a.subject_id
      WHERE a.action = 'dispute.acknowledged' AND d.reference = ${reference}
    `);

    expect(audited.rows[0]?.n, 'one take, one row').toBe('1');
  });

  /** A settled dispute cannot be taken — that is a conflict, not a no-op. */
  it('refuses to take a dispute that is already closed', async () => {
    await open();

    const reference = await onlyReference();

    await disputes.close(STAFF(staffId), reference, {
      outcome: 'rejected',
      resolution: 'تم البت في الشكوى بعد مراجعة الأدلة.',
    });

    await expect(disputes.acknowledge(STAFF(staffId), reference)).rejects.toMatchObject({
      response: { code: ERROR.DISPUTE_ALREADY_CLOSED },
    });
  });

  /** Out of scope answers exactly as absent, and the dispute is untouched. */
  it('refuses a dispute in a city this reader cannot see', async () => {
    await open();

    const reference = await onlyReference();
    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL LIMIT 1 OFFSET 1
    `);
    const other = elsewhere.rows[0]?.id;

    if (!other) throw new Error('the fixture needs a second city');

    await expect(
      disputes.acknowledge(SCOPED(staffId, other), reference),
    ).rejects.toMatchObject({ response: { code: ERROR.DISPUTE_NOT_FOUND } });

    /* The control: it is still open, so the refusal withheld rather than failed. */
    expect((await disputeRow()).status).toBe('open');
  });

  it('moves the booking to disputed', async () => {
    await open();

    expect(await statusOf(reference)).toBe('disputed');
  });

  /**
   * The consequence that decided the design, asked of the DATABASE.
   *
   * Watched to fail: with `disputed` left out of the exclusion constraint's predicate, this insert
   * succeeds — and that is a second customer sold the nights somebody is currently disputing from
   * inside the room.
   */
  it('still holds the unit for those nights', async () => {
    await open();

    const overlapping = db.execute(sql`
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
             ${checkIn}::date, ${checkOut}::date, 2, 'pending_payment'::booking_status,
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             b.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
      FROM bookings b WHERE b.reference = ${reference}
    `);

    await expect(
      overlapping,
      'the nights must still be held while the stay is disputed',
    ).rejects.toThrow();
  });

  /** The control on the test above: the same insert on FREE nights succeeds. */
  it('holds only its own nights', async () => {
    await open();

    await expect(
      db.execute(sql`
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
               ${checkOut}::date + 30, ${checkOut}::date + 33, 2,
               'pending_payment'::booking_status,
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               b.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM bookings b WHERE b.reference = ${reference}
      `),
    ).resolves.toBeDefined();
  });

  it('records who opened it, and that staff did', async () => {
    const view = await open();

    const rows = await db.execute<{ opened_by: string | null }>(sql`
      SELECT opened_by_user_id AS opened_by FROM disputes WHERE reference = ${view.reference}
    `);

    expect(
      rows.rows[0]?.opened_by,
      'the column exists to say a STAFF member raised it',
    ).toBe(staffId);
  });

  /** Closing the last one lifts the overlay and puts the booking back where it was. */
  it('returns the booking to where it was when the dispute closes', async () => {
    const view = await open();

    expect(await statusOf(reference)).toBe('disputed');

    await disputes.close(STAFF(staffId), view.reference, {
      outcome: 'rejected',
      resolution: 'روجعت الصور ووُجدت مطابقة للوحدة المحجوزة.',
    });

    expect(
      await statusOf(reference),
      'the booking was checked in when the dispute opened',
    ).toBe('checked_in');
  });

  /**
   * And NOT while another is still open.
   *
   * A booking may carry two disputes of different kinds. Lifting the overlay on the first closure
   * would put it back in the payout accrual with a live complaint against it — and relying on the
   * accrual's own `NOT EXISTS` clause to catch that is relying on the second guard to cover the
   * first one being wrong.
   */
  it('stays disputed while a second dispute is still open', async () => {
    const first = await open('not_as_described');

    await open('complaint');

    await disputes.close(STAFF(staffId), first.reference, {
      outcome: 'resolved',
      resolution: 'عولجت الشكوى الأولى وبقيت الثانية قيد المراجعة.',
    });

    expect(await statusOf(reference)).toBe('disputed');
  });

  it('refuses a second dispute of the same kind while the first is open', async () => {
    await open('not_as_described');

    await expect(open('not_as_described')).rejects.toThrow();
  });

  it('refuses a dispute on a booking nothing has been paid for', async () => {
    await db.execute(sql`
      UPDATE bookings SET status = 'pending_payment', paid_at = NULL
      WHERE reference = ${reference}
    `);

    await expect(open()).rejects.toThrow();
  });

  /** One paid, checked-in booking — the state EC-007 is raised from. */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      reference: string;
      staff: string;
      check_in: string;
      check_out: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), st AS (
        INSERT INTO users (full_name, email, phone, role, status)
        VALUES ('مدير العمليات', 'dsp-s-' || gen_random_uuid() || '@safra.test',
                '+963900000081', 'operations_manager', 'active')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('dsp-c-' || gen_random_uuid() || '@safra.test', '+963900000082', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('dsp-p-' || gen_random_uuid() || '@safra.test', '+963900000083', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل النزاع', 'dsp-c-' || gen_random_uuid() || '@safra.test',
               '+963900000082', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Dispute Test', 'نزاع', ref.city_id, 'x',
               '+963900000083', 'dsp-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'dispute-test-' || gen_random_uuid(), 'عقار النزاع', 'Dispute', 'Dispute', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.currency_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, checked_in_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 500, current_date + 503, 2, 'checked_in'::booking_status,
               now(), now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref
        RETURNING reference, unit_id, check_in::text AS check_in, check_out::text AS check_out
      )
      SELECT bk.reference, st.id AS staff, bk.check_in, bk.check_out
      FROM bk, st
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    reference = row.reference;
    staffId = row.staff;
    checkIn = row.check_in;
    checkOut = row.check_out;
  }
});
