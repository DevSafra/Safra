import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { RegistryService } from './registry.service.js';

/**
 * One customer's record — «كل معلوماته وحركاته على النظام».
 *
 * ## What this holds that a browser pass could not
 *
 * The screen was driven by hand and worked, and three separate defects still reached it that day:
 * links to a route that does not exist, a template name deleted by a bad edit, and a type scale
 * nobody had compared. Two of the three were reachable from here.
 *
 * The parts worth asserting are the ones a fixture makes invisible:
 *
 * 1. **The bounded sections report the TRUE total.** Each returns the most recent ten with a
 *    `count(*) OVER ()` beside it, and the heading prints «أحدث ١٠ من ٤٠٣». If the total ever came
 *    from `items.length` the screen would say «أحدث ١٠ من ١٠» and a reader would conclude the
 *    customer has ten bookings. A fixture with fewer than ten of everything cannot tell the
 *    difference, so this one deliberately makes twelve.
 * 2. **A missing wallet is `null`, not a zero balance.** Those are different facts and the screen
 *    renders them differently — «لا محفظة» against «٠٫٠٠ USD».
 * 3. **Isolation.** Five separate queries key on the same id; one written against the wrong column
 *    would show another customer's bookings under this name, and a fixture with one customer in the
 *    database would never reveal it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb("a customer's record", () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const registry = new RegistryService(db);

  /** More than the ten a section shows, so «the last ten» and «all of them» differ. */
  const MANY = 12;

  let mine = '';
  let neighbour = '';

  beforeEach(async () => {
    await harness.begin();
    mine = await seedCustomer('نزيل السجل');
    neighbour = await seedCustomer('نزيل آخر');
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('reports the true total beside the ten it shows', async () => {
    await seedBookings(mine, MANY);

    const record = await registry.customerDetail(mine);

    expect(record.bookings.items).toHaveLength(10);
    /* The whole point: twelve exist, ten are shown, and the record says twelve. */
    expect(record.bookings.total).toBe(MANY);
  });

  it('shows everything when there is less than a page of it', async () => {
    await seedBookings(mine, 3);

    const record = await registry.customerDetail(mine);

    expect(record.bookings.items).toHaveLength(3);
    expect(record.bookings.total).toBe(3);
  });

  it('is empty rather than absent for a customer who has done nothing', async () => {
    const record = await registry.customerDetail(mine);

    for (const section of [
      record.bookings,
      record.wallets,
      record.reviews,
      record.disputes,
      record.notifications,
    ]) {
      expect(section.total).toBe(0);
      expect(section.items).toEqual([]);
    }
  });

  /**
   * A customer with no wallet ROW answers `null`.
   *
   * Not `{ balance: '0.00' }`: «this person has never had a wallet» and «their wallet is empty»
   * are different facts, and the screen says «لا محفظة» for one and a figure for the other.
   */
  it('tells a missing wallet apart from an empty one', async () => {
    expect((await registry.customerDetail(mine)).wallet).toBeNull();

    await db.execute(sql`
      INSERT INTO wallets (customer_profile_id, currency_id, balance)
      VALUES ((SELECT id FROM customer_profiles WHERE reference = ${mine}),
              (SELECT id FROM currencies WHERE code = 'USD'), '0.00')
    `);

    const withWallet = await registry.customerDetail(mine);

    expect(withWallet.wallet).toStrictEqual({ balance: '0.000', currency: 'USD' });
  });

  /**
   * Isolation — the assertion the whole file exists for.
   *
   * Five queries key on one id. One written against the wrong column would put somebody else's
   * bookings on this record, and with a single customer in the fixture it would look perfect.
   */
  it("never shows another customer's activity", async () => {
    await seedBookings(neighbour, 2);

    const record = await registry.customerDetail(mine);

    expect(record.bookings.total).toBe(0);

    /* The control: those bookings exist and the customer they belong to has them. */
    expect((await registry.customerDetail(neighbour)).bookings.total).toBe(2);
  });

  it('refuses a reference that does not exist', async () => {
    await expect(registry.customerDetail('CUS-000000')).rejects.toMatchObject({
      response: { code: ERROR.CUSTOMER_NOT_FOUND },
    });
  });

  /** And a soft-deleted customer answers the same as one that never existed. */
  it('refuses a customer that has been removed', async () => {
    await db.execute(sql`
      UPDATE customer_profiles SET deleted_at = now() WHERE reference = ${mine}
    `);

    await expect(registry.customerDetail(mine)).rejects.toMatchObject({
      response: { code: ERROR.CUSTOMER_NOT_FOUND },
    });
  });

  async function seedCustomer(name: string): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest)
      VALUES (${name}, 'rec-' || gen_random_uuid() || '@safra.test', '+963900000091', false)
      RETURNING reference
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no customer.');

    return row.reference;
  }

  /** `n` bookings against one customer, on a property this test makes for the purpose. */
  async function seedBookings(reference: string, n: number): Promise<void> {
    await db.execute(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rec-p-' || gen_random_uuid() || '@safra.test', '+963900000092', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Record Test', 'شريك السجل', ref.city_id, 'x',
               '+963900000092', 'rec-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'record-test-' || gen_random_uuid(), 'عقار السجل', 'Record', 'Record', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      )
      INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                            check_in, check_out, guests_adults, status,
                            base_amount, customer_fee_value, customer_fee_amount,
                            partner_commission_rate, partner_commission_amount,
                            total_amount, partner_payable_amount, currency_id,
                            fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
      SELECT (SELECT id FROM customer_profiles WHERE reference = ${reference}),
             un.id, pr.id, pr.partner_id, ref.city_id,
             /* A different arrival per booking: the unit has an exclusion constraint on its dates. */
             current_date + (1500 + g.n * 3), current_date + (1502 + g.n * 3), 2,
             'confirmed'::booking_status,
             '100.00', '9.00', '9.00', '0.0700', '7.00', '109.00', '93.00',
             ref.currency_id, '13000.00000000', '1417000.00', '{"code":"flex"}'::jsonb
      FROM generate_series(1, ${n}) AS g(n), un, pr, ref
    `);
  }
});
