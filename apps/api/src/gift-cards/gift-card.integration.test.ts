import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';
import { normaliseGiftCode } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { GiftCardService } from './gift-card.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * بطاقات الهدايا against a real PostgreSQL.
 *
 * A gift card is a BEARER instrument — whoever holds the code can turn it into money — so what is
 * proven here is mostly refusal: an unknown code, a spent card, an expired one, and a second attempt
 * at one that has already paid out. Those are the cases where a mistake is somebody else's money.
 *
 * The round trip is proven too: a code returned by `purchase` redeems, and redeems for what was paid.
 * Hashing is easy to get subtly wrong in a way that only shows up as "no card ever works".
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const USER_ID = '99993333-0000-0000-0000-0000000000c1';
const PROFILE_ID = '99993333-0000-0000-0000-0000000000c2';
const OTHER_USER_ID = '99993333-0000-0000-0000-0000000000c3';
const OTHER_PROFILE_ID = '99993333-0000-0000-0000-0000000000c4';

/**
 * FX is stubbed, for the reason the wallet suite already documents: `FxRateService` owns
 * `fx_rates`, and depending on that table from a second file couples two suites. The conversion
 * arithmetic is the wallet's, and fixed rates exercise it.
 */
const RATES: Record<string, string> = {
  USD: '13000.00',
  EUR: '14000.00',
  SYP: '1',
};

const fxStub = {
  rateToSyp: (code: string) => {
    const rate = RATES[code];

    if (!rate) throw new Error(`No stub rate for ${code}`);

    return Promise.resolve(rate);
  },
} as unknown as FxRateService;

const customer = (profileId = PROFILE_ID, sub = USER_ID): AccessTokenClaims => ({
  sub,
  role: 'customer',
  permissions: [],
  locale: 'ar',
  customerProfileId: profileId,
});

/** A staff token: valid, with no customer account behind it. */
const staff: AccessTokenClaims = {
  sub: USER_ID,
  role: 'super_admin',
  permissions: [],
  locale: 'ar',
};

