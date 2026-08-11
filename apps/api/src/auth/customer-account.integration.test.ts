import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { CustomerAccountService } from './customer-account.service.js';
import type { AccessTokenClaims } from './token.service.js';

/**
 * `GET /auth/me/profile` — the customer's own profile and handoff §6's sidebar counters.
 *
 * Against a real PostgreSQL because every interesting part is SQL: two counting subqueries and a left
 * join that has to distinguish "no wallet" from "a balance of zero". A mock would assert the shape of
 * the code rather than what the database answers.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const USER_ID = '99990000-0000-0000-0000-0000000000f1';
const PROFILE_ID = '99990000-0000-0000-0000-0000000000f2';
const OTHER_USER_ID = '99990000-0000-0000-0000-0000000000f3';
const OTHER_PROFILE_ID = '99990000-0000-0000-0000-0000000000f4';
const PARTNER_ID = '99990000-0000-0000-0000-0000000000f5';
const PROPERTY_ID = '99990000-0000-0000-0000-0000000000f6';
const UNIT_ID = '99990000-0000-0000-0000-0000000000f7';
/** `partners.user_id` is NOT NULL, so the fixture partner needs an account of its own. */
const PARTNER_USER_ID = '99990000-0000-0000-0000-0000000000f8';

const customer = (profileId = PROFILE_ID, sub = USER_ID): AccessTokenClaims => ({
  sub,
  role: 'customer',
  permissions: ['review.create'],
  locale: 'ar',
  customerProfileId: profileId,
});

describeIfDb('CustomerAccountService.summary', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: CustomerAccountService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new CustomerAccountService(db);
    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('answers the profile the token names, with the fields the session cannot carry', async () => {
    const view = await service.summary(customer());

    /* The name is the whole point: §6 greets by it and no token claim holds it. */
    expect(view.fullName).toBe('رامي');
    expect(view.email).toBe('rami@safra.test');
    expect(view.phone).toBe('+963900000010');
    expect(view.reference).toMatch(/^CUS-/);
  });

  it('counts this customer’s bookings and unreviewed stays', async () => {
    const view = await service.summary(customer());

    /* Two bookings seeded, one of them a completed stay with no review yet. */
    expect(view.counters.bookings).toBe(2);
    expect(view.counters.pendingReviews).toBe(1);
  });

  /**
   * A review makes the prompt disappear, and the badge with it.
   *
   * The counter uses the same predicate as `pendingForCustomer`, which is the point of the assertion:
   * a badge that disagreed with the list it points at is worse than no badge.
   */
  it('stops counting a stay once it has been reviewed', async () => {
    const { sql } = await import('drizzle-orm');

    await db.execute(sql`
      INSERT INTO reviews (booking_id, property_id, unit_id, partner_id,
                           customer_profile_id, rating, body)
      SELECT b.id, b.property_id, b.unit_id, b.partner_id, b.customer_profile_id, 5, 'جيد جداً'
      FROM bookings b
      WHERE b.customer_profile_id = ${PROFILE_ID}::uuid AND b.status = 'completed'
      LIMIT 1`);

    const view = await service.summary(customer());

    expect(view.counters.pendingReviews).toBe(0);
    /* The booking itself is still theirs — only the REVIEW prompt went away. */
    expect(view.counters.bookings).toBe(2);
  });

  /**
   * No wallet is absent, not zero.
   *
   * A customer who has never been compensated has no `wallets` row, and «0» on the sidebar would
   * state a balance nobody holds. The badge should be missing instead.
   */
  it('reports no wallet as absent rather than as a zero balance', async () => {
    const view = await service.summary(customer());

    expect(view.counters.walletBalance).toBeNull();
    expect(view.counters.walletCurrency).toBeNull();
  });

  it('reports a real balance with its currency once a wallet exists', async () => {
    const { sql } = await import('drizzle-orm');

    await db.execute(sql`
      INSERT INTO wallets (customer_profile_id, balance, currency_id)
      SELECT ${PROFILE_ID}::uuid, '35.00', cu.id FROM currencies cu WHERE cu.code = 'USD' LIMIT 1`);

    const view = await service.summary(customer());

    expect(view.counters.walletBalance).toBe('35.00');
    expect(view.counters.walletCurrency).toBe('USD');
  });

  /**
   * The counters are scoped to the caller, and the endpoint takes no id to argue with.
   *
   * The second profile has its own booking; neither customer's numbers may include it.
   */
  it('never counts another customer’s bookings', async () => {
    const mine = await service.summary(customer());
    const theirs = await service.summary(customer(OTHER_PROFILE_ID, OTHER_USER_ID));

    expect(mine.counters.bookings).toBe(2);
    expect(theirs.counters.bookings).toBe(1);
    expect(theirs.fullName).toBe('سامر');
  });

  /**
   * A principal with no customer profile gets the same answer as a deleted one.
   *
   * Staff hold no `customerProfileId`. Distinguishing "you are not a customer" from "no such profile"
   * would tell a caller which kind of token they are holding, which is not information this endpoint
   * owes anybody.
   */
  it('refuses a token that carries no customer profile', async () => {
    const staff: AccessTokenClaims = {
      sub: USER_ID,
      role: 'support_agent',
      permissions: [],
      locale: 'ar',
    };

    /*
      Asserted on the CODE, not the sentence.

      The English `message` travels for logs only and is never shown — a client resolves
      `customer.not_found` through the catalogue in the reader's language. Matching the prose would
      make this test fail on a wording change that altered no behaviour, which is what it did first
      time round: the message is "No such customer profile.", not "not found".
    */
    await expect(service.summary(staff)).rejects.toMatchObject({
      response: { code: 'customer.not_found' },
    });
  });

  it('refuses an unauthenticated caller', async () => {
    await expect(service.summary(undefined)).rejects.toThrow();
  });
});

