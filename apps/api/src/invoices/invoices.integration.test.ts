import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { InvoicesService } from './invoices.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * الفواتير against a real PostgreSQL (handoff §6).
 *
 * Everything worth proving here is in SQL — the scope predicate, the `draft` exclusion, a keyset page,
 * and figures that must arrive EXACTLY as stored. A mock would assert that the service called a method
 * and would happily pass while returning a total that had been through a float.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const USER_ID = '99990000-0000-0000-0000-00000000ac01';
const PROFILE_ID = '99990000-0000-0000-0000-00000000ac02';
const OTHER_USER_ID = '99990000-0000-0000-0000-00000000ac03';
const OTHER_PROFILE_ID = '99990000-0000-0000-0000-00000000ac04';
const PARTNER_USER_ID = '99990000-0000-0000-0000-00000000ac05';
const PARTNER_ID = '99990000-0000-0000-0000-00000000ac06';

const SLUG = 'inv-test-property';

/** Fixed references, so a test can name the row it means. */
const PAID = 'INV-TEST-PAID';
const UNPAID = 'INV-TEST-UNPAID';
const DISCOUNTED = 'INV-TEST-DISCOUNTED';
const DRAFT = 'INV-TEST-DRAFT';
const DELETED = 'INV-TEST-DELETED';
const OTHERS = 'INV-TEST-OTHERS';

const customer = (profileId = PROFILE_ID, sub = USER_ID): AccessTokenClaims => ({
  sub,
  role: 'customer',
  permissions: [],
  locale: 'ar',
  customerProfileId: profileId,
});

/** A staff token: a real role, no customer profile, and therefore no receipts of its own. */
const staff: AccessTokenClaims = {
  sub: PARTNER_USER_ID,
  role: 'super_admin',
  permissions: [],
  locale: 'ar',
};

