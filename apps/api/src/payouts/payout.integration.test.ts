import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
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
  /* Shared, so the recovery tests can post a reversal through the same instance the service uses. */
  const ledger = new LedgerService(db);
  const service = new PayoutService(
    db,
    new AuditService(db),
    ledger,
    new SettingsService(db),
  );

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
               'payout-test-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x', 'draft'
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

    /*
      A VERIFIED destination, because that is the ordinary state of a partner SAFRA pays.

      Every release below asserts something else — suspension, sanctions, the ledger movement — and
      without an account on file all of them would refuse for the same new reason and prove nothing
      about the thing they name. The tests that are ABOUT the account remove or downgrade this row
      first, so the guard has an opposite control rather than only a refusal.
    */
    await giveAccount('verified');
  });

  /**
   * Puts one payout account on the fixture partner, in the state the caller names.
   *
   * The ciphertext is a literal. Nothing on the release or payment path decrypts it — the guard
   * reads `status` and `deleted_at` — and encrypting a fake IBAN here would test the encryption
   * service, which has its own suite, rather than the rule this file is about.
   */
  async function giveAccount(
    status: 'pending' | 'verified' | 'rejected',
    /*
      Whether the row claims to be the partner's primary account, overriding what the status would
      imply. `create` deliberately writes `is_primary = false` for every new account so an
      unverified row can never claim it — this parameter exists to build the state that rule
      prevents, and prove the release query does not depend on the rule holding.
    */
    primary?: boolean,
  ): Promise<string> {
    const row = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_payout_accounts
        (partner_id, method, account_holder, account_number_encrypted, account_number_last4,
         bank_name, currency_id, is_primary, status, verified_at)
      SELECT ${partnerId}, 'bank_transfer', 'Payout Test', 'ciphertext', '4321',
             'Test Bank', (SELECT id FROM currencies WHERE code = 'USD'),
             ${primary ?? status === 'verified'}, ${status}::payout_account_status,
             ${status === 'verified' ? sql`now()` : sql`NULL`}
      RETURNING id
    `);

    return row.rows[0]?.id ?? '';
  }

  /**
   * One payout for the fixture partner, closed and waiting to be released.
   *
   * Every destination test needs the same three steps, and repeating them is how one of them ends
   * up asserting against a payout that is still `accruing` — which refuses for a different reason
   * and would pass a test written about the account.
   */
  async function openPayout(): Promise<{ id: string }> {
    await service.accrue();

    const found = await db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payouts WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);
    const payout = found.rows[0];

    if (!payout) throw new Error('no accruing payout for the fixture partner');

    await service.close(payout.id, finance);

    return payout;
  }

  afterEach(async () => {
    await harness.rollback();
  });

  /*
    Sweeps the residue this suite leaves when a run does not finish (`O-ops-4`).

    Every test here runs inside a transaction that is rolled back, so nothing SHOULD survive — and
    112 `payout-test-%` properties and users did, left by runs killed between `begin` and `rollback`.
    They are harmless individually and nothing ever cleaned them, which is how a development database
    acquires a hundred orphan businesses.

    ## Its own connection, deliberately

    The harness wraps everything in a transaction it is about to roll back, so a delete issued
    through it would be undone — the sweep has to commit. `createDatabase` gives one connection for
    the length of the sweep and closes it.

    ## Only rows with no evidence attached

    A property with no bookings, a partner with no properties and no payouts, a user with no partner.
    A payout, a payment or a ledger entry hanging off one of these means the row is no longer
    residue, and the `NOT EXISTS` clauses leave it alone rather than deleting financial history to
    tidy a fixture. Swallowed, because a cleanup that fails must not fail a suite that passed.
  */
  afterAll(async () => {
    await harness.close();

    const sweep = createDatabase(DATABASE_URL ?? '', 1);

    try {
      await sweep.execute(sql`
        DELETE FROM units WHERE property_id IN (
          SELECT id FROM properties WHERE slug LIKE 'payout-test-%'
            AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = properties.id)
        )`);
      await sweep.execute(sql`
        DELETE FROM properties WHERE slug LIKE 'payout-test-%'
          AND NOT EXISTS (SELECT 1 FROM bookings b WHERE b.property_id = properties.id)`);
      await sweep.execute(sql`
        DELETE FROM partners WHERE email LIKE 'payout-test-%'
          AND NOT EXISTS (SELECT 1 FROM properties p WHERE p.partner_id = partners.id)
          AND NOT EXISTS (SELECT 1 FROM partner_payouts po WHERE po.partner_id = partners.id)`);
      await sweep.execute(sql`
        DELETE FROM users WHERE email LIKE 'payout-test-%'
          AND NOT EXISTS (SELECT 1 FROM partners p WHERE p.user_id = users.id)`);
      /*
        Whatever survived the evidence test is UNPUBLISHED rather than left in search.

        The 112 properties this suite had accumulated were all `published`, so they sat in customer
        search results and on public property pages — the same blast radius that made
        `payments-test-property` break thirty-three specs in the customer app. Deleting them is not
        available: 336 `partner_payout_items` reference their bookings, and unpicking financial
        bookkeeping to tidy a fixture is exactly the trade `O-ops-4` says not to make.

        Drafting them costs nothing and removes the whole exposure: every row is kept, and a draft
        listing is in no search, has no public page and is fetched by nothing. New rows are created
        as drafts above, so this only ever has to catch history.
      */
      await sweep.execute(sql`
        UPDATE properties SET status = 'draft'
        WHERE slug LIKE 'payout-test-%' AND status <> 'draft'`);
    } catch {
      /* Residue is not worth a red suite. */
    } finally {
      await (sweep as unknown as { $client: { end: () => Promise<void> } }).$client.end();
    }
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

  /**
   * A SUSPENDED partner's payout will not release (Bashar, 2026-08-24).
   *
   * ## Why this had no test until now
   *
   * The freeze was written, reviewed and reported as part of the suspension policy, and the code is
   * correct — but nothing exercised it, so "payouts freeze while a suspension is active" rested
   * entirely on reading `payout.service.ts`. It is one of the three clauses
   * `suspension-enforcement.integration.test.ts` explicitly names as enforced in a QUERY rather
   * than by a decorator, and therefore as somebody else's assertion to write. This is that
   * assertion.
   *
   * ## Suspended AFTER accrual, deliberately
   *
   * That is the ordinary case rather than the edge one: a payout accrues over a period and a
   * suspension happens on a day, so the realistic sequence is exactly this one. A test that
   * suspended first would pass against a check placed at accrual and prove nothing about release,
   * which is the last moment anybody looks.
   */
  it('refuses to release a suspended partner’s payout', async () => {
    if (bookingIds.length === 0) return;

    await service.accrue();

    const found = await db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payouts WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);
    const payout = found.rows[0];

    if (!payout) return;

    await service.close(payout.id, finance);

    await db.execute(sql`
      UPDATE partners SET suspended_at = now(), suspended_reason = 'freeze test'
      WHERE id = ${partnerId}
    `);

    /*
      Asserted on the CODE, not on the message.

      `refusal()` above unwraps a DATABASE error, whose text IS the assertion. A service refusal is
      an `HttpException` carrying `{ statusCode, code, message }`, and its `message` is English prose
      kept for logs — the project rule is that nothing displays it and, by the same argument,
      nothing asserts on it. `code` is the contract the console resolves into Arabic, so a reworded
      sentence must not fail this test and a changed code must.
    */
    await expect(
      service.release(payout.id, { scheduledFor: '2026-08-20' }, finance),
    ).rejects.toMatchObject({ response: { code: 'payout.frozen_by_suspension' } });

    /* Still held, not half-transitioned. */
    const after = await db.execute<{ status: string }>(
      sql`SELECT status::text AS status FROM partner_payouts WHERE id = ${payout.id}`,
    );

    expect(after.rows[0]?.status).toBe('pending_release');
  });

  /**
   * The opposite control, and without it the test above proves nothing.
   *
   * "Release refused" is indistinguishable from "release is broken" unless the same payout, at the
   * same stage, releases when the partner is NOT suspended. Deleting the suspension check would
   * fail this pair; so would breaking release for everyone.
   */
  it('releases the same payout once the suspension is lifted', async () => {
    if (bookingIds.length === 0) return;

    await service.accrue();

    const found = await db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payouts WHERE partner_id = ${partnerId} AND status = 'accruing'
    `);
    const payout = found.rows[0];

    if (!payout) return;

    await service.close(payout.id, finance);

    await db.execute(sql`
      UPDATE partners SET suspended_at = now(), suspended_reason = 'freeze test'
      WHERE id = ${partnerId}
    `);
    await db.execute(
      sql`UPDATE partners SET suspended_at = NULL, suspended_reason = NULL WHERE id = ${partnerId}`,
    );

    await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);

    const after = await db.execute<{ status: string }>(
      sql`SELECT status::text AS status FROM partner_payouts WHERE id = ${payout.id}`,
    );

    expect(after.rows[0]?.status).toBe('scheduled');
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
  /*
    ── The destination guard (Bashar, 2026-09-04) ──────────────────────────────────────────────

    «A payout must never be released or marked as paid unless it is linked to an active, verified
    payout account.» Both verbs, so both are proved, and each refusal is paired with the case that
    SUCCEEDS — a release that refuses for every partner is indistinguishable from a release that is
    simply broken, and the pair is what tells them apart.

    What made this necessary is not hypothetical. On 2026-09-04 the table held zero rows, nothing
    in the codebase ever wrote one, and the release path took `?? null` on the lookup — so
    seventy-six payouts had been released or paid with no recorded destination at all.
  */
  it('refuses to release a payout when the partner has no payout account', async () => {
    if (bookingIds.length === 0) return;

    await db.execute(
      sql`DELETE FROM partner_payout_accounts WHERE partner_id = ${partnerId}`,
    );
    const payout = await openPayout();

    await expect(
      service.release(payout.id, { scheduledFor: '2026-08-20' }, finance),
    ).rejects.toMatchObject({ response: { code: 'payout.no_verified_account' } });

    const after = await db.execute<{ status: string; account: string | null }>(sql`
      SELECT status, payout_account_id AS account FROM partner_payouts WHERE id = ${payout.id}
    `);

    expect(after.rows[0]?.status).toBe('pending_release');
    expect(after.rows[0]?.account).toBeNull();
  });

  it('refuses to release when the only account is still pending verification', async () => {
    if (bookingIds.length === 0) return;

    await db.execute(
      sql`DELETE FROM partner_payout_accounts WHERE partner_id = ${partnerId}`,
    );
    await giveAccount('pending');
    const payout = await openPayout();

    await expect(
      service.release(payout.id, { scheduledFor: '2026-08-20' }, finance),
    ).rejects.toMatchObject({ response: { code: 'payout.no_verified_account' } });
  });

  it('refuses to release when the only account was rejected', async () => {
    if (bookingIds.length === 0) return;

    await db.execute(
      sql`DELETE FROM partner_payout_accounts WHERE partner_id = ${partnerId}`,
    );
    await giveAccount('rejected');
    const payout = await openPayout();

    await expect(
      service.release(payout.id, { scheduledFor: '2026-08-20' }, finance),
    ).rejects.toMatchObject({ response: { code: 'payout.no_verified_account' } });
  });

  /**
   * The opposite control, and it also proves the payout RECORDS which account it went to.
   *
   * A release that succeeds but writes NULL into `payout_account_id` would satisfy a test that
   * only asserted the status — and NULL is the exact state seventy-six live rows were in.
   */
  it('releases to the verified account, and records which one', async () => {
    if (bookingIds.length === 0) return;

    await db.execute(
      sql`DELETE FROM partner_payout_accounts WHERE partner_id = ${partnerId}`,
    );

    /*
      The pending row is marked PRIMARY and is older, so `ORDER BY is_primary DESC, … created_at`
      would choose it. Only `status = 'verified'` in the WHERE clause does not — which is the point:
      remove that one line and this test goes red, where an ordinary two-account fixture would stay
      green because the ordering happened to agree with the filter.
    */
    const pending = await giveAccount('pending', true);
    const verified = await giveAccount('verified', false);

    const payout = await openPayout();

    await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);

    const after = await db.execute<{ status: string; account: string | null }>(sql`
      SELECT status, payout_account_id AS account FROM partner_payouts WHERE id = ${payout.id}
    `);

    expect(after.rows[0]?.status).toBe('scheduled');
    expect(after.rows[0]?.account).toBe(verified);
    /* Never the unverified one, even though the ordering alone would have chosen it. */
    expect(after.rows[0]?.account).not.toBe(pending);
  });

  /**
   * The second verb, and the reason it is checked twice.
   *
   * Release and payment are separated by days. In that gap the partner can edit their details —
   * which returns the account to `pending` — or staff can remove it. A payout scheduled against an
   * account that has since changed is precisely the case somebody would engineer, so the state at
   * release is not evidence about the state at payment.
   */
  it('refuses to mark paid when the account stopped being verified after release', async () => {
    if (bookingIds.length === 0) return;

    const payout = await openPayout();

    await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);

    /* What an edit does: the account goes back to review, and stops being payable. */
    await db.execute(sql`
      UPDATE partner_payout_accounts SET status = 'pending', verified_at = NULL
      WHERE partner_id = ${partnerId}
    `);

    await expect(
      service.markPaid(payout.id, { paidReference: 'TRX-1' }, finance),
    ).rejects.toMatchObject({
      response: { code: 'payout.account_unverified_at_payment' },
    });

    const after = await db.execute<{ status: string; entry: string | null }>(sql`
      SELECT status, entry_group_id AS entry FROM partner_payouts WHERE id = ${payout.id}
    `);

    /* Still scheduled, and NO ledger movement — the refusal happens before the money is booked. */
    expect(after.rows[0]?.status).toBe('scheduled');
    expect(after.rows[0]?.entry).toBeNull();
  });

  it('refuses to mark paid when the account was removed after release', async () => {
    if (bookingIds.length === 0) return;

    const payout = await openPayout();

    await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);
    await db.execute(sql`
      UPDATE partner_payout_accounts SET deleted_at = now() WHERE partner_id = ${partnerId}
    `);

    await expect(
      service.markPaid(payout.id, { paidReference: 'TRX-1' }, finance),
    ).rejects.toMatchObject({
      response: { code: 'payout.account_unverified_at_payment' },
    });
  });

  /** The opposite control for both refusals above: the account is untouched, so payment lands. */
  it('marks paid when the account is still verified at payment', async () => {
    if (bookingIds.length === 0) return;

    const payout = await openPayout();

    await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);
    await service.markPaid(payout.id, { paidReference: 'TRX-1' }, finance);

    const after = await db.execute<{ status: string; entry: string | null }>(sql`
      SELECT status, entry_group_id AS entry FROM partner_payouts WHERE id = ${payout.id}
    `);

    expect(after.rows[0]?.status).toBe('paid');
    expect(after.rows[0]?.entry).not.toBeNull();
  });

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

  /*
    An overpayment that arises AFTER the money has gone, and how it comes back.

    Bashar's decision, 2026-09-07: «If a payout has already been paid and a refund later creates an
    overpayment, I want the difference recorded as a recoverable balance that is deducted from
    future payouts. Do not automatically create negative transfers or attempt to claw money back
    outside the normal payout process.»

    The sequence is the whole point and each step is a different guarantee: the transfer is PAID and
    therefore frozen, the refund lands afterwards, the balance is recorded rather than collected,
    and the collecting happens on the next ordinary transfer — capped so it can never make one
    negative, and carried forward when it does not fit.
  */
  describe('an overpayment recovered from a later transfer', () => {
    /** The fixture partner's three bookings, paid out in full and the transfer marked sent. */
    async function payTheFirstTransfer(): Promise<string> {
      const payout = await openPayout();

      await service.release(payout.id, { scheduledFor: '2026-08-20' }, finance);
      await service.markPaid(payout.id, { paidReference: 'BANK-REF-RECOVERY' }, finance);

      return payout.id;
    }

    /** A completed refund of the whole stay on one of them. */
    async function refundOneStayInFull(bookingId: string): Promise<void> {
      await db.execute(sql`
        INSERT INTO payments (booking_id, method, provider, amount, currency_id, status,
                              captured_at)
        SELECT b.id, 'bank_transfer', 'manual', b.total_amount, b.currency_id, 'captured', now()
          FROM bookings b WHERE b.id = ${bookingId}
      `);
      await db.execute(sql`
        INSERT INTO refunds (payment_id, booking_id, amount, currency_id,
                             applied_refund_percent, reason, status, wallet_amount, completed_at)
        SELECT p.id, b.id, b.base_amount, b.currency_id, 100,
               'recovery test: the whole stay, after the transfer was paid',
               'completed', 0, now()
          FROM bookings b JOIN payments p ON p.booking_id = b.id
         WHERE b.id = ${bookingId} LIMIT 1
      `);
    }

    async function recoveryFor(bookingId: string) {
      const rows = await db.execute<{
        amount: string;
        recovered: string;
        settled: string | null;
      }>(sql`
        SELECT amount::text, recovered_amount::text AS recovered, settled_at::text AS settled
          FROM partner_recoveries WHERE booking_id = ${bookingId}::uuid
      `);

      return rows.rows[0];
    }

    it('records the difference as a balance instead of restating the paid transfer', async () => {
      if (bookingIds.length === 0) return;

      const paidPayout = await payTheFirstTransfer();

      await refundOneStayInFull(bookingIds[0]!);
      await ledger.reverseForRefund(db, bookingIds[0]!);

      const recovery = await recoveryFor(bookingIds[0]!);

      expect(recovery, 'a balance was raised').toBeDefined();
      /* The stay was paid out at 186.00 and is now worth nothing, so all of it is owed back. */
      expect(Number(recovery!.amount), 'the whole payable that was sent').toBeCloseTo(
        186,
        2,
      );
      expect(Number(recovery!.recovered), 'nothing collected yet').toBeCloseTo(0, 2);
      expect(recovery!.settled).toBeNull();

      /* And the transfer that was paid is untouched — it is evidence, not a figure. */
      const frozen = await db.execute<{ gross: string; net: string; status: string }>(sql`
        SELECT gross_amount::text AS gross, net_amount::text AS net, status::text
          FROM partner_payouts WHERE id = ${paidPayout}
      `);

      expect(frozen.rows[0]!.status).toBe('paid');
      expect(Number(frozen.rows[0]!.gross), 'still says what was sent').toBeCloseTo(
        558,
        2,
      );
    });

    it('takes it off the next transfer, through the ordinary total', async () => {
      if (bookingIds.length === 0) return;

      await payTheFirstTransfer();
      await refundOneStayInFull(bookingIds[0]!);
      await ledger.reverseForRefund(db, bookingIds[0]!);

      /*
        A new stay for the same partner, so there is a next transfer for the balance to come off.
        Built rather than reused: the three the fixture made are on the paid payout already.
      */
      await db.execute(sql`
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                              paid_at, confirmed_at, completed_at)
        SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
               (now() - interval '5 day')::date, (now() - interval '3 day')::date,
               2, 'completed',
               b.base_amount, b.customer_fee_value, b.customer_fee_amount,
               b.partner_commission_rate, b.partner_commission_amount,
               b.total_amount, b.partner_payable_amount, b.currency_id,
               b.fx_rate_to_syp, b.total_syp, b.cancellation_policy_snapshot,
               now(), now(), now()
          FROM bookings b WHERE b.id = ${bookingIds[1]!} LIMIT 1
      `);

      await service.accrue();

      const next = await db.execute<{
        gross: string;
        fine: string;
        recovery: string;
        net: string;
      }>(sql`
        SELECT gross_amount::text AS gross, fine_amount::text AS fine,
               recovery_amount::text AS recovery, net_amount::text AS net
          FROM partner_payouts
         WHERE partner_id = ${partnerId} AND status = 'accruing' AND deleted_at IS NULL
      `);

      const row = next.rows[0];

      expect(row, 'a new accruing transfer').toBeDefined();
      expect(Number(row!.gross), 'the new stay alone').toBeCloseTo(186, 2);
      expect(Number(row!.recovery), 'and the whole balance came off it').toBeCloseTo(
        186,
        2,
      );
      expect(Number(row!.net), 'so nothing is due this period').toBeCloseTo(0, 2);
      expect(Number(row!.net), 'the identity the CHECK enforces').toBeCloseTo(
        Number(row!.gross) - Number(row!.fine) - Number(row!.recovery),
        3,
      );

      const recovery = await recoveryFor(bookingIds[0]!);

      expect(
        Number(recovery!.recovered),
        'the balance records what was taken',
      ).toBeCloseTo(186, 2);
      expect(recovery!.settled, 'and it is settled').not.toBeNull();

      /* Walkable in the other direction too: which transfer settled it. */
      const deductions = await db.execute<{ n: string; amount: string }>(sql`
        SELECT count(*)::text AS n, coalesce(sum(d.amount), 0)::text AS amount
          FROM partner_recovery_deductions d
          JOIN partner_recoveries r ON r.id = d.recovery_id
         WHERE r.booking_id = ${bookingIds[0]!}::uuid
      `);

      expect(Number(deductions.rows[0]!.n), 'one application, on one transfer').toBe(1);
      expect(Number(deductions.rows[0]!.amount)).toBeCloseTo(186, 2);
    });

    /*
      «Do not automatically create negative transfers» — expressed as arithmetic rather than trust.

      Two stays are refunded, so more is owed back than the next transfer is worth. The database
      would refuse a negative net, so the only correct behaviour is to take what fits and leave the
      rest outstanding for the period after.
    */
    it('never makes a transfer negative, and carries the rest forward', async () => {
      if (bookingIds.length < 2) return;

      await payTheFirstTransfer();

      for (const id of [bookingIds[0]!, bookingIds[1]!]) {
        await refundOneStayInFull(id);
        await ledger.reverseForRefund(db, id);
      }

      /* One new stay: 186 due, against 372 owed back. */
      await db.execute(sql`
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                              paid_at, confirmed_at, completed_at)
        SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
               (now() - interval '5 day')::date, (now() - interval '3 day')::date,
               2, 'completed',
               b.base_amount, b.customer_fee_value, b.customer_fee_amount,
               b.partner_commission_rate, b.partner_commission_amount,
               b.total_amount, b.partner_payable_amount, b.currency_id,
               b.fx_rate_to_syp, b.total_syp, b.cancellation_policy_snapshot,
               now(), now(), now()
          FROM bookings b WHERE b.id = ${bookingIds[2]!} LIMIT 1
      `);

      await service.accrue();

      const next = await db.execute<{ gross: string; recovery: string; net: string }>(sql`
        SELECT gross_amount::text AS gross, recovery_amount::text AS recovery,
               net_amount::text AS net
          FROM partner_payouts
         WHERE partner_id = ${partnerId} AND status = 'accruing' AND deleted_at IS NULL
      `);
      const row = next.rows[0];

      expect(row).toBeDefined();
      expect(Number(row!.net), 'nothing due, and nothing negative').toBeCloseTo(0, 2);
      expect(Number(row!.recovery), 'only what the transfer could carry').toBeCloseTo(
        Number(row!.gross),
        2,
      );

      const left = await db.execute<{ outstanding: string }>(sql`
        SELECT coalesce(sum(amount - recovered_amount), 0)::text AS outstanding
          FROM partner_recoveries
         WHERE partner_id = ${partnerId} AND settled_at IS NULL
      `);

      expect(
        Number(left.rows[0]!.outstanding),
        'the remainder waits for the next period rather than being written off',
      ).toBeCloseTo(186, 2);
    });

    /*
      A balance larger than the transfer it meets — where the clamp is the only thing that holds.

      The carry-forward test above happens to have a balance EXACTLY equal to the transfer, so
      removing `least(outstanding, headroom)` changed nothing and the mutation passed. That is a
      test proving less than it appears to. Here one recovery of 186.00 meets a transfer worth
      40.00, so an unclamped deduction would drive `net_amount` to -146.00 and the CHECK would
      refuse the row — the failure would be a rejected statement rather than a wrong figure.
    */
    it('takes only what the transfer can carry when one balance exceeds it', async () => {
      if (bookingIds.length === 0) return;

      await payTheFirstTransfer();
      await refundOneStayInFull(bookingIds[0]!);
      await ledger.reverseForRefund(db, bookingIds[0]!);

      /* A small new stay: 40.00 due against 186.00 owed back. */
      await db.execute(sql`
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                              paid_at, confirmed_at, completed_at)
        SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
               (now() - interval '5 day')::date, (now() - interval '3 day')::date,
               2, 'completed',
               '43.00', b.customer_fee_value, b.customer_fee_amount,
               b.partner_commission_rate, '3.00',
               '44.99', '40.00', b.currency_id,
               b.fx_rate_to_syp, b.total_syp, b.cancellation_policy_snapshot,
               now(), now(), now()
          FROM bookings b WHERE b.id = ${bookingIds[1]!} LIMIT 1
      `);

      await service.accrue();

      const row = await db.execute<{ gross: string; recovery: string; net: string }>(sql`
        SELECT gross_amount::text AS gross, recovery_amount::text AS recovery,
               net_amount::text AS net
          FROM partner_payouts
         WHERE partner_id = ${partnerId} AND status = 'accruing' AND deleted_at IS NULL
      `);

      expect(Number(row.rows[0]!.gross), 'the small stay alone').toBeCloseTo(40, 2);
      expect(Number(row.rows[0]!.recovery), 'only what it could carry').toBeCloseTo(
        40,
        2,
      );
      expect(Number(row.rows[0]!.net), 'never below zero').toBeCloseTo(0, 2);

      const recovery = await recoveryFor(bookingIds[0]!);

      expect(Number(recovery!.recovered), 'part collected').toBeCloseTo(40, 2);
      expect(recovery!.settled, 'and still outstanding').toBeNull();
      expect(
        Number(recovery!.amount) - Number(recovery!.recovered),
        'the rest waits',
      ).toBeCloseTo(146, 2);
    });

    /* `retotal` runs on every accrual and correction, so applying twice must change nothing. */
    it('collects the same balance once however often the total is recomputed', async () => {
      if (bookingIds.length === 0) return;

      await payTheFirstTransfer();
      await refundOneStayInFull(bookingIds[0]!);
      await ledger.reverseForRefund(db, bookingIds[0]!);

      await db.execute(sql`
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                              paid_at, confirmed_at, completed_at)
        SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
               (now() - interval '5 day')::date, (now() - interval '3 day')::date,
               2, 'completed',
               b.base_amount, b.customer_fee_value, b.customer_fee_amount,
               b.partner_commission_rate, b.partner_commission_amount,
               b.total_amount, b.partner_payable_amount, b.currency_id,
               b.fx_rate_to_syp, b.total_syp, b.cancellation_policy_snapshot,
               now(), now(), now()
          FROM bookings b WHERE b.id = ${bookingIds[1]!} LIMIT 1
      `);

      await service.accrue();

      /*
        A second stay, so the NEXT accrual has something to attach and therefore retotals. Without
        this the later calls are no-ops: `accrue` only retotals the payouts it TOUCHED, so the
        original version of this test asserted idempotence while running the path exactly once.
      */
      await db.execute(sql`
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot,
                              paid_at, confirmed_at, completed_at)
        SELECT b.customer_profile_id, b.unit_id, b.property_id, b.partner_id, b.city_id,
               (now() - interval '9 day')::date, (now() - interval '8 day')::date,
               2, 'completed',
               '215.00', b.customer_fee_value, b.customer_fee_amount,
               b.partner_commission_rate, '15.00',
               '216.99', '200.00', b.currency_id,
               b.fx_rate_to_syp, b.total_syp, b.cancellation_policy_snapshot,
               now(), now(), now()
          FROM bookings b WHERE b.id = ${bookingIds[2]!} LIMIT 1
      `);

      await service.accrue();
      await service.accrue();

      const row = await db.execute<{ gross: string; recovery: string; net: string }>(sql`
        SELECT gross_amount::text AS gross, recovery_amount::text AS recovery,
               net_amount::text AS net
          FROM partner_payouts
         WHERE partner_id = ${partnerId} AND status = 'accruing' AND deleted_at IS NULL
      `);

      expect(Number(row.rows[0]!.gross), 'both new stays').toBeCloseTo(386, 2);
      expect(Number(row.rows[0]!.net), 'the rest is due after the balance').toBeCloseTo(
        200,
        2,
      );
      expect(Number(row.rows[0]!.recovery), 'taken once, not three times').toBeCloseTo(
        186,
        2,
      );

      const recovery = await recoveryFor(bookingIds[0]!);

      expect(Number(recovery!.recovered)).toBeCloseTo(186, 2);

      const applications = await db.execute<{ n: string }>(sql`
        SELECT count(*)::text AS n FROM partner_recovery_deductions d
          JOIN partner_recoveries r ON r.id = d.recovery_id
         WHERE r.booking_id = ${bookingIds[0]!}::uuid
      `);

      expect(Number(applications.rows[0]!.n), 'one application, not three').toBe(1);
    });
  });
});