async function seed(db: Database): Promise<void> {
  const { sql } = await import('drizzle-orm');

  for (const [userId, email] of [
    [USER_ID, 'rami@safra.test'],
    [OTHER_USER_ID, 'samer@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO users (id, email, role) VALUES (${userId}::uuid, ${email}, 'customer')
      ON CONFLICT DO NOTHING`);
  }

  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${PARTNER_USER_ID}::uuid, 'account-test-partner@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
    VALUES (${PROFILE_ID}::uuid, ${USER_ID}::uuid, 'رامي', 'rami@safra.test',
            '+963900000010', false)
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
    VALUES (${OTHER_PROFILE_ID}::uuid, ${OTHER_USER_ID}::uuid, 'سامر', 'samer@safra.test',
            '+963900000011', false)
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${PARTNER_USER_ID}::uuid, pt.id, 'Acc Test', 'حساب', c.id,
           'Addr', '+963900000012', 'account-test@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status)
    SELECT ${PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'account-test-property',
           'اختبار الحساب', 'Account Test', 'Kontotest', 'Addr', cp.id, 'draft'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${UNIT_ID}::uuid, ${PROPERTY_ID}::uuid, 'وحدة', 'Unit', 'Einheit', 2, 80, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  /* Two bookings for the first customer — one completed and unreviewed, one still pending. */
  await booking(db, PROFILE_ID, 'completed');
  await booking(db, PROFILE_ID, 'pending_payment');
  /* One for the second, which must never appear in the first's counters. */
  await booking(db, OTHER_PROFILE_ID, 'completed');
}

/** The booking fixture the dashboard suite uses, reduced to what these counters read. */
async function booking(db: Database, profileId: string, status: string): Promise<void> {
  const { sql } = await import('drizzle-orm');

  await db.execute(sql`
    INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                          check_in, check_out, guests_adults, status,
                          base_amount, customer_fee_value, customer_fee_amount,
                          partner_commission_rate, partner_commission_amount,
                          total_amount, partner_payable_amount, currency_id,
                          fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
    SELECT ${profileId}::uuid, un.id, un.property_id, pr.partner_id, pr.city_id,
           '2030-05-01'::date, '2030-05-03'::date, 2, ${status}::booking_status,
           '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
           un.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb
    FROM units un JOIN properties pr ON pr.id = un.property_id
    WHERE un.id = ${UNIT_ID}::uuid`);
}
