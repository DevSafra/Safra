import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { codeOf } from '../common/errors/app-error.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { WalletService, withdrawableOf } from './wallet.service.js';

/**
 * Money SAFRA gave you, and money that was yours (Bashar, 2026-09-01).
 *
 * ## What is being protected
 *
 * A compensation buys a stay and never becomes cash; a refund of what the customer paid stays
 * theirs to take back. One balance holds both, so every assertion here is about the same question
 * asked at a different moment: **after this movement, how much of the balance could still leave?**
 *
 * Against a real PostgreSQL because half the guarantee is in the database — two CHECK constraints
 * and an append-only trigger — and because the interesting cases are sequences, not calls.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const RATES: Record<string, string> = { USD: '13000.00', SYP: '1' };
const DECIMALS: Record<string, number> = { USD: 2, SYP: 2 };

const fxStub = {
  rateToSyp: (code: string) => Promise.resolve(RATES[code] ?? '1'),
  decimalsOf: (code: string) => Promise.resolve(DECIMALS[code] ?? 2),
} as unknown as FxRateService;

describeIfDb('restricted and withdrawable balance', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let wallet: WalletService;
  let profileId: string;
  let usd: string;
  let bookingId: string;
  let otherBookingId: string;

  beforeEach(async () => {
    await harness.begin();

    wallet = new WalletService(db, fxStub);
    profileId = await createCustomer(db);
    usd = await currencyId(db, 'USD');
    [bookingId, otherBookingId] = await twoBookings(db);
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** What the customer could ever be paid out, as the service reports it. */
  async function withdrawable(): Promise<string> {
    const current = await wallet.findByCustomer(profileId);

    return withdrawableOf(current ?? { balance: '0', restrictedBalance: '0' });
  }

  // ── Where a credit comes from ─────────────────────────────────────────────

  it('holds a compensation inside the platform', async () => {
    const credited = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    expect(credited.balance).toBe('40.000');
    expect(credited.restrictedBalance).toBe('40.000');
    expect(await withdrawable()).toBe('0.000');
  });

  it('leaves money the customer funded withdrawable', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'admin_adjustment',
      restricted: '0',
      createdByUserId: await financeUser(db),
    });

    expect(await withdrawable()).toBe('40.000');
  });

  // ── The path the whole design exists for ──────────────────────────────────

  /**
   * Spend a compensation on a stay, cancel the stay, and it must come back as what it was.
   *
   * This is the sentence that matters: without it the control is undone by the most ordinary event
   * in the system. A $40 compensation paid onto a booking and refunded would return as $40 of
   * unclassified money, and «compensation cannot be withdrawn» would mean «compensation cannot be
   * withdrawn until you book something and cancel it».
   */
  it('returns a refunded compensation as a compensation', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'booking_payment',
      bookingId,
    });

    expect(await withdrawable()).toBe('0.000');

    const returned = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'refund',
      bookingId,
    });

    expect(returned.balance).toBe('40.000');
    expect(returned.restrictedApplied).toBe('40.000');
    expect(await withdrawable()).toBe('0.000');
  });

  /**
   * And the other direction, which is the half that would make the rule unfair rather than unsafe.
   *
   * A booking paid out of the customer's own money and refunded must come back withdrawable. A
   * control that classified every refund as restricted would be perfectly safe and would quietly
   * confiscate what people paid — asserted here because a one-line change makes the safe answer
   * the wrong answer, and nothing else in this file would notice.
   */
  it('returns a refunded payment of the customer’s own money as theirs', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'admin_adjustment',
      restricted: '0',
      createdByUserId: await financeUser(db),
    });

    await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'booking_payment',
      bookingId,
    });

    const returned = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'refund',
      bookingId,
    });

    expect(returned.restrictedApplied).toBe('0.000');
    expect(await withdrawable()).toBe('40.000');
  });

  /**
   * A mixed booking, refunded in two parts.
   *
   * $30 compensation and $20 of their own money pay for one stay; the refunds arrive separately.
   * Restricted comes back first — the mirror of spending it first — so after the first $20 the
   * whole return is still SAFRA's money, and the customer's $20 is intact by the end.
   */
  it('returns the restricted part of a mixed booking first, and all of it eventually', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '30.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '20.00',
      currencyId: usd,
      reason: 'admin_adjustment',
      restricted: '0',
      createdByUserId: await financeUser(db),
    });

    await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '50.00',
      currencyId: usd,
      reason: 'booking_payment',
      bookingId,
    });

    const first = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '20.00',
      currencyId: usd,
      reason: 'refund',
      bookingId,
    });

    expect(first.restrictedApplied).toBe('20.000');
    expect(await withdrawable()).toBe('0.000');

    const second = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '30.00',
      currencyId: usd,
      reason: 'refund',
      bookingId,
    });

    /* 30 of the 50 was SAFRA's, and 30 is what came back restricted across the two refunds. */
    expect(second.restrictedApplied).toBe('10.000');
    expect(await withdrawable()).toBe('20.000');
  });

  /**
   * A refund can only restore what ITS OWN booking took.
   *
   * Otherwise a wallet holding a large compensation would turn every unrelated refund into
   * restricted money — and, read the other way, a refund against a booking that spent nothing
   * restricted could not be quietly held back.
   */
  it('does not let one booking’s refund borrow another booking’s restriction', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'booking_payment',
      bookingId,
    });

    const unrelated = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'refund',
      bookingId: otherBookingId,
    });

    expect(unrelated.restrictedApplied).toBe('0.000');
    expect(await withdrawable()).toBe('40.000');
  });

  // ── Spending ──────────────────────────────────────────────────────────────

  /**
   * Restricted money goes first.
   *
   * The conservative order in both senses: nobody is told they still hold a compensation they have
   * spent, and the part left behind is the customer's own — the part that could one day be paid
   * out, rather than the part that can only ever be spent here.
   */
  it('spends the restricted part before the customer’s own', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '30.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '20.00',
      currencyId: usd,
      reason: 'admin_adjustment',
      restricted: '0',
      createdByUserId: await financeUser(db),
    });

    const spent = await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '35.00',
      currencyId: usd,
      reason: 'booking_payment',
      bookingId,
    });

    expect(spent.restrictedApplied).toBe('30.000');
    expect(spent.balance).toBe('15.000');
    expect(await withdrawable()).toBe('15.000');
  });

  /**
   * A movement that may not touch restricted money is measured against the part that is free.
   *
   * The refusal names its own code. «Your balance is too small» to somebody holding $40 is untrue,
   * and the difference between the two sentences is the whole explanation the customer gets.
   */
  it('refuses a withdrawable-only debit against a compensated balance', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    const attempt = wallet.debit(db, {
      customerProfileId: profileId,
      amount: '10.00',
      currencyId: usd,
      reason: 'gift_card_transfer',
      from: 'withdrawable',
    });

    await expect(attempt.catch(codeOf)).resolves.toBe(ERROR.WALLET_NOT_WITHDRAWABLE);

    /* And it refused rather than partially applying: the balance is untouched. */
    const after = await wallet.findByCustomer(profileId);

    expect(after?.balance).toBe('40.000');
  });

  it('allows a withdrawable-only debit up to the free part', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '25.00',
      currencyId: usd,
      reason: 'admin_adjustment',
      restricted: '0',
      createdByUserId: await financeUser(db),
    });

    const taken = await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '25.00',
      currencyId: usd,
      reason: 'gift_card_transfer',
      from: 'withdrawable',
    });

    /* It took none of the compensation — that is what the mode means. */
    expect(taken.restrictedApplied).toBe('0.000');
    expect(taken.restrictedBalance).toBe('40.000');
    expect(await withdrawable()).toBe('0.000');
  });

  // ── Carried, reconciled, and refused by the database ──────────────────────

  it('carries the restriction onto the profile that claims a guest balance', async () => {
    const guest = await createCustomer(db);

    await wallet.credit(db, {
      customerProfileId: guest,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    const taken = await wallet.debit(db, {
      customerProfileId: guest,
      amount: '40.00',
      currencyId: usd,
      reason: 'profile_claim',
    });

    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'profile_claim',
      restricted: taken.restrictedApplied,
    });

    expect(await withdrawable()).toBe('0.000');
  });

  /**
   * The cache and the trail must agree about the restricted part too.
   *
   * `restricted_balance` stands to `restricted_amount` exactly as `balance` stands to `amount`, and
   * it is the number that would gate a payout — so a drift here is not a display bug.
   */
  it('keeps the restricted cache equal to the sum of its movements', async () => {
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '30.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });
    await wallet.debit(db, {
      customerProfileId: profileId,
      amount: '10.00',
      currencyId: usd,
      reason: 'booking_payment',
      bookingId,
    });
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '10.00',
      currencyId: usd,
      reason: 'refund',
      bookingId,
    });

    const current = await wallet.findByCustomer(profileId);

    expect(current?.restrictedBalance).toBe('30.000');
    expect(await wallet.sumRestricted(current?.walletId ?? '')).toBe('30.000');
  });

  /**
   * The database refuses a withdrawal that takes restricted money, with no service involved.
   *
   * There is no payout endpoint yet, which is exactly why this is asserted against raw SQL: the
   * rule has to be waiting for the code that has not been written. A service can be bypassed by a
   * repair script, a seed or a second implementation; a CHECK constraint cannot.
   */
  it('refuses a withdrawal of restricted money at the database', async () => {
    const credited = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    const withdrawal = (restricted: string): Promise<unknown> =>
      db.execute(sql`
        INSERT INTO wallet_transactions
          (wallet_id, direction, reason, amount, restricted_amount, currency_id, balance_after)
        VALUES (${credited.walletId}, 'debit', 'withdrawal', '10.00', ${restricted},
                ${usd}, '30.00')
      `);

    expect(await refusal(withdrawal('10.00'))).toBe(
      'wallet_transactions_withdrawal_is_unrestricted',
    );

    /*
      The control, and it is the half that proves the constraint is not simply refusing
      everything: the same withdrawal taking money that is NOT restricted is accepted.
    */
    expect(await refusal(withdrawal('0.00'))).toBe('');
  });

  it('refuses a restricted part larger than the balance it belongs to', async () => {
    const credited = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    const set = (value: string): Promise<unknown> =>
      db.execute(sql`
        UPDATE wallets SET restricted_balance = ${value} WHERE id = ${credited.walletId}
      `);

    expect(await refusal(set('40.001'))).toBe('wallets_restricted_within_balance');
    expect(await refusal(set('-0.001'))).toBe('wallets_restricted_within_balance');

    /* Control: the whole balance restricted is legitimate, and is what a clamp produces. */
    expect(await refusal(set('40.000'))).toBe('');
  });

  it('refuses a movement claiming more restricted money than it moved', async () => {
    const credited = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '40.00',
      currencyId: usd,
      reason: 'sla_compensation',
    });

    const movement = (restricted: string): Promise<unknown> =>
      db.execute(sql`
        INSERT INTO wallet_transactions
          (wallet_id, direction, reason, amount, restricted_amount, currency_id, balance_after)
        VALUES (${credited.walletId}, 'credit', 'sla_compensation', '10.00', ${restricted},
                ${usd}, '50.00')
      `);

    expect(await refusal(movement('10.01'))).toBe(
      'wallet_transactions_restricted_within_amount',
    );
    expect(await refusal(movement('10.00'))).toBe('');
  });
});

