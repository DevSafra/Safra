import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PayoutService } from './payout.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The partner payout ledger against a REAL PostgreSQL.
 *
 * ## Why these and not unit tests
 *
 * Almost everything worth guaranteeing here is enforced by the DATABASE — the money identity, the
 * one-open-period rule, a booking appearing on at most one payout, and the refusal to restate a
 * paid transfer. A mocked database would assert that the service called the right method, which is
 * exactly the thing that stays true while the guarantee quietly stops holding.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * The database's own refusal, unwrapped.
 *
 * Drizzle reports a rejected statement as "Failed query: …" with the real error as the `cause`, so
 * a test that matched the outer message would pass on any failure at all.
 */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;

    while (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    }

    return parts.join(' | ');
  }

  return 'NO ERROR — the statement was accepted';
}

describeIfDb('PayoutService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const service = new PayoutService(db, new AuditService(db), new LedgerService(db));

  /*
    A REAL staff user, not an invented uuid. Every transition writes an audit row and
    `audit_log.actor_user_id` is a foreign key — a fabricated actor fails on the constraint, which
    is the audit trail refusing to record a decision nobody made.
  */
  let finance: AccessTokenClaims;

  /**
   * Each test gets its OWN partner and its own payable bookings.
   *
   * The first version drew from whatever the testbed happened to hold, and the tests then competed
   * for it: a payout marked paid is permanent — the trigger refuses to delete it — so every run
   * consumed bookings that the next test needed, and which test failed depended on the order they
   * ran in. Owning the data is the only way these mean the same thing twice.
   */
  let partnerId = '';
  let bookingIds: string[] = [];

  beforeEach(async () => {
    await harness.begin();

    const staff = await db.execute<{ id: string }>(sql`
      SELECT id FROM users
      WHERE role IN ('finance_officer', 'super_admin') AND deleted_at IS NULL
      ORDER BY created_at LIMIT 1
    `);

    finance = {
      sub: staff.rows[0]?.id,
      role: 'finance_officer',
      permissions: [P.PAYOUT_EXECUTE, P.PAYOUT_READ],
    } as AccessTokenClaims;

    const made = await db.execute<{ partner_id: string; booking_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD') AS currency_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('payout-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'Payout Test', 'Payout Test', ref.city_id,
               'x', '+963900000000', 'payout-test@safra.test', 'approved'
        FROM u, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'payout-test-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Unit', 2, '100.00', ref.currency_id
        FROM pr, ref RETURNING id, property_id
      ), cp AS (
        INSERT INTO customer_profiles (full_name, email, phone, is_guest)
        VALUES ('Payout Guest', 'payout-guest-' || gen_random_uuid() || '@safra.test',
                '+963900000001', true)
        RETURNING id
      ), b AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                              paid_at, confirmed_at, completed_at)
        SELECT cp.id, un.id, pr.id, pr.partner_id, pa.city_id,
               (now() - (n * interval '10 day'))::date,
               (now() - (n * interval '10 day') + interval '2 day')::date,
               2, 'completed',
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.currency_id, '12500.00000000', '2524875.00', '{"code":"flex"}'::jsonb,
               now(), now(), now()
        FROM generate_series(1, 3) AS n, cp, un, pr, pa, ref
        RETURNING id, partner_id
      )
      SELECT partner_id, id AS booking_id FROM b
    `);

    partnerId = made.rows[0]?.partner_id ?? '';
    bookingIds = made.rows.map((row) => row.booking_id);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('accrues completed, paid bookings into one open period per partner', async () => {
    if (bookingIds.length === 0) return;

    const first = await service.accrue();

    expect(first.attached).toBeGreaterThan(0);

    const open = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM partner_payouts
      WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);

    expect(open.rows[0]?.n).toBe(1);
  });

  /**
   * The property that makes double payment impossible rather than unlikely.
   *
   * A second sweep must attach nothing — not because the query is careful, but because the unique
   * index on `booking_id` refuses it whatever the query returns.
   */
  it('is idempotent — a second sweep attaches nothing', async () => {
    await service.accrue();

    const again = await service.accrue();

    expect(again.attached).toBe(0);
  });

  it('totals the payout from its items, and the database enforces the identity', async () => {
    await service.accrue();

    const rows = await db.execute<{ gross: string; net: string; total: string }>(sql`
      SELECT p.gross_amount::text AS gross, p.net_amount::text AS net,
             (SELECT coalesce(sum(i.amount), 0)::text FROM partner_payout_items i
              WHERE i.payout_id = p.id) AS total
      FROM partner_payouts p
      WHERE p.partner_id = ${partnerId} AND p.status = 'accruing'
    `);

    const row = rows.rows[0];

    expect(Number(row?.gross)).toBeCloseTo(Number(row?.total), 2);
    expect(Number(row?.net)).toBeCloseTo(Number(row?.gross), 2);
  });

  /**
   * The freeze rule: an open dispute keeps its booking out of a payout.
   *
   * Asserted by opening one and re-accruing, because the rule is a DERIVED query rather than a
   * flag — the thing that could break it is somebody adding a `payout_frozen` column later.
   */
  it('never accrues a booking whose dispute is open', async () => {
    const booking = bookingIds[0];

    if (!booking) return;

    await db.execute(sql`
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, status, title)
      SELECT b.id, b.partner_id, b.customer_profile_id, 'not_as_described', 'open',
             'Payout freeze test'
      FROM bookings b WHERE b.id = ${booking}
    `);

    await service.accrue();

    const attached = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM partner_payout_items WHERE booking_id = ${booking}`,
    );

    expect(attached.rows[0]?.n).toBe(0);

    await db.execute(sql`DELETE FROM disputes WHERE title = 'Payout freeze test'`);
  });

  it('walks the lifecycle and posts exactly one balanced movement on payment', async () => {
    if (bookingIds.length === 0) return;

    await service.accrue();

    const found = await db.execute<{ id: string; net: string }>(sql`
      SELECT id, net_amount::text AS net FROM partner_payouts
      WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);
    const payout = found.rows[0];

    if (!payout) return;

    await service.close(payout.id, finance);
    await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);
    await service.markPaid(payout.id, { paidReference: 'BANK-REF-1' }, finance);

    const after = await db.execute<{ status: string; entry_group_id: string | null }>(
      sql`SELECT status::text AS status, entry_group_id FROM partner_payouts WHERE id = ${payout.id}`,
    );

    expect(after.rows[0]?.status).toBe('paid');
    expect(after.rows[0]?.entry_group_id).toBeTruthy();

    /* Two legs, debits equal credits — the balance trigger would have rejected anything else. */
    const legs = await db.execute<{
      account: string;
      direction: string;
      amount: string;
    }>(sql`
      SELECT account::text AS account, direction::text AS direction, amount::text AS amount
      FROM ledger_entries WHERE entry_group_id = ${after.rows[0]?.entry_group_id}
      ORDER BY direction
    `);

    expect(legs.rows).toHaveLength(2);
    expect(legs.rows.map((leg) => leg.account).sort()).toStrictEqual([
      'partner_payable',
      'partner_payout',
    ]);
  });

  /** A paid transfer is history. The trigger, not the service, is what refuses. */
  it('refuses to restate a paid payout', async () => {
    /* Made here rather than relying on another test having run — order is not a fixture. */
    if (bookingIds.length === 0) return;

    await service.accrue();

    const open = await db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payouts WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);
    const id = open.rows[0]?.id;

    if (!id) return;

    await service.close(id, finance);
    await service.release(id, { scheduledFor: '2026-08-21' }, finance);
    await service.markPaid(id, { paidReference: 'BANK-REF-IMMUTABLE' }, finance);

    /*
      Asserted on the CAUSE, not the thrown message. Drizzle wraps a database error in
      "Failed query: …", so matching the outer message tests the wrapper — and would pass just as
      happily on a syntax error, which is the opposite of what this guarantees.
    */
    expect(
      await refusal(
        db.execute(sql`UPDATE partner_payouts SET net_amount = 1 WHERE id = ${id}`),
      ),
    ).toMatch(/paid|insufficient_privilege/i);

    expect(
      await refusal(db.execute(sql`DELETE FROM partner_payouts WHERE id = ${id}`)),
    ).toMatch(/paid|insufficient_privilege/i);

    // The covered bookings are equally final.
    expect(
      await refusal(
        db.execute(sql`DELETE FROM partner_payout_items WHERE payout_id = ${id}`),
      ),
    ).toMatch(/paid|insufficient_privilege/i);
  });

  /** Cancelling returns the bookings to accrual — the unique index required this shape. */
  it('returns a cancelled payout’s bookings to accrual', async () => {
    if (bookingIds.length === 0) return;

    await service.accrue();

    const found = await db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payouts WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);
    const id = found.rows[0]?.id;

    if (!id) return;

    await service.cancel(id, { reason: 'test' }, finance);

    const items = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM partner_payout_items WHERE payout_id = ${id}`,
    );

    expect(items.rows[0]?.n).toBe(0);

    // And they accrue again into a fresh period.
    const again = await service.accrue();

    expect(again.attached).toBeGreaterThan(0);
  });

  /** A partner reads their own and nothing else. There is no call that names a partner. */
  it('scopes a partner’s list to their own token', async () => {
    if (bookingIds.length === 0) return;

    await service.accrue();

    const claims = {
      sub: '00000000-0000-4000-8000-00000000beef',
      role: 'partner',
      partnerId,
      permissions: [P.PAYOUT_READ_OWN],
    } as AccessTokenClaims;

    const mine = await service.listForPartner(claims);
    const references = mine.map((payout) => payout.reference);

    expect(references.length).toBeGreaterThan(0);

    /*
      A parameterised IN list. `${array}` in a drizzle template expands to `($1, $2, …)`, which is
      an IN list and NOT an array literal — `= ANY(${refs}::text[])` builds something Postgres
      rejects outright.
    */
    const theirs = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM partner_payouts
      WHERE partner_id <> ${partnerId}
        AND reference IN (${sql.join(
          references.map((reference) => sql`${reference}`),
          sql`, `,
        )})
    `);

    expect(theirs.rows[0]?.n).toBe(0);
  });
});
