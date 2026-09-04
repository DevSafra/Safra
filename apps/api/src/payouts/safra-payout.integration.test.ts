import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SafraPayoutService } from './safra-payout.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';

/**
 * SAFRA's own treasury — destinations, transfers, and the books they move.
 *
 * ## What these hold
 *
 * The whole point of this feature is that SAFRA's revenue accrued as credits and **nothing ever
 * debited them**, so «what have we collected» had no answer. The assertions that matter are
 * therefore about the LEDGER rather than about the rows:
 *
 * 1. **Outstanding is derived.** `accrued − transferred`, straight from the entries, so a payout
 *    moves the summary without anything storing a balance.
 * 2. **Paying posts a BALANCED group** — one debit per contributing revenue stream, one credit to
 *    `safra_payout` — and the payout points at it.
 * 3. **Nothing is paid into an unverified or inactive destination**, checked at PAYMENT and not
 *    only when the payout was opened: those are days apart.
 * 4. **Periods may not overlap.** Two payouts over the same dates would settle the same revenue
 *    twice, the books would still balance, and the money would leave twice.
 */
/** A throwaway 32-byte key. These tests encrypt within one run and store nothing that outlives it. */
const TEST_ENV = { FIELD_ENCRYPTION_KEY: 'c'.repeat(64) } as unknown as Env;

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SafraPayoutService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: SafraPayoutService;
  let actor: AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new SafraPayoutService(
      db,
      new AuditService(db),
      new FieldEncryptionService(TEST_ENV),
      new LedgerService(db),
    );

    /* A real user id: `audit_log.actor_user_id` is a foreign key and a fabricated one rolls the write back. */
    const staff = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM users WHERE role = 'super_admin' AND deleted_at IS NULL LIMIT 1
    `);

    actor = {
      sub: staff.rows[0]?.id,
      role: 'super_admin',
    } as unknown as AccessTokenClaims;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const account = async (overrides: { label?: string } = {}) =>
    service.createAccount(actor, {
      label: overrides.label ?? 'الحساب التشغيلي',
      method: 'bank_transfer',
      accountHolder: 'SAFRA Travel LLC',
      accountNumber: 'SY12 3456 7890 1234',
      bankName: 'بنك بيمو السعودي الفرنسي',
      currency: 'SYP',
    });

  /** A period with revenue in it, taken from the ledger rather than guessed. */
  const periodWithRevenue = async () => {
    const rows = await db.execute<{ from: string; to: string }>(sql`
      SELECT min(created_at)::date::text AS from, max(created_at)::date::text AS to
      FROM ledger_entries
      WHERE account::text IN ('safra_commission_partner', 'safra_commission_customer', 'ad_revenue')
        AND direction = 'credit'
    `);

    return rows.rows[0]!;
  };

  // ── Destinations ──────────────────────────────────────────────────────────

  describe('destinations', () => {
    it('creates one, masked, and pending by default', async () => {
      const { id } = await account();
      const found = (await service.accounts()).find((one) => one.id === id);

      expect(found?.label).toBe('الحساب التشغيلي');
      expect(found?.last4, 'only the last four are readable').toBe('1234');
      expect(found?.status, 'unusable until a human verifies it').toBe('pending');
      expect(found?.isDefault, 'and it is not the default merely by existing').toBe(
        false,
      );
    });

    /**
     * The number never comes back, and the projection does not even read it.
     *
     * Asserted by walking every string in the row rather than by naming the field — the shape the
     * payout-account work settled on, because `not.toContain(number)` only ever protects the one
     * field it names and the next one added walks straight around it.
     */
    it('never returns the account number in any field', async () => {
      const { id } = await account();
      const found = (await service.accounts()).find((one) => one.id === id);

      const strings = Object.values(found ?? {})
        .filter((value): value is string => typeof value === 'string')
        .join(' ');

      expect(strings).not.toContain('SY12');
      expect(strings).not.toContain('34567890');
    });

    it('verifies one, and records who did it', async () => {
      const { id } = await account();

      await service.verifyAccount(actor, id);

      const found = (await service.accounts()).find((one) => one.id === id);

      expect(found?.status).toBe('verified');
      expect(found?.verifiedAt).toBeTruthy();
    });

    /**
     * At most ONE default, enforced by the database.
     *
     * A second default would make «where does SAFRA's money go» answered by whichever row the
     * planner returned first. The service clears the others inside the same transaction so the
     * operator gets what they asked for rather than a constraint violation.
     */
    it('moves the default rather than allowing two', async () => {
      const first = await account({ label: 'الأول' });
      const second = await account({ label: 'الثاني' });

      await service.updateAccount(actor, first.id, { isDefault: true });
      await service.updateAccount(actor, second.id, { isDefault: true });

      const accounts = await service.accounts();

      expect(accounts.filter((one) => one.isDefault)).toHaveLength(1);
      expect(accounts.find((one) => one.isDefault)?.id).toBe(second.id);
    });

    /* Rejecting takes it out of service AND clears the default: nothing may fall back to it. */
    it('clears the default when an account is rejected', async () => {
      const { id } = await account();

      await service.updateAccount(actor, id, { isDefault: true });
      await service.rejectAccount(actor, id, { reason: 'الحساب يخصّ جهة أخرى.' });

      const found = (await service.accounts()).find((one) => one.id === id);

      expect(found?.status).toBe('rejected');
      expect(found?.isDefault).toBe(false);
    });

    it('answers an id that is not there', async () => {
      expect(
        codeOf(
          await service
            .verifyAccount(actor, '00000000-0000-7000-8000-000000000000')
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_ACCOUNT_NOT_FOUND);
    });
  });

  // ── Revenue ───────────────────────────────────────────────────────────────

  describe('the revenue summary', () => {
    it('reports accrued, transferred and the difference', async () => {
      const summary = await service.revenueSummary();

      expect(
        Number(summary.accrued),
        'the platform has earned something',
      ).toBeGreaterThan(0);
      expect(Number(summary.outstanding).toFixed(2)).toBe(
        (Number(summary.accrued) - Number(summary.transferred)).toFixed(2),
      );
    });

    /* Every stream is named, so a total is explicable rather than merely correct. */
    it('breaks the total down by revenue account', async () => {
      const summary = await service.revenueSummary();

      expect(summary.byAccount.map((one) => one.account).sort()).toStrictEqual([
        'ad_revenue',
        'safra_commission_customer',
        'safra_commission_partner',
      ]);
    });
  });

  // ── Transfers ─────────────────────────────────────────────────────────────

  describe('a transfer', () => {
    it('opens for a period and computes what it settles', async () => {
      const period = await periodWithRevenue();

      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      const payout = (await service.payouts()).find((one) => one.id === id);

      expect(payout?.status).toBe('pending_release');
      expect(Number(payout?.netAmount)).toBeGreaterThan(0);
      expect(
        Number(payout?.commissionPartner) +
          Number(payout?.commissionCustomer) +
          Number(payout?.adRevenue),
        'the streams add up to the net',
      ).toBeCloseTo(Number(payout?.netAmount), 2);
    });

    it('refuses a second payout over an overlapping period', async () => {
      const period = await periodWithRevenue();

      await service.open(actor, { periodStart: period.from, periodEnd: period.to });

      expect(
        codeOf(
          await service
            .open(actor, { periodStart: period.from, periodEnd: period.to })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_PERIOD_OVERLAP);
    });

    it('refuses a period with nothing accrued in it', async () => {
      expect(
        codeOf(
          await service
            .open(actor, { periodStart: '1990-01-01', periodEnd: '1990-01-31' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NOTHING_ACCRUED);
    });

    /**
     * The absolute rule, checked at PAYMENT rather than only at opening.
     *
     * Opening and paying are days apart and an account can be rejected or deactivated in between —
     * the same reasoning that made the partner flow re-read its destination on 2026-09-04.
     */
    it('refuses to pay with no verified active destination', async () => {
      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);

      expect(
        codeOf(
          await service
            .markPaid(actor, id, { paidReference: 'TRX-1' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NO_DESTINATION);
    });

    it('refuses to pay into an account that was verified and then deactivated', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);
      /* Between release and payment, the destination is taken out of service. */
      await service.updateAccount(actor, acc.id, { isActive: false });

      expect(
        codeOf(
          await service
            .markPaid(actor, id, { paidReference: 'TRX-2' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NO_DESTINATION);
    });

    /**
     * The whole feature, in one assertion: paying moves the BOOKS.
     *
     * A balanced group — a debit per contributing stream, one credit to `safra_payout` — and the
     * summary's `transferred` rises by exactly the net while `accrued` does not move. That last
     * part is what proves the debits landed on the revenue accounts rather than somewhere tidy.
     */
    it('posts a balanced ledger group and moves the outstanding figure', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const before = await service.revenueSummary();
      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);
      await service.markPaid(actor, id, { paidReference: 'TRX-2026-0001' });

      const payout = (await service.payouts()).find((one) => one.id === id);

      expect(payout?.status).toBe('paid');
      expect(payout?.paidReference).toBe('TRX-2026-0001');
      expect(payout?.entryGroupId, 'the payout points at its movement').toBeTruthy();
      expect(payout?.accountLast4, 'and names where it went').toBe('1234');

      /* The group balances: debits equal credits, to the minor unit. */
      const legs = await db.execute<{
        account: string;
        direction: string;
        amount_syp: string;
      }>(sql`
        SELECT account::text, direction::text, amount_syp::text
        FROM ledger_entries WHERE entry_group_id = ${payout!.entryGroupId}::uuid
      `);

      const sum = (direction: string) =>
        legs.rows
          .filter((leg) => leg.direction === direction)
          .reduce((total, leg) => total + Number(leg.amount_syp), 0);

      expect(sum('debit')).toBeCloseTo(sum('credit'), 2);
      expect(sum('credit')).toBeCloseTo(Number(payout!.netAmount), 2);
      expect(
        legs.rows.filter((leg) => leg.account === 'safra_payout'),
        'exactly one credit leg, to SAFRA payout',
      ).toHaveLength(1);

      /* And the summary follows the books rather than a stored balance. */
      const after = await service.revenueSummary();

      expect(Number(after.accrued), 'earning did not change').toBeCloseTo(
        Number(before.accrued),
        2,
      );
      expect(Number(after.transferred) - Number(before.transferred)).toBeCloseTo(
        Number(payout!.netAmount),
        2,
      );
      expect(Number(after.outstanding)).toBeCloseTo(
        Number(before.outstanding) - Number(payout!.netAmount),
        2,
      );
    });

    it('refuses to pay one that was never released', async () => {
      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      expect(
        codeOf(
          await service
            .markPaid(actor, id, { paidReference: 'TRX-3' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_NOT_PAYABLE);
    });

    it('cannot cancel one that is already paid', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const period = await periodWithRevenue();
      const { id } = await service.open(actor, {
        periodStart: period.from,
        periodEnd: period.to,
      });

      await service.release(actor, id);
      await service.markPaid(actor, id, { paidReference: 'TRX-4' });

      expect(
        codeOf(
          await service
            .cancel(actor, id, { reason: 'خطأ في الفترة المحدَّدة.' })
            .catch((error: unknown) => error),
        ),
      ).toBe(ERROR.SAFRA_PAYOUT_ALREADY_FINAL);
    });

    /* A destination a transfer points at cannot be removed — the record would lose its «where». */
    it('refuses to delete a destination a transfer used', async () => {
      const acc = await account();

      await service.verifyAccount(actor, acc.id);
      await service.updateAccount(actor, acc.id, { isDefault: true });

      const period = await periodWithRevenue();

      await service.open(actor, { periodStart: period.from, periodEnd: period.to });

      expect(
        codeOf(
          await service.removeAccount(actor, acc.id).catch((error: unknown) => error),
        ),
      ).toBe(ERROR.CATALOGUE_IN_USE);
    });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  /**
   * Every write records, and the trail never carries the account number.
   *
   * The second half is the one worth asserting as a SWEEP: an audit row is the place a masked
   * field most often un-masks itself, because whoever adds a payload key is thinking about
   * debuggability rather than about who reads the log.
   */
  it('audits both lifecycles without ever recording the number', async () => {
    const acc = await account();

    await service.verifyAccount(actor, acc.id);
    await service.updateAccount(actor, acc.id, { isDefault: true });

    const period = await periodWithRevenue();
    const { id } = await service.open(actor, {
      periodStart: period.from,
      periodEnd: period.to,
    });

    await service.release(actor, id);
    await service.markPaid(actor, id, { paidReference: 'TRX-5' });

    const rows = await db.execute<{ action: string; payload: string }>(sql`
      SELECT action, (coalesce(before, '{}'::jsonb) || coalesce(after, '{}'::jsonb))::text AS payload
      FROM audit_log
      WHERE action LIKE 'safra_payout%'
      ORDER BY created_at
    `);

    const actions = rows.rows.map((row) => row.action);

    expect(actions).toContain('safra_payout_account.created');
    expect(actions).toContain('safra_payout_account.verified');
    expect(actions).toContain('safra_payout.opened');
    expect(actions).toContain('safra_payout.released');
    expect(actions).toContain('safra_payout.paid');

    for (const row of rows.rows) {
      expect(row.payload, `${row.action} recorded the account number`).not.toContain(
        'SY12',
      );
      expect(row.payload, `${row.action} recorded the account number`).not.toContain(
        '34567890',
      );
    }

    /* The paid row names WHERE it went — the question an auditor asks first. */
    const paid = rows.rows.find((row) => row.action === 'safra_payout.paid');

    expect(paid?.payload).toContain('1234');
    expect(paid?.payload).toContain('TRX-5');
  });
});
