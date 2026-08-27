import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { ManualTransferProvider } from '../payments/providers/manual-transfer.provider.js';
import { PaymentProviderRegistry } from '../payments/providers/provider.registry.js';
import type { WalletAdjustmentService } from '../wallet/wallet-adjustment.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * §9.4's booking record stops at the edge of a member's city scope.
 *
 * ## The gap (`O-sec-13`, third instance, 2026-08-27)
 *
 * `detail()` took `claims` and used them only to decide whether the payments block and the internal
 * notes were included. The row itself came back for `b.reference = $1 AND b.deleted_at IS NULL` and
 * nothing else — so an operations manager scoped to one city opened ANY booking in the country by
 * typing its reference, and this screen carries the customer's name, email and phone, the partner's
 * phone, and the whole money breakdown. References are sequential (`BKG-2026-000388`), so finding
 * one is a loop rather than a guess.
 *
 * الحجوزات's LIST was scoped from the day scope was built. The row behind it was not, which is
 * exactly what `assertCanRead`'s own docblock warned about: «the reason the detail screens went
 * unscoped for so long is that the predicate looked like it covered everything».
 *
 * ## All three entry points, because the write ones are worse
 *
 * `compensate` credits a customer's WALLET and `addNote` writes to the record. Both resolved the
 * booking the same unscoped way. A suite that covered only `detail` would have left the two that
 * change something open.
 *
 * ## Every refusal has its opposite
 *
 * «Withheld» is indistinguishable from «absent» without a control that the right reader still
 * succeeds. Each case does the same call twice — once from outside the scope, once from inside it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a booking record outside a city scope', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let walletCredits = 0;

  const bookings = new BookingDetailService(
    db,
    new AuditService(db),
    new PaymentProviderRegistry(
      { PAYMENT_SIMULATOR_ENABLED: false } as never,
      null as never,
      new ManualTransferProvider(),
    ),
    /*
      A COUNTING stub rather than the real adjustment service.
      
      What this suite asserts about `compensate` is whether it is REACHED, and the counter answers
      that directly — a refusal that still credited a wallet would pass a test that only inspected
      the thrown error.
    */
    {
      adjust: () => {
        walletCredits += 1;

        return Promise.resolve({ balance: '10.000', currencyCode: 'USD' });
      },
    } as unknown as WalletAdjustmentService,
  );

  let home: string | null = null;
  let away: string | null = null;
  let ours = '';
  let theirs = '';
  let staffId = '';

  /** Restricted to `cities`, with no reach outside them. */
  const scopedTo = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'operations_manager',
      permissions: ['booking.read_all', 'booking.add_internal_note'],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'none' },
    }) as unknown as AccessTokenClaims;

  /** Restricted, but permitted to READ the rest of the country. */
  const readOnlyOutside = (...cityIds: (string | null)[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: 'operations_manager',
      permissions: ['booking.read_all', 'booking.add_internal_note'],
      scope: { kind: 'cities', cityIds: cityIds.filter(Boolean), outside: 'read_only' },
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    walletCredits = 0;

    const cities = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 2`);

    home = cities.rows[0]?.id ?? null;
    away = cities.rows[1]?.id ?? null;

    /* The fixture must be able to tell two cities apart, or it measures nothing. */
    expect(home, 'a city to be scoped to').toBeTruthy();
    expect(away, 'and a different one to be scoped away from').toBeTruthy();

    const staff = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('bscope-s-' || gen_random_uuid() || '@safra.test', '+963900000095',
              'operations_manager', 'active')
      RETURNING id::text`);

    staffId = staff.rows[0]?.id ?? '';
    ours = await seedBooking(home);
    theirs = await seedBooking(away);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* ── The read ─────────────────────────────────────────────────────────────────────────────── */

  it('refuses a booking in another city, and returns one in its own', async () => {
    await expect(bookings.detail(theirs, scopedTo(home))).rejects.toMatchObject({
      response: { code: ERROR.BOOKING_NOT_FOUND },
    });

    /* The control: the same call, for the city it belongs to. */
    const seen = await bookings.detail(ours, scopedTo(home));

    expect(seen.reference).toBe(ours);
  });

  /**
   * And the refusal is indistinguishable from a booking that does not exist.
   *
   * Same status AND same code. A post-fetch `assertCanRead` would have answered
   * `request.not_found` where a real miss answers `booking.not_found` — two codes behind two 404s,
   * which is a difference somebody can walk the sequential references with. That is why the
   * predicate is in the `WHERE` rather than a check after the row arrives.
   */
  it('answers a booking in another city exactly as one that does not exist', async () => {
    const shape = async (reference: string): Promise<unknown> =>
      bookings.detail(reference, scopedTo(home)).catch((error: unknown) => ({
        status: (error as { status?: number }).status,
        code: (error as { response?: { code?: string } }).response?.code,
      }));

    expect(await shape(theirs)).toStrictEqual(await shape('BKG-2026-000000'));
  });

  /** `read_only` means «you may look at the rest of the country», and this is that. */
  it('lets a read_only member read another city’s booking', async () => {
    const seen = await bookings.detail(theirs, readOnlyOutside(home));

    expect(seen.reference).toBe(theirs);
  });

  /* ── The two writes ───────────────────────────────────────────────────────────────────────── */

  it('refuses to compensate a customer on another city’s booking', async () => {
    await expect(
      bookings.compensate(
        theirs,
        { amount: '10.00', currency: 'USD', note: 'تعويض خارج النطاق.' },
        scopedTo(home),
      ),
    ).rejects.toMatchObject({ response: { code: ERROR.BOOKING_NOT_FOUND } });

    /* Not merely refused — never reached. A thrown error after a credit is still a credit. */
    expect(walletCredits, 'no wallet was touched').toBe(0);

    await bookings.compensate(
      ours,
      { amount: '10.00', currency: 'USD', note: 'تعويض داخل النطاق.' },
      scopedTo(home),
    );

    expect(walletCredits, 'and the one in scope went through').toBe(1);
  });

  /**
   * `read_only` may LOOK at another city's booking and may not compensate on it.
   *
   * The half a single refusal test would miss: were the write guard `assertCanRead`, this member
   * would be able to move money on a booking they are only permitted to read.
   */
  it('refuses a read_only member the compensation it can see', async () => {
    await expect(
      bookings.compensate(
        theirs,
        { amount: '10.00', currency: 'USD', note: 'تعويض بصلاحية قراءة.' },
        readOnlyOutside(home),
      ),
    ).rejects.toMatchObject({ response: { code: ERROR.SCOPE_OUTSIDE } });

    expect(walletCredits).toBe(0);
  });

  it('refuses to add a note to another city’s booking, and adds one to its own', async () => {
    await expect(
      bookings.addNote(theirs, 'ملاحظة خارج النطاق.', scopedTo(home)),
    ).rejects.toMatchObject({ response: { code: ERROR.BOOKING_NOT_FOUND } });

    await bookings.addNote(ours, 'ملاحظة داخل النطاق.', scopedTo(home));

    const notes = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM booking_internal_notes n
      JOIN bookings b ON b.id = n.booking_id
      WHERE b.reference IN (${ours}, ${theirs})`);

    expect(notes.rows[0]?.n, 'exactly the one that was in scope').toBe('1');
  });

  /** One booking, in a NAMED city, with everything it needs to exist. */
  async function seedBooking(cityId: string | null): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM currencies WHERE code = 'USD')  AS currency_id,
               (SELECT id FROM property_types LIMIT 1)         AS type_id,
               (SELECT id FROM partner_types LIMIT 1)          AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)  AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('bscope-c-' || gen_random_uuid() || '@safra.test', '+963900000096',
                'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('bscope-p-' || gen_random_uuid() || '@safra.test', '+963900000097',
                'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'عميل النطاق', 'bscope-cp-' || gen_random_uuid() || '@safra.test',
               '+963900000096', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Scope Test', 'نطاق', ${cityId}::uuid, 'x',
               '+963900000097', 'bscope-pa-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ${cityId}::uuid, ref.type_id, ref.policy_id,
               'bscope-' || gen_random_uuid(), 'عقار النطاق', 'Scope', 'Scope', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
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
      SELECT cp.id, un.id, pr.id, pr.partner_id, ${cityId}::uuid,
             current_date + 400, current_date + 402, 2, 'confirmed'::booking_status, now(),
             '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
             ref.currency_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
      FROM cp, un, pr, ref
      RETURNING reference`);

    const row = made.rows[0];

    if (!row) throw new Error('fixture booking was not created');

    return row.reference;
  }
});