describeIfDb('GiftCardService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let wallet: WalletService;
  let giftCards: GiftCardService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    wallet = new WalletService(db, fxStub);
    giftCards = new GiftCardService(db, wallet, new AuditService(db));
    await seed(db);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** Gives the customer spendable balance, the way a refund or compensation would. */
  async function fund(amount: string, code = 'USD', profileId = PROFILE_ID) {
    const currencyId = await idOfCurrency(db, code);

    return wallet.credit(db, {
      customerProfileId: profileId,
      amount,
      currencyId,
      reason: 'refund',
    });
  }

  /** Inserts a card directly, so a test can choose its state without buying one. */
  async function issue(options: {
    code: string;
    amount?: string;
    currency?: string;
    status?: string;
    expiresAt?: string | null;
    purchaser?: string | null;
  }) {
    const normalised = normaliseGiftCode(options.code);
    const { createHash } = await import('node:crypto');
    const hash = createHash('sha256').update(normalised).digest('hex');

    const rows = await db.execute<{ reference: string }>(sql`
      INSERT INTO gift_cards
        (code_hash, code_last4, original_amount, remaining_amount, currency_id,
         status, expires_at, purchased_by_customer_id)
      SELECT ${hash}, ${normalised.slice(-4)},
             ${options.amount ?? '50.00'}::numeric, ${options.amount ?? '50.00'}::numeric,
             cur.id, ${options.status ?? 'active'}::gift_card_status,
             ${options.expiresAt ?? null}::timestamptz,
             ${options.purchaser ?? null}::uuid
      FROM currencies cur
      WHERE cur.code = ${options.currency ?? 'USD'}
      RETURNING reference
    `);

    return rows.rows[0]?.reference ?? '';
  }

  // ─── Redeeming ─────────────────────────────────────────────────────────────

  it('credits the wallet with the whole card and empties it', async () => {
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '75.00' });

    const result = await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    expect(result.creditedAmount).toBe('75.00');
    expect(result.creditedCurrency).toBe('USD');
    expect(result.walletBalance).toBe('75.00');

    const card = await db.execute<{ remaining: string; status: string }>(sql`
      SELECT remaining_amount::text AS remaining, status::text AS status
      FROM gift_cards WHERE reference = ${result.reference}`);

    expect(card.rows[0]).toStrictEqual({ remaining: '0.00', status: 'used' });
  });

  /** The card's own history, append-only by trigger. */
  it('records the draw-down on the card', async () => {
    const reference = await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '40.00' });

    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    /* Scoped to the card this test issued, by the reference the insert returned. */
    const txns = await db.execute<{ amount: string; balance_after: string }>(sql`
      SELECT t.amount::text AS amount, t.balance_after::text AS balance_after
      FROM gift_card_transactions t
      JOIN gift_cards g ON g.id = t.gift_card_id
      WHERE g.reference = ${reference}`);

    expect(txns.rows).toHaveLength(1);
    expect(txns.rows[0]).toStrictEqual({ amount: '40.00', balance_after: '0.00' });
  });

  it('moves the balance under the gift_card_transfer reason', async () => {
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    /* Scoped to THIS customer: `wallet_transactions` carries thousands of testbed rows. */
    const moves = await db.execute<{ reason: string; direction: string }>(sql`
      SELECT t.reason::text AS reason, t.direction::text AS direction
      FROM wallet_transactions t
      JOIN wallets w ON w.id = t.wallet_id
      WHERE w.customer_profile_id = ${PROFILE_ID}::uuid`);

    expect(moves.rows).toStrictEqual([
      { reason: 'gift_card_transfer', direction: 'credit' },
    ]);
  });

  /**
   * The code must not reach the audit log.
   *
   * An audit row is read by staff and kept for years. A code in one is a spendable code sitting in a
   * table designed never to be deleted.
   */
  it('audits the redemption without recording the code', async () => {
    const code = 'ABCDE-FGHJK-MNPQR-STVWX';

    const reference = await issue({ code });

    await giftCards.redeem(customer(), code);

    /*
      Scoped to THIS card. `audit_log` is append-only and shared: the browser suite redeems a real card
      on every run, so an unscoped query counts those too — which is how these assertions started
      failing once the feature was actually used.
    */
    const rows = await db.execute<{ action: string; payload: string }>(sql`
      SELECT a.action,
             (coalesce(a.before::text, '') || coalesce(a.after::text, '')) AS payload
      FROM audit_log a
      JOIN gift_cards g ON g.id = a.subject_id
      WHERE a.action = 'gift_card.redeem' AND g.reference = ${reference}`);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.payload).not.toContain('ABCDE');
    expect(rows.rows[0]?.payload).not.toContain(normaliseGiftCode(code));
    /* The reference is there, because that is how staff find the card. */
    expect(rows.rows[0]?.payload).toContain('GIF-');
  });

  /**
   * Normalisation is the same at both ends, so a code typed the way people type it works.
   *
   * Lower case, spaces instead of hyphens, and the confusable letters — somebody reading `0` off a
   * card types `O` often enough that refusing it would look like a broken card.
   */
  it.each([
    ['lower case', 'abcde-fghjk-mnpqr-stvwx'],
    ['spaces', 'ABCDE FGHJK MNPQR STVWX'],
    ['no separators', 'ABCDEFGHJKMNPQRSTVWX'],
    ['padded', '  ABCDE-FGHJK-MNPQR-STVWX  '],
  ])('accepts a code written with %s', async (_label, typed) => {
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });

    const result = await giftCards.redeem(customer(), typed);

    expect(result.creditedAmount).toBe('25.00');
  });

  /* `O` for `0` and `I`/`L` for `1` — the alphabet excludes those letters, so the mapping is safe. */
  it('maps the confusable letters onto their digits', async () => {
    await issue({ code: '01234-56789-ABCDE-FGHJK', amount: '30.00' });

    const result = await giftCards.redeem(customer(), 'OI234-56789-ABCDE-FGHJK');

    expect(result.creditedAmount).toBe('30.00');
  });

  it('refuses an unknown code', async () => {
    await expect(
      giftCards.redeem(customer(), 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'gift_card.code_invalid' },
    });
  });

  /** The second attempt pays out nothing, and says why. */
  it('refuses a card that has already been redeemed', async () => {
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    await expect(
      giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX'),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'gift_card.already_used' },
    });

    const moves = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
      FROM wallet_transactions t
      JOIN wallets w ON w.id = t.wallet_id
      WHERE w.customer_profile_id = ${PROFILE_ID}::uuid`);

    expect(moves.rows[0]?.n, 'the balance must move exactly once').toBe('1');
  });

  it('refuses an expired card', async () => {
    await issue({
      code: 'ABCDE-FGHJK-MNPQR-STVWX',
      expiresAt: new Date(Date.now() - 86_400_000).toISOString(),
    });

    await expect(
      giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX'),
    ).rejects.toMatchObject({ status: 400, response: { code: 'gift_card.expired' } });
  });

  it('accepts a card whose expiry is still ahead', async () => {
    await issue({
      code: 'ABCDE-FGHJK-MNPQR-STVWX',
      amount: '60.00',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(
      (await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX')).creditedAmount,
    ).toBe('60.00');
  });

  it('refuses a cancelled card distinctly, so support can be told', async () => {
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', status: 'cancelled' });

    await expect(
      giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX'),
    ).rejects.toMatchObject({ status: 400, response: { code: 'gift_card.cancelled' } });
  });

  it('refuses a soft-deleted card as though it did not exist', async () => {
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX' });
    await db.execute(sql`UPDATE gift_cards SET deleted_at = now()`);

    await expect(
      giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX'),
    ).rejects.toMatchObject({ response: { code: 'gift_card.code_invalid' } });
  });

  /**
   * A card in one currency, a wallet in another: one conversion, at a known rate.
   *
   * The wallet owns this — it holds a single currency and converts on the way in through SYP.
   */
  it('converts into the wallet currency when they differ', async () => {
    await fund('10.00', 'EUR');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '14.00', currency: 'USD' });

    const result = await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    /* The card was worth 14 USD; the wallet is in EUR and says so. */
    expect(result.creditedCurrency).toBe('USD');
    expect(result.walletCurrency).toBe('EUR');
    /* 14 USD × 13000 ÷ 14000 = 13.00 EUR, on top of the 10.00 already there. */
    expect(result.walletBalance).toBe('23.00');
  });

  it('refuses an anonymous caller', async () => {
    await expect(
      giftCards.redeem(undefined, 'ABCDE-FGHJK-MNPQR-STVWX'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('refuses a token with no customer profile', async () => {
    await expect(
      giftCards.redeem(staff, 'ABCDE-FGHJK-MNPQR-STVWX'),
    ).rejects.toMatchObject({ status: 404 });
  });

  // ─── Buying ────────────────────────────────────────────────────────────────

  it('buys a card out of the wallet and returns the code once', async () => {
    await fund('120.00');

    const result = await giftCards.purchase(customer(), { amount: '100.00' });

    expect(result.card.originalAmount).toBe('100.00');
    expect(result.card.remainingAmount).toBe('100.00');
    expect(result.card.status).toBe('active');
    expect(result.walletBalance).toBe('20.00');
    /* Four groups of five, hyphenated, for reading off a screen. */
    expect(result.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  });

  /** The plaintext must not be recoverable from the row it created. */
  it('stores only a hash and the last four symbols', async () => {
    await fund('60.00');

    const result = await giftCards.purchase(customer(), { amount: '50.00' });
    const normalised = normaliseGiftCode(result.code);

    const rows = await db.execute<{ code_hash: string; code_last4: string }>(sql`
      SELECT code_hash, code_last4 FROM gift_cards WHERE reference = ${result.card.reference}`);

    expect(rows.rows[0]?.code_hash).not.toBe(normalised);
    expect(rows.rows[0]?.code_hash).toHaveLength(64);
    expect(rows.rows[0]?.code_last4).toBe(normalised.slice(-4));
  });

  /**
   * The round trip — a bought code redeems, for what was paid.
   *
   * This is what catches a normalisation or hashing mismatch between the two ends, which would
   * otherwise present as "no card anybody buys ever works".
   */
  it('issues a code that redeems for the amount it was bought for', async () => {
    await fund('60.00');

    const bought = await giftCards.purchase(customer(), { amount: '50.00' });

    /* Redeemed by SOMEBODY ELSE, which is what a gift is. */
    const redeemed = await giftCards.redeem(
      customer(OTHER_PROFILE_ID, OTHER_USER_ID),
      bought.code,
    );

    expect(redeemed.creditedAmount).toBe('50.00');
    expect(redeemed.walletBalance).toBe('50.00');
  });

  it('refuses a purchase the wallet cannot cover, and creates no card', async () => {
    await fund('10.00');

    await expect(
      giftCards.purchase(customer(), { amount: '100.00' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'wallet.insufficient_balance' },
    });

    const cards = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM gift_cards
      WHERE purchased_by_customer_id = ${PROFILE_ID}::uuid`);

    expect(cards.rows[0]?.n).toBe('0');
  });

  it('refuses a purchase with no wallet at all', async () => {
    await expect(
      giftCards.purchase(customer(), { amount: '25.00' }),
    ).rejects.toMatchObject({ response: { code: 'wallet.insufficient_balance' } });
  });

  it('audits the purchase without recording the code', async () => {
    await fund('60.00');

    const bought = await giftCards.purchase(customer(), { amount: '50.00' });

    const rows = await db.execute<{ payload: string }>(sql`
      SELECT (coalesce(a.before::text, '') || coalesce(a.after::text, '')) AS payload
      FROM audit_log a
      JOIN gift_cards g ON g.id = a.subject_id
      WHERE a.action = 'gift_card.purchase' AND g.reference = ${bought.card.reference}`);

    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.payload).not.toContain(normaliseGiftCode(bought.code));
    expect(rows.rows[0]?.payload).toContain('GIF-');
  });

  it('keeps the recipient as a label when one is given', async () => {
    await fund('30.00');

    const result = await giftCards.purchase(customer(), {
      amount: '25.00',
      recipientName: 'ليلى',
      recipientEmail: 'laila@safra.test',
    });

    expect(result.card.recipientName).toBe('ليلى');
    expect(result.card.recipientEmail).toBe('laila@safra.test');
  });

  // ─── Listing ───────────────────────────────────────────────────────────────

  it('lists the cards this customer bought and nobody else’s', async () => {
    await fund('60.00');
    await giftCards.purchase(customer(), { amount: '50.00' });
    await issue({ code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', purchaser: OTHER_PROFILE_ID });

    const page = await giftCards.list(customer(), { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.originalAmount).toBe('50.00');
  });

  /** No code, in any form, on a read. */
  it('never returns a code from the list', async () => {
    await fund('60.00');
    await giftCards.purchase(customer(), { amount: '50.00' });

    const page = await giftCards.list(customer(), { limit: 20 });
    const serialised = JSON.stringify(page);

    expect(serialised).not.toMatch(/"code"/);
    expect(serialised).not.toMatch(/code_hash/);
    /* The last four are present on purpose, so a buyer can tell two cards apart. */
    expect(page.items[0]?.codeLast4).toHaveLength(4);
  });

  it('refuses a forged cursor', async () => {
    await expect(
      giftCards.list(customer(), { limit: 20, cursor: 'not-a-cursor' }),
    ).rejects.toMatchObject({ status: 400 });
  });
});

async function idOfCurrency(db: Database, code: string): Promise<string> {
  const rows = await db.execute<{ id: string }>(
    sql`SELECT id FROM currencies WHERE code = ${code}`,
  );

  return rows.rows[0]?.id ?? '';
}

async function seed(db: Database): Promise<void> {
  for (const [id, email] of [
    [USER_ID, 'gift-one@safra.test'],
    [OTHER_USER_ID, 'gift-two@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO users (id, email, role) VALUES (${id}::uuid, ${email}, 'customer')
      ON CONFLICT DO NOTHING`);
  }

  for (const [id, userId, name, email] of [
    [PROFILE_ID, USER_ID, 'واحد', 'gift-one@safra.test'],
    [OTHER_PROFILE_ID, OTHER_USER_ID, 'اثنان', 'gift-two@safra.test'],
  ] as const) {
    await db.execute(sql`
      INSERT INTO customer_profiles (id, user_id, full_name, email, phone, is_guest)
      VALUES (${id}::uuid, ${userId}::uuid, ${name}, ${email}, '+963900000040', false)
      ON CONFLICT DO NOTHING`);
  }
}