/**
 * The name of the constraint that refused, or `''` when nothing did.
 *
 * The NAME rather than the message: a message is prose and gets reworded, and an assertion against
 * prose passes for the wrong reason on the day somebody improves it. `''` for success is what makes
 * the control assertions readable — the same statement, expected to be accepted.
 */
async function refusal(work: Promise<unknown>): Promise<string> {
  try {
    await work;

    return '';
  } catch (error) {
    const cause = (error as { cause?: { constraint?: string } }).cause;

    return cause?.constraint ?? String((error as Error).message);
  }
}

async function createCustomer(db: Database): Promise<string> {
  const id = randomUUID();

  await db.execute(sql`
    INSERT INTO customer_profiles (id, full_name, email, phone)
    VALUES (${id}::uuid, 'Restricted Funds Test',
            ${`restricted-${id}@safra.test`}, '+963900000004')`);

  return id;
}

async function currencyId(db: Database, code: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM currencies WHERE code = ${code}`,
  );

  const id = rows.rows[0]?.id;
  if (!id) throw new Error(`Currency ${code} is not seeded.`);

  return id;
}

async function financeUser(db: Database): Promise<string> {
  const id = '99992222-0000-0000-0000-0000000000c4';

  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${id}::uuid, 'restricted-funds-finance@safra.test', 'finance_officer')
    ON CONFLICT DO NOTHING`);

  return id;
}

/**
 * Two existing bookings, borrowed rather than built.
 *
 * The wallet needs nothing from a booking but its id — the refund rule reads which of THIS
 * wallet's movements name it — and building one means a partner, a property, a unit and a stay.
 * Loud rather than skipped if the fixtures are missing: a suite that quietly passes on an empty
 * database is the failure mode this project has already paid for once.
 */
async function twoBookings(db: Database): Promise<[string, string]> {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT id::text AS id FROM bookings WHERE deleted_at IS NULL ORDER BY created_at LIMIT 2
  `);

  const [first, second] = rows.rows;

  if (!first || !second) {
    throw new Error('Two seeded bookings are required — run pnpm db:testbed.');
  }

  return [first.id, second.id];
}