describeIfDb('InvoicesService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: InvoicesService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new InvoicesService(db);
    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  // ─── list ──────────────────────────────────────────────────────────────────

  it('lists the caller’s own receipts, newest first', async () => {
    const page = await service.list(customer(), { limit: 20 });

    /* Four receiptable bookings: the draft, the deleted one and the other customer's are all out. */
    expect(page.items.map((item) => item.reference)).toStrictEqual([
      DISCOUNTED,
      UNPAID,
      PAID,
    ]);
    expect(page.nextCursor).toBeNull();
  });

  it('carries the names in every language, unpicked', async () => {
    const page = await service.list(customer(), { limit: 20 });
    const first = page.items.find((item) => item.reference === PAID);

    /* Pre-picking with `coalesce(name_ar, name_en)` is the bug this shape prevents. */
    expect(first?.property).toStrictEqual({
      slug: SLUG,
      nameAr: 'فاتورة',
      nameEn: 'Invoice Test',
      nameDe: 'Rechnungstest',
    });
    expect(first?.city?.nameAr).toBe('دمشق');
  });

  /**
   * The total is the STORED total, character for character.
   *
   * This is the assertion the whole design exists for: `201.99` must not come back as `201.99000001`,
   * as `202`, or as a number at all. A receipt that disagrees with the charge is worse than no receipt.
   */
  it('returns every amount as the exact stored decimal string', async () => {
    const page = await service.list(customer(), { limit: 20 });
    const paid = page.items.find((item) => item.reference === PAID);

    expect(paid?.totalAmount).toBe('201.990');
    expect(paid?.currencyCode).toBe('USD');
    expect(typeof paid?.totalAmount).toBe('string');
  });

  it('excludes a draft booking, which was never a transaction', async () => {
    const page = await service.list(customer(), { limit: 20 });

    expect(page.items.map((item) => item.reference)).not.toContain(DRAFT);
  });

  it('excludes a soft-deleted booking', async () => {
    const page = await service.list(customer(), { limit: 20 });

    expect(page.items.map((item) => item.reference)).not.toContain(DELETED);
  });

  it('never shows another customer’s receipt', async () => {
    const mine = await service.list(customer(), { limit: 20 });
    const theirs = await service.list(customer(OTHER_PROFILE_ID, OTHER_USER_ID), {
      limit: 20,
    });

    expect(mine.items.map((item) => item.reference)).not.toContain(OTHERS);
    expect(theirs.items.map((item) => item.reference)).toStrictEqual([OTHERS]);
  });

  it('reports whether each receipt was paid', async () => {
    const page = await service.list(customer(), { limit: 20 });

    expect(page.items.find((item) => item.reference === PAID)?.paidAt).not.toBeNull();
    expect(page.items.find((item) => item.reference === UNPAID)?.paidAt).toBeNull();
  });

  /** A page boundary must neither repeat nor skip a row — the keyset carries `(created_at, id)`. */
  it('pages with a cursor without repeating or losing a row', async () => {
    const first = await service.list(customer(), { limit: 2 });

    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const second = await service.list(customer(), {
      limit: 2,
      cursor: first.nextCursor ?? undefined,
    });

    const seen = [...first.items, ...second.items].map((item) => item.reference);

    expect(seen).toStrictEqual([DISCOUNTED, UNPAID, PAID]);
    expect(new Set(seen).size).toBe(seen.length);
    expect(second.nextCursor).toBeNull();
  });

  it('refuses a forged cursor rather than crashing on the cast', async () => {
    await expect(
      service.list(customer(), { limit: 20, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('refuses an anonymous caller', async () => {
    await expect(service.list(undefined, { limit: 20 })).rejects.toMatchObject({
      status: 401,
    });
  });

  /* A staff token is a valid token with no customer account behind it. */
  it('refuses a token with no customer profile', async () => {
    await expect(service.list(staff, { limit: 20 })).rejects.toMatchObject({
      status: 404,
    });
  });

  // ─── one ───────────────────────────────────────────────────────────────────

  it('returns one receipt with its breakdown', async () => {
    const invoice = await service.one(customer(), PAID);

    expect(invoice.reference).toBe(PAID);
    expect(invoice.totalAmount).toBe('201.990');
    expect(invoice.nights).toBe(2);
    expect(invoice.lines).toStrictEqual([
      { key: 'accommodation', amount: '200.000', deduction: false },
      { key: 'serviceFee', amount: '1.990', deduction: false },
    ]);
  });

  /**
   * The API itemises the fee whatever `commission.customer_fee_visible` says.
   *
   * Bashar, 2026-09-04: *"Hiding the fee must only affect customer-facing presentation. The
   * ledger, invoices and staff-facing views must remain correct."* So the setting must not reach
   * this service at all — the customer app folds the line when it renders, and the staff console,
   * the ledger and this payload keep the charge itemised.
   *
   * Written as an opposite control rather than as an absence: asserting that `invoices.service.ts`
   * does not mention the key would pass on a file that read it through a helper. Setting the value
   * BOTH ways and demanding an identical payload is the assertion that cannot be satisfied by a
   * service that consults it.
   */
  it.each([true, false])(
    'itemises the fee whether or not the customer is shown it (%s)',
    async (visible) => {
      await db.execute(sql`
        UPDATE settings SET value = ${JSON.stringify(visible)}::jsonb
        WHERE key = 'commission.customer_fee_visible'
      `);

      const invoice = await service.one(customer(), PAID);

      expect(invoice.lines).toStrictEqual([
        { key: 'accommodation', amount: '200.000', deduction: false },
        { key: 'serviceFee', amount: '1.990', deduction: false },
      ]);
      expect(invoice.totalAmount).toBe('201.990');
    },
  );

  /**
   * A zero line is dropped; a non-zero deduction is flagged rather than negated.
   *
   * The amount must stay identical to the stored value — the minus belongs to the reader's locale, not
   * to the figure, and a negated string would break `formatMoney`'s Intl formatting.
   */
  it('drops zero lines and flags real deductions', async () => {
    const invoice = await service.one(customer(), DISCOUNTED);

    expect(invoice.lines).toStrictEqual([
      { key: 'accommodation', amount: '200.000', deduction: false },
      { key: 'serviceFee', amount: '1.990', deduction: false },
      { key: 'discount', amount: '25.000', deduction: true },
      { key: 'wallet', amount: '10.000', deduction: true },
    ]);
    /* `gift_card_amount` is 0 on this booking, so no gift-card line at all. */
    expect(invoice.lines.map((line) => line.key)).not.toContain('giftCard');
  });

  /**
   * The lines do NOT have to sum to the total, and nothing asserts that they do.
   *
   * 200.00 + 1.99 − 25.00 − 10.00 is 166.99, and the stored total is 176.99: this fixture is
   * deliberately inconsistent, because a booking priced under an older fee rule is allowed to be. The
   * receipt reports what was charged.
   */
  it('prints the stored total even when the lines do not add up to it', async () => {
    const invoice = await service.one(customer(), DISCOUNTED);

    const summed = invoice.lines.reduce(
      (total, line) => total + (line.deduction ? -1 : 1) * Number(line.amount),
      0,
    );

    expect(summed).not.toBeCloseTo(Number(invoice.totalAmount));
    expect(invoice.totalAmount).toBe('176.990');
  });

  it('lists every payment attempt, failures included, oldest first', async () => {
    const invoice = await service.one(customer(), PAID);

    expect(invoice.payments.map((payment) => payment.status)).toStrictEqual([
      'failed',
      'captured',
    ]);
    expect(invoice.payments[1]?.amount).toBe('201.990');
    expect(invoice.payments[1]?.currencyCode).toBe('USD');
    expect(invoice.payments[1]?.capturedAt).not.toBeNull();
    expect(invoice.payments[0]?.capturedAt).toBeNull();
  });

  it('answers an empty payment list rather than omitting the field', async () => {
    const invoice = await service.one(customer(), UNPAID);

    expect(invoice.payments).toStrictEqual([]);
  });

  it('is a 404 for another customer’s reference', async () => {
    await expect(service.one(customer(), OTHERS)).rejects.toMatchObject({
      status: 404,
    });
  });

  it('is a 404 for a draft booking', async () => {
    await expect(service.one(customer(), DRAFT)).rejects.toMatchObject({ status: 404 });
  });

  it('is a 404 for a soft-deleted booking', async () => {
    await expect(service.one(customer(), DELETED)).rejects.toMatchObject({
      status: 404,
    });
  });

  /**
   * A malformed reference is a 404, not a 400.
   *
   * Answering "malformed" would tell somebody probing what shape a real reference has, and references
   * are sequential — the shape is most of the guess.
   */
  it.each(['', 'x', 'a'.repeat(200), '../../etc/passwd', "'; DROP TABLE bookings;--"])(
    'is a 404 for the malformed reference %j',
    async (reference) => {
      await expect(service.one(customer(), reference)).rejects.toMatchObject({
        status: 404,
      });
    },
  );

  it('refuses an anonymous caller asking for one receipt', async () => {
    await expect(service.one(undefined, PAID)).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token with no customer profile asking for one receipt', async () => {
    await expect(service.one(staff, PAID)).rejects.toMatchObject({ status: 404 });
  });
});

async function seed(db: Database): Promise<void> {
  for (const [id, email, role] of [
    [USER_ID, 'inv-one@safra.test', 'customer'],
    [OTHER_USER_ID, 'inv-two@safra.test', 'customer'],
    [PARTNER_USER_ID, 'inv-partner@safra.test', 'partner'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO users (id, email, role)
      VALUES (${id}::uuid, ${email}, ${role}::user_role)
      ON CONFLICT DO NOTHING`);
  }

  for (const [id, userId, name, email] of [
    [PROFILE_ID, USER_ID, 'واحد', 'inv-one@safra.test'],
    [OTHER_PROFILE_ID, OTHER_USER_ID, 'اثنان', 'inv-two@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
      VALUES (${id}::uuid, ${userId}::uuid, ${name}, ${email}, '+963900000030', false)
      ON CONFLICT DO NOTHING`);
  }

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${PARTNER_USER_ID}::uuid, pt.id, 'Inv', 'فاتورة', c.id,
           'Addr', '+963900000031', 'inv-partner@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                            slug, name_ar, name_en, name_de, address, status)
    SELECT ${PARTNER_ID}::uuid, c.id, pt.id, cp.id, ${SLUG},
           'فاتورة', 'Invoice Test', 'Rechnungstest', 'Addr', 'published'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT p.id, 'وحدة', 'Unit', 'Einheit', 2, '200.00', cu.id, 1
    FROM properties p, currencies cu
    WHERE p.slug = ${SLUG} AND cu.code = 'USD'
    LIMIT 1`);

  /*
    Six bookings, inserted oldest first so `created_at` orders them predictably.

    The dates never overlap: `bookings_no_overlapping_stays_v2` excludes two active stays on one unit,
    and a fixture that trips a real constraint teaches nothing about the code under test.

    `created_at` is set EXPLICITLY, and the ordering assertions depend on it: `now()` is
    transaction-stable, so six rows inserted in one transaction would share it to the microsecond, the
    list order would fall through to the id tiebreaker, and the test would be proving uuidv7
    monotonicity rather than the ORDER BY. The payments below are staggered for the same reason.
  */
  const bookings = [
    {
      reference: PAID,
      profile: PROFILE_ID,
      status: 'confirmed',
      offset: 10,
      paid: true,
      discount: '0.00',
      gift: '0.00',
      wallet: '0.00',
      total: '201.990',
    },
    {
      reference: UNPAID,
      profile: PROFILE_ID,
      status: 'pending_payment',
      offset: 20,
      paid: false,
      discount: '0.00',
      gift: '0.00',
      wallet: '0.00',
      total: '201.990',
    },
    {
      reference: DISCOUNTED,
      profile: PROFILE_ID,
      status: 'completed',
      offset: 30,
      paid: true,
      discount: '25.00',
      gift: '0.00',
      wallet: '10.00',
      total: '176.990',
    },
    {
      reference: DRAFT,
      profile: PROFILE_ID,
      status: 'draft',
      offset: 40,
      paid: false,
      discount: '0.00',
      gift: '0.00',
      wallet: '0.00',
      total: '201.990',
    },
    {
      reference: DELETED,
      profile: PROFILE_ID,
      status: 'cancelled',
      offset: 50,
      paid: false,
      discount: '0.00',
      gift: '0.00',
      wallet: '0.00',
      total: '201.990',
    },
    {
      reference: OTHERS,
      profile: OTHER_PROFILE_ID,
      status: 'confirmed',
      offset: 60,
      paid: true,
      discount: '0.00',
      gift: '0.00',
      wallet: '0.00',
      total: '201.990',
    },
  ] as const;

  for (const booking of bookings) {
    await db.execute(sql`
      INSERT INTO bookings (reference, customer_profile_id, unit_id, property_id, partner_id,
                            city_id, check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            discount_amount, gift_card_amount, wallet_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                            paid_at, deleted_at, created_at)
      SELECT ${booking.reference}, ${booking.profile}::uuid, un.id, pr.id, pr.partner_id,
             pr.city_id,
             (current_date - ${booking.offset}::int)::date,
             (current_date - ${booking.offset}::int + 2)::date,
             2, ${booking.status}::booking_status,
             '200.00', '1.99', '1.99', '0.0700', '14.00',
             ${booking.discount}, ${booking.gift}, ${booking.wallet},
             ${booking.total}, '186.00', cu.id,
             '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb,
             ${booking.paid ? sql`now()` : sql`NULL`},
             ${booking.reference === DELETED ? sql`now()` : sql`NULL`},
             now() - ((100 - ${booking.offset}) * interval '1 day')
      FROM properties pr
      JOIN units un ON un.property_id = pr.id
      CROSS JOIN currencies cu
      WHERE pr.slug = ${SLUG} AND cu.code = 'USD'
      LIMIT 1`);
  }

  /*
    Two payments on the paid booking — a failure and then a capture.

    The failure is seeded on purpose: somebody reading a receipt because their card was charged twice
    needs to see both rows, so the service must not filter by status.
  */
  for (const [reference, status, captured] of [
    ['PAY-INV-TEST-1', 'failed', false],
    ['PAY-INV-TEST-2', 'captured', true],
  ] as const) {
    await db.execute(sql`
      INSERT INTO payments (reference, booking_id, method, provider, amount, currency_id,
                            status, captured_at, created_at)
      SELECT ${reference}, b.id, 'visa', 'test', '201.990', b.currency_id,
             ${status}::payment_status, ${captured ? sql`now()` : sql`NULL`},
             now() - ((${captured ? 1 : 2}) * interval '1 minute')
      FROM bookings b
      WHERE b.reference = ${PAID}
      LIMIT 1`);
  }
}
