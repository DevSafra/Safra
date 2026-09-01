import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';
import { normaliseGiftCode } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { Env } from '../config/env.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';
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
/**
 * Rates for the LEDGER, which needs one per entry whatever the currencies are.
 *
 * Every `ledger_entries` row carries `amount_syp`, so posting a gift card's legs asks for the
 * card's rate to SYP. Only the three a card may be issued in answer here — anything else throws,
 * which is what the platform itself does and what makes a missing rate visible rather than silent.
 */
const RATES_TO_SYP: Record<string, string> = {
  SYP: '1',
  USD: '13000.00000000',
  EUR: '14000.00000000',
};

const fxForLedger = {
  rateToSyp: (code: string) => {
    const rate = RATES_TO_SYP[code];

    if (!rate) throw new Error(`No stub rate for ${code}`);

    return Promise.resolve(rate);
  },
  decimalsOf: () => Promise.resolve(2),
} as unknown as FxRateService;

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
  let sent: OutgoingMail[];

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    wallet = new WalletService(db, fxStub);
    sent = [];
    giftCards = new GiftCardService(
      db,
      { APP_URL: 'https://safra.test' } as unknown as Env,
      wallet,
      new AuditService(db),
      /* Captures what would have been sent, so the CODE in the body can be asserted. */
      {
        send: (mail: OutgoingMail) => Promise.resolve(void sent.push(mail)),
      } as unknown as MailService,
      new LedgerService(db),
      fxForLedger,
      new SettingsService(db),
    );
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
      /*
        Customer money, explicitly. A card may only be bought with the withdrawable part of a
        balance, so a fixture that credited compensation here would be refused — which is the rule
        working, and not what this test is about.
      */
      reason: 'profile_claim',
      restricted: '0',
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
             ${options.amount ?? '50.000'}::numeric, ${options.amount ?? '50.000'}::numeric,
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
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '75.000' });

    const result = await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    expect(result.creditedAmount).toBe('75.000');
    expect(result.creditedCurrency).toBe('USD');
    expect(result.walletBalance).toBe('75.000');

    const card = await db.execute<{ remaining: string; status: string }>(sql`
      SELECT remaining_amount::text AS remaining, status::text AS status
      FROM gift_cards WHERE reference = ${result.reference}`);

    expect(card.rows[0]).toStrictEqual({ remaining: '0.000', status: 'used' });
  });

  /** The card's own history, append-only by trigger. */
  it('records the draw-down on the card', async () => {
    const reference = await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '40.000' });

    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    /* Scoped to the card this test issued, by the reference the insert returned. */
    const txns = await db.execute<{ amount: string; balance_after: string }>(sql`
      SELECT t.amount::text AS amount, t.balance_after::text AS balance_after
      FROM gift_card_transactions t
      JOIN gift_cards g ON g.id = t.gift_card_id
      WHERE g.reference = ${reference}`);

    expect(txns.rows).toHaveLength(1);
    expect(txns.rows[0]).toStrictEqual({ amount: '40.000', balance_after: '0.000' });
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

    expect(result.creditedAmount).toBe('25.000');
  });

  /* `O` for `0` and `I`/`L` for `1` — the alphabet excludes those letters, so the mapping is safe. */
  it('maps the confusable letters onto their digits', async () => {
    await issue({ code: '01234-56789-ABCDE-FGHJK', amount: '30.000' });

    const result = await giftCards.redeem(customer(), 'OI234-56789-ABCDE-FGHJK');

    expect(result.creditedAmount).toBe('30.000');
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
      amount: '60.000',
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    expect(
      (await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX')).creditedAmount,
    ).toBe('60.000');
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
    expect(result.walletBalance).toBe('23.000');
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

    expect(result.card.originalAmount).toBe('100.000');
    expect(result.card.remainingAmount).toBe('100.000');
    expect(result.card.status).toBe('active');
    expect(result.walletBalance).toBe('20.000');
    /* Four groups of five, hyphenated, for reading off a screen. */
    expect(result.code).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}(-[0-9A-HJKMNP-TV-Z]{5}){3}$/);
  });

  /** The plaintext must not be recoverable from the row it created. */
  it('stores only a hash and the last four symbols', async () => {
    await fund('60.000');

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
    await fund('60.000');

    const bought = await giftCards.purchase(customer(), { amount: '50.00' });

    /* Redeemed by SOMEBODY ELSE, which is what a gift is. */
    const redeemed = await giftCards.redeem(
      customer(OTHER_PROFILE_ID, OTHER_USER_ID),
      bought.code,
    );

    expect(redeemed.creditedAmount).toBe('50.000');
    expect(redeemed.walletBalance).toBe('50.000');
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

  /**
   * The code reaches the buyer's inbox, because it reaches nowhere else.
   *
   * `gift_cards` keeps `code_hash` and `code_last4`, so after this request the plaintext is gone —
   * from us as much as from an attacker. If this email does not carry it, the customer's money is in
   * a card nobody can open.
   */
  it('emails the code to the purchaser', async () => {
    await fund('50.000');

    const result = await giftCards.purchase(customer(), { amount: '25.00' });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('gift-one@safra.test');
    /* The code itself, in the grouped form the response returned. */
    expect(sent[0]?.text).toContain(result.code);
    expect(sent[0]?.text).toContain(result.card.reference);
    expect(sent[0]?.subject).toContain(result.card.reference);
  });

  /**
   * A card bought FOR somebody reaches them — and the buyer too.
   *
   * The buyer is told because they paid and are the only one who can act on a mistyped address: we
   * keep no copy of the code, so a gift sent to the wrong inbox cannot be recovered any other way.
   */
  it('sends the gift to its recipient and a copy to the buyer', async () => {
    await fund('50.000');

    const result = await giftCards.purchase(customer(), {
      amount: '25.00',
      recipientName: 'شخص آخر',
      recipientEmail: 'someone-else@safra.test',
    });

    expect(sent.map((mail) => mail.to).sort()).toStrictEqual([
      'gift-one@safra.test',
      'someone-else@safra.test',
    ]);
    /* Both carry the code — it is the same card. */
    for (const mail of sent) expect(mail.text).toContain(result.code);
  });

  /**
   * Neither mail carries a name anybody typed.
   *
   * The recipient's address is chosen by the caller, so any free text echoed into that mail would be
   * a sentence delivered to a stranger over SAFRA's name for the price of one card. The buyer's
   * profile name is no safer than the recipient name — both are free text — so neither appears.
   */
  it('puts no caller-supplied text in either mail', async () => {
    await fund('50.000');

    await giftCards.purchase(customer(), {
      amount: '25.00',
      recipientName: 'سفرة: حسابك موقوف، اتصل بـ0555',
      recipientEmail: 'someone-else@safra.test',
    });

    const everything = JSON.stringify(sent);

    expect(everything).not.toContain('حسابك موقوف');
    expect(everything).not.toContain('0555');
    /* The buyer's own profile name is free text too, and is equally absent. */
    expect(everything).not.toContain('واحد');
  });

  /* A buyer who names their own address gets one mail, not two of the same thing. */
  it('does not send twice when the recipient is the buyer', async () => {
    await fund('50.000');

    await giftCards.purchase(customer(), {
      amount: '25.00',
      recipientEmail: 'GIFT-ONE@safra.test',
    });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('gift-one@safra.test');
  });

  /**
   * The body is withheld from the log when there is no mail transport.
   *
   * `MailService` prints whole bodies in that branch so a developer can click a reset link. A gift
   * code is not a reset link: the schema stores only a hash so that no plaintext exists at rest, and
   * a dev log is at rest. The purchase RESPONSE still carries the code, so nothing is lost.
   */
  it('marks both gift mails as carrying a secret', async () => {
    await fund('50.000');

    await giftCards.purchase(customer(), {
      amount: '25.00',
      recipientEmail: 'someone-else@safra.test',
    });

    expect(sent).toHaveLength(2);
    for (const mail of sent) expect(mail.sensitive).toBe(true);
  });

  /* A refused purchase has no card, so there is nothing to send and nobody to tell. */
  it('sends nothing when the purchase is refused', async () => {
    await fund('10.00');

    await expect(giftCards.purchase(customer(), { amount: '25.00' })).rejects.toThrow();
    expect(sent).toStrictEqual([]);
  });

  /**
   * A mail server that refuses must not un-buy a paid-for card.
   *
   * The real `MailService.send` swallows delivery errors, so this asserts the ORDER rather than the
   * swallowing: the send happens after the transaction commits, so a throw from it cannot roll back
   * a card the customer has already paid for.
   */
  it('keeps the card when the mail cannot be sent', async () => {
    await fund('50.000');

    const failing = new GiftCardService(
      db,
      { APP_URL: 'https://safra.test' } as unknown as Env,
      wallet,
      new AuditService(db),
      {
        send: () => Promise.reject(new Error('smtp refused')),
      } as unknown as MailService,
      new LedgerService(db),
      fxForLedger,
      new SettingsService(db),
    );

    await expect(failing.purchase(customer(), { amount: '25.00' })).rejects.toThrow();

    /* The card is committed regardless — this is the point. */
    const cards = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM gift_cards
      WHERE purchased_by_customer_id = ${PROFILE_ID}::uuid`);

    expect(cards.rows[0]?.count).toBe('1');
  });

  it('audits the purchase without recording the code', async () => {
    await fund('60.000');

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
    await fund('30.000');

    const result = await giftCards.purchase(customer(), {
      amount: '25.00',
      recipientName: 'ليلى',
      recipientEmail: 'laila@safra.test',
    });

    expect(result.card.recipientName).toBe('ليلى');
    expect(result.card.recipientEmail).toBe('laila@safra.test');
  });

  // ─── The split, and where a purchase may draw from ─────────────────────────

  /**
   * The two parts always sum to the balance.
   *
   * That is the one invariant a reader can check on the screen, so it is the one asserted here for
   * every case below rather than only the figures themselves.
   */
  it('reports the gift part and the rest, summing to the balance', async () => {
    await fund('10.00');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    const split = await wallet.composition(PROFILE_ID);

    /* Bashar's own example: a $25 card on a $10 refund balance reads 25 and 10, total 35. */
    expect(split?.balance).toBe('35.000');
    expect(split?.giftBalance).toBe('25.000');
    expect(Number(split?.balance) - Number(split?.giftBalance)).toBe(10);
  });

  it('has no gift part when nothing came from a card', async () => {
    await fund('40.000');

    const split = await wallet.composition(PROFILE_ID);

    expect(split?.giftBalance).toBe('0.000');
    expect(split?.balance).toBe('40.000');
  });

  /** Gift money goes first on ordinary spending, which is the conservative order. */
  it('spends the gift part first on a booking', async () => {
    await fund('10.00');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    await wallet.debit(db, {
      customerProfileId: PROFILE_ID,
      amount: '20.000',
      currencyId: await idOfCurrency(db, 'USD'),
      reason: 'booking_payment',
    });

    const split = await wallet.composition(PROFILE_ID);

    expect(split?.balance).toBe('15.000');
    expect(split?.giftBalance).toBe('5.000');
  });

  it('never reports a negative gift part once the gift is used up', async () => {
    await fund('10.00');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    await wallet.debit(db, {
      customerProfileId: PROFILE_ID,
      amount: '30.000',
      currencyId: await idOfCurrency(db, 'USD'),
      reason: 'booking_payment',
    });

    const split = await wallet.composition(PROFILE_ID);

    expect(split?.balance).toBe('5.000');
    expect(split?.giftBalance).toBe('0.000');
  });

  /**
   * Buying a card must NOT consume the gift part, or the two rules contradict each other.
   *
   * Gift 25 and cash 30, then a 25 card bought out of cash: if that debit ate gift money the split would
   * read 5 and 25 — claiming a purchase came from money it was forbidden to use. It must read 25 and 5.
   */
  it('does not let a card purchase consume the gift part', async () => {
    await fund('30.000');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    await giftCards.purchase(customer(), { amount: '25.00' });

    const split = await wallet.composition(PROFILE_ID);

    expect(split?.balance).toBe('30.000');
    expect(split?.giftBalance, 'the gift part must be untouched by a purchase').toBe(
      '25.000',
    );
  });

  /**
   * Nor with a compensation SAFRA credited (Bashar, 2026-09-01).
   *
   * The widened half of the same rule. A gift card is transferable — it leaves the platform in
   * somebody else's hands — so «compensation stays inside the SAFRA ecosystem» would be a rule
   * anybody could walk around by spending the compensation on a card. Asserted separately from the
   * gift case below because they are now two different reasons a balance can be unavailable, and a
   * single test would keep passing if either half were dropped.
   */
  it('refuses to buy a card with a compensation, even when the total covers it', async () => {
    await fund('10.00');

    /* Compensation, credited the way the SLA sweep credits it. */
    await wallet.credit(db, {
      customerProfileId: PROFILE_ID,
      amount: '25.00',
      currencyId: await idOfCurrency(db, 'USD'),
      reason: 'sla_compensation',
    });

    /* The total is 35, so this is affordable — and still refused: only 10 of it is theirs. */
    await expect(
      giftCards.purchase(customer(), { amount: '25.00' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'gift_card.cash_only' },
    });

    /* And the compensation is still there, unspent, for a stay. */
    const after = await wallet.composition(PROFILE_ID);

    expect(after?.balance).toBe('35.000');
    expect(after?.restrictedBalance).toBe('25.000');
  });

  /**
   * A card may only be bought with الرصيد الحالي (Bashar, 2026-08-11).
   *
   * Gift money poured into a fresh card would reset whatever expiry the old one carried and turn a
   * balance tied to one account into a bearer instrument. The wallet is where a gift ENDS.
   */
  it('refuses to buy a card with gift money, even when the total covers it', async () => {
    await fund('10.00');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    /* The total is 35, so this is affordable — and still refused, because only 10 of it is cash. */
    await expect(
      giftCards.purchase(customer(), { amount: '25.00' }),
    ).rejects.toMatchObject({
      status: 400,
      response: { code: 'gift_card.cash_only' },
    });
  });

  /**
   * And the refusal says WHICH problem it is.
   *
   * Telling somebody holding $35 that their balance is insufficient for a $25 card is untrue: the
   * reason is the source of the money, not the amount.
   */
  it('distinguishes "not enough" from "not that money"', async () => {
    await fund('10.00');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '25.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    /* 200 exceeds even the total, so this is the ordinary insufficient-balance refusal. */
    await expect(
      giftCards.purchase(customer(), { amount: '200.00' }),
    ).rejects.toMatchObject({ response: { code: 'wallet.insufficient_balance' } });
  });

  it('allows a card bought entirely from the cash part', async () => {
    await fund('30.000');
    await issue({ code: 'ABCDE-FGHJK-MNPQR-STVWX', amount: '50.00' });
    await giftCards.redeem(customer(), 'ABCDE-FGHJK-MNPQR-STVWX');

    const bought = await giftCards.purchase(customer(), { amount: '25.00' });

    expect(bought.card.originalAmount).toBe('25.000');

    const split = await wallet.composition(PROFILE_ID);

    /* 80 − 25 = 55, and the gift part is untouched at 50, so the cash part fell from 30 to 5. */
    expect(split?.balance).toBe('55.000');
    expect(split?.giftBalance).toBe('50.000');
  });

  // ─── Listing ───────────────────────────────────────────────────────────────

  it('lists the cards this customer bought and nobody else’s', async () => {
    await fund('60.000');
    await giftCards.purchase(customer(), { amount: '50.00' });
    await issue({ code: 'ZZZZZ-ZZZZZ-ZZZZZ-ZZZZZ', purchaser: OTHER_PROFILE_ID });

    const page = await giftCards.list(customer(), { limit: 20 });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.originalAmount).toBe('50.000');
  });

  /** No code, in any form, on a read. */
  it('never returns a code from the list', async () => {
    await fund('60.000');
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
