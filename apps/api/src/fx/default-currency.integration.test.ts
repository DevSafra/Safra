import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { DEFAULT_MONEY_CURRENCY, ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { FxRateService } from './fx-rate.service.js';
import { GiftCardService } from '../gift-cards/gift-card.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';

/**
 * The default-currency model: USD is what the platform QUOTES, SYP is what the ledger COUNTS in.
 *
 * ## Why they are two different things
 *
 * `DEFAULT_MONEY_CURRENCY` is USD (Bashar, 2026-08-26) — the currency money is assumed to be in
 * when nothing says otherwise. `ledger_entries.amount_syp` is SYP, because that is what SAFRA
 * settles in, and it CANNOT follow the default: the table is append-only, `trialBalance()` sums
 * that column across every group, and the rows already written can never be converted.
 *
 * The bridge is exactly one configured rate, USD→SYP. This file pins what that means in practice.
 *
 * ## What is asserted
 *
 * 1. **The USD path works with nothing but the USD rate.** Every non-USD rate is removed inside the
 *    rollback, and a wallet credit, a gift card, a compensation and their ledger legs all complete.
 * 2. **A missing non-USD rate fails loudly**, with a code, on every one of those paths.
 * 3. **No conversion between two DIFFERENT currencies can be 1:1**, ever — the one thing that would
 *    let a EUR liability be booked as though it were dollars.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the default currency model', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let fx: FxRateService;
  let wallet: WalletService;
  let cards: GiftCardService;
  let staffId = '';
  let profileId = '';

  const STAFF = (sub: string): AccessTokenClaims =>
    ({
      sub,
      role: 'finance_officer',
      permissions: ['gift_card.manage'],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    fx = new FxRateService(db, new AuditService(db));
    wallet = new WalletService(db, fx);
    cards = new GiftCardService(
      db,
      { APP_URL: 'https://safra.test' } as unknown as Env,
      wallet,
      new AuditService(db),
      { send: (_m: OutgoingMail) => Promise.resolve() } as unknown as MailService,
      new LedgerService(db),
      fx,
    );

    /*
      Every rate EXCEPT the one anchoring the default currency.

      This is the platform as it actually stands on 2026-08-26 — USD configured, EUR, JOD and LBP
      not — made explicit rather than inherited from whatever the developer database happens to
      hold. `FxRateService` caches, so a fresh one is built above per test.
    */
    await db.execute(sql`
      DELETE FROM fx_rates
      WHERE base_currency_id <> (SELECT id FROM currencies WHERE code = 'USD')
    `);

    const staff = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('fx-' || gen_random_uuid() || '@safra.test', '+963900000100',
              'finance_officer', 'active')
      RETURNING id
    `);

    staffId = staff.rows[0]?.id ?? '';

    const customer = await db.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest)
      VALUES ('نزيل العملة', 'fx-c-' || gen_random_uuid() || '@safra.test',
              '+963900000101', false)
      RETURNING id
    `);

    profileId = customer.rows[0]?.id ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const idOf = async (code: string): Promise<string> => {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${code}
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw new Error(`${code} is not seeded.`);

    return id;
  };

  it('quotes in USD by default', () => {
    expect(DEFAULT_MONEY_CURRENCY).toBe('USD');
  });

  /* ── 1. The USD path, on the USD rate alone ─────────────────────────────────────────────── */

  it('credits a wallet in USD', async () => {
    const movement = await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '25.00',
      currencyId: await idOf(DEFAULT_MONEY_CURRENCY),
      reason: 'sla_compensation',
    });

    expect(movement.currencyCode).toBe('USD');
    expect(movement.balance).toBe('25.000');
  });

  it('issues a gift card in USD, ledger legs and all', async () => {
    const result = await cards.issue(STAFF(staffId), {
      amount: '40.00',
      currency: DEFAULT_MONEY_CURRENCY,
      recipientEmail: 'guest@example.test',
      reason: 'اختبار مسار الدولار.',
    });

    const legs = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM ledger_entries
      WHERE description LIKE ${'%' + result.card.reference + '%'}
    `);

    expect(legs.rows[0]?.n, 'a balanced group was posted').toBe('2');
  });

  it('redeems a USD card into a USD wallet', async () => {
    const issued = await cards.issue(STAFF(staffId), {
      amount: '15.00',
      currency: DEFAULT_MONEY_CURRENCY,
      recipientEmail: 'guest@example.test',
      reason: 'اختبار الاستخدام.',
    });

    const redeemed = await cards.redeem(
      {
        sub: staffId,
        role: 'customer',
        customerProfileId: profileId,
      } as unknown as AccessTokenClaims,
      issued.code,
    );

    expect(redeemed.walletBalance).toBe('15.000');
  });

  /* ── 2. A missing non-USD rate fails loudly, on every path ──────────────────────────────── */

  /**
   * The refusal, not a default.
   *
   * `PRICING_UNAVAILABLE` is a CODE the console can translate, not a silent 1. Before this
   * behaviour existed the service fell back to `?? '1'`, which understated every SYP figure by
   * roughly four orders of magnitude and said nothing.
   */
  it('refuses to price a currency it holds no rate for', async () => {
    for (const currency of ['EUR', 'JOD', 'LBP']) {
      await expect(fx.rateToSyp(currency), currency).rejects.toMatchObject({
        response: { code: ERROR.PRICING_UNAVAILABLE },
      });
    }
  });

  it('refuses a EUR gift card rather than booking it as dollars', async () => {
    await expect(
      cards.issue(STAFF(staffId), {
        amount: '40.00',
        currency: 'EUR',
        recipientEmail: 'guest@example.test',
        reason: 'اختبار الرفض.',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.PRICING_UNAVAILABLE } });

    /* And nothing was left behind: no card, no liability, no half-written group. */
    const cardsWritten = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM gift_cards
      WHERE currency_id = (SELECT id FROM currencies WHERE code = 'EUR')
    `);

    expect(cardsWritten.rows[0]?.n, 'the transaction rolled back').toBe('0');
  });

  it('refuses a cross-currency wallet credit it cannot convert', async () => {
    /* A USD wallet exists; the credit arrives in EUR and there is no rate to reach it. */
    await wallet.credit(db, {
      customerProfileId: profileId,
      amount: '10.00',
      currencyId: await idOf('USD'),
      reason: 'sla_compensation',
    });

    await expect(
      wallet.credit(db, {
        customerProfileId: profileId,
        amount: '10.00',
        currencyId: await idOf('EUR'),
        reason: 'sla_compensation',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.PRICING_UNAVAILABLE } });
  });

  /* ── 3. Never an implicit 1:1 between two different currencies ──────────────────────────── */

  /**
   * The assertion that matters most, and the cheapest one to lose.
   *
   * A rate of 1 between two DIFFERENT currencies is how a EUR liability gets booked as dollars —
   * silently, plausibly, and wrong by whatever the pair actually differ by. Only a currency's rate
   * to ITSELF may be 1, and only SYP has one here because SYP is the unit the ledger counts in.
   */
  it('never converts between two different currencies at 1', async () => {
    /* SYP to itself is the one legitimate identity — it IS the unit of account. */
    expect(await fx.rateToSyp('SYP')).toBe('1');

    /* Everything else must come from a configured rate, and must not be 1. */
    const usd = await fx.rateToSyp('USD');

    expect(Number(usd), 'a real USD→SYP rate, not an identity').toBeGreaterThan(1);

    /*
      And the rest REFUSE rather than falling back. Asked of every active currency rather than the
      three that happen to be unconfigured today, so a currency added later is covered by
      construction.
    */
    const active = await db.execute<{ code: string }>(sql`
      SELECT code FROM currencies WHERE is_active AND code NOT IN ('SYP', 'USD')
    `);

    expect(active.rows.length, 'there are other currencies to check').toBeGreaterThan(0);

    for (const { code } of active.rows) {
      await expect(
        fx.rateToSyp(code),
        `${code} must refuse, never default`,
      ).rejects.toBeDefined();
    }
  });

  /**
   * And no ledger entry can carry a rate of 1 for a currency that is not the unit of account.
   *
   * Belt to the braces above: even if a rate of 1 were somehow obtained, this is the row it would
   * have to write, and the platform has never written one.
   */
  /**
   * And no ledger entry written SINCE the fallback was removed carries an implicit parity.
   *
   * ## The cutoff is not arbitrary, and the rows before it are real
   *
   * 44 entries — 22 `partner_payable` and 22 `partner_payout`, all USD, all dated 7–8 August 2026 —
   * carry `fx_rate_to_syp = 1`. They are residue of the `?? '1'` fallback this service used to
   * have, which the error message it now throws describes: «Refusing rather than defaulting to 1,
   * which would understate every SYP figure». Their `amount_syp` understates by roughly four
   * orders of magnitude — 12,276 recorded where about 159.6 million belongs.
   *
   * They CANNOT be corrected: `ledger_entries` is append-only by trigger, because §13.3 requires an
   * immutable record of every financial movement. Both sides of each group are understated by the
   * same factor, so the trial balance still BALANCES; what is wrong is the magnitude of those two
   * accounts, and it is wrong for ever.
   *
   * So this guards the live system rather than reporting a fact nobody can change. Nothing has
   * written a parity row since 8 August, and this fails the moment something does.
   */
  it('writes no ledger entry at an implicit parity', async () => {
    const bad = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
      FROM ledger_entries l
      JOIN currencies c ON c.id = l.currency_id
      WHERE l.fx_rate_to_syp = 1
        AND c.code <> 'SYP'
        AND l.created_at > DATE '2026-08-09'
    `);

    expect(bad.rows[0]?.n, 'a non-SYP entry booked at parity').toBe('0');
  });
});
