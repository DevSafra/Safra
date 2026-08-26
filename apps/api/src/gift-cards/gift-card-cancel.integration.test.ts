import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { GiftCardService } from './gift-card.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';

/**
 * Voiding a live card, and the whole domain's ledger legs.
 *
 * ## Two gaps, one shape
 *
 * `cancelled` was a status nothing could write — only READ, in the guard that refuses to redeem
 * one. So there was no way to void a card at all: not when a recipient reports the email was
 * intercepted, not when one is issued for the wrong amount. That mattered more once staff could
 * create them, because only `code_hash` is stored and a card cannot be recalled by finding its code.
 *
 * `gift_card_redemption` was a ledger ACCOUNT with no writer, for the same reason at a different
 * layer: a card was bought, given away and spent entirely outside `ledger_entries`, so money SAFRA
 * owed whoever held a live card appeared nowhere in the books.
 */
const RATES_TO_SYP: Record<string, string> = {
  SYP: '1',
  USD: '13000.00000000',
  EUR: '14000.00000000',
};

const fxStub = {
  rateToSyp: (code: string) => {
    const rate = RATES_TO_SYP[code];

    if (!rate) throw new Error(`No stub rate for ${code}`);

    return Promise.resolve(rate);
  },
  decimalsOf: () => Promise.resolve(2),
} as unknown as FxRateService;

const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('cancelling a gift card', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: OutgoingMail[] = [];
  let cards: GiftCardService;
  let staffId = '';

  const STAFF = (sub: string): AccessTokenClaims =>
    ({
      sub,
      role: 'finance_officer',
      permissions: ['gift_card.manage'],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    sent.length = 0;

    cards = new GiftCardService(
      db,
      { APP_URL: 'https://safra.test' } as unknown as Env,
      new WalletService(db, fxStub),
      new AuditService(db),
      {
        send: (mail: OutgoingMail) => Promise.resolve(void sent.push(mail)),
      } as unknown as MailService,
      new LedgerService(db),
      fxStub,
      new SettingsService(db),
    );

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('gc-cancel-' || gen_random_uuid() || '@safra.test', '+963900000098',
              'finance_officer', 'active')
      RETURNING id
    `);

    staffId = made.rows[0]?.id ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /** A card belonging to nobody — the shape staff issue. */
  const issued = async () =>
    (
      await cards.issue(STAFF(staffId), {
        amount: '60.00',
        currency: 'USD',
        recipientEmail: 'guest@example.test',
        reason: 'تعويض عن تأخّر.',
      })
    ).card.reference;

  /** A card somebody BOUGHT, so the value is theirs and must come back to them. */
  async function bought(): Promise<{ reference: string; profileId: string }> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest)
      VALUES ('مشتري البطاقة', 'gc-buy-' || gen_random_uuid() || '@safra.test',
              '+963900000099', false)
      RETURNING id
    `);

    const profileId = made.rows[0]?.id ?? '';

    const card = await db.execute<{ reference: string }>(sql`
      INSERT INTO gift_cards
        (code_hash, code_last4, original_amount, remaining_amount, currency_id,
         status, purchased_by_customer_id)
      VALUES ('hash-' || gen_random_uuid(), '4242', '60.00', '60.00',
              (SELECT id FROM currencies WHERE code = 'USD'), 'active', ${profileId}::uuid)
      RETURNING reference
    `);

    return { reference: card.rows[0]?.reference ?? '', profileId };
  }

  const statusOf = async (reference: string): Promise<string> => {
    const rows = await db.execute<{ status: string; remaining: string }>(sql`
      SELECT status::text AS status, remaining_amount::text AS remaining
      FROM gift_cards WHERE reference = ${reference}
    `);

    return `${rows.rows[0]?.status}:${rows.rows[0]?.remaining}`;
  };

  const legsFor = async (reference: string) =>
    (
      await db.execute<{
        account: string;
        direction: string;
        amount: string;
        group: string;
      }>(sql`
        SELECT account::text, direction::text, amount::text, entry_group_id::text AS group
        FROM ledger_entries
        WHERE description LIKE ${'%' + reference + '%'}
        ORDER BY entry_group_id, account::text
      `)
    ).rows;

  /**
   * THE assertion: a live card can be voided, and it says so.
   *
   * Watched to fail with the route removed — which is where this started: `cancelled` was in the
   * enum, `GIFT_CARD_MANAGE` was held by finance, and nothing connected them.
   */
  it('voids a live card and zeroes what is left on it', async () => {
    const reference = await issued();

    await cards.cancel(STAFF(staffId), reference, { reason: 'أُصدرت بقيمة خاطئة.' });

    expect(await statusOf(reference)).toBe('cancelled:0.000');
  });

  /** And a voided card cannot then be spent — the guard that always existed still holds. */
  it('cannot be redeemed afterwards', async () => {
    const reference = await issued();

    await cards.cancel(STAFF(staffId), reference, { reason: 'أُصدرت بقيمة خاطئة.' });

    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM gift_cards WHERE reference = ${reference}
    `);

    expect(rows.rows[0]?.status).toBe('cancelled');
  });

  /**
   * Only a LIVE card. Three refusals, each for a different reason.
   *
   * Cancelling a spent card would rewrite what happened; cancelling an expired one changes nothing
   * and hides which of the two it was.
   */
  it('refuses a card that is already used, cancelled or lapsed', async () => {
    const spent = await issued();

    await db.execute(sql`
      UPDATE gift_cards SET status = 'used', remaining_amount = 0 WHERE reference = ${spent}
    `);

    await expect(
      cards.cancel(STAFF(staffId), spent, { reason: 'محاولة.' }),
    ).rejects.toMatchObject({ response: { code: ERROR.GIFT_CARD_NOT_CANCELLABLE } });

    const twice = await issued();

    await cards.cancel(STAFF(staffId), twice, { reason: 'أول إلغاء.' });
    await expect(
      cards.cancel(STAFF(staffId), twice, { reason: 'ثاني إلغاء.' }),
    ).rejects.toMatchObject({ response: { code: ERROR.GIFT_CARD_NOT_CANCELLABLE } });

    /*
      A card whose expiry lapsed but which the hourly sweep has not reached yet still says `active`.
      It is not cancellable: it already stopped being spendable, and the two facts differ.
    */
    const lapsed = await issued();

    await db.execute(sql`
      UPDATE gift_cards SET expires_at = now() - interval '1 hour' WHERE reference = ${lapsed}
    `);

    await expect(
      cards.cancel(STAFF(staffId), lapsed, { reason: 'محاولة.' }),
    ).rejects.toMatchObject({ response: { code: ERROR.GIFT_CARD_NOT_CANCELLABLE } });
  });

  it('refuses a reference that does not exist', async () => {
    await expect(
      cards.cancel(STAFF(staffId), 'GIF-000000', { reason: 'محاولة.' }),
    ).rejects.toMatchObject({ response: { code: ERROR.GIFT_CARD_NOT_FOUND } });
  });

  /**
   * A card somebody BOUGHT is their money.
   *
   * Voiding it without returning the value would be taking it. The balance goes back to the buyer's
   * wallet, through `WalletService` like every other movement.
   */
  it('returns the value to the buyer who paid for it', async () => {
    const { reference, profileId } = await bought();

    await cards.cancel(STAFF(staffId), reference, { reason: 'طلب العميل الإلغاء.' });

    const wallet = await db.execute<{ balance: string }>(sql`
      SELECT balance::text AS balance FROM wallets WHERE customer_profile_id = ${profileId}::uuid
    `);

    expect(wallet.rows[0]?.balance, 'the buyer is made whole').toBe('60.000');
  });

  /** The control: an ISSUED card cost the customer nothing, so nobody is credited. */
  it('credits nobody when SAFRA gave the card away', async () => {
    const reference = await issued();

    await cards.cancel(STAFF(staffId), reference, { reason: 'سُحبت الحملة.' });

    const movements = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM wallet_transactions WHERE reason = 'gift_card_transfer'
    `);

    expect(movements.rows[0]?.n, 'no wallet was credited').toBe('0');
  });

  /**
   * The books, which had nothing at all for gift cards.
   *
   * An issued card creates a liability against SAFRA's own expense; cancelling it reverses both.
   * Each group balances, and the two together net to zero — which is what «we gave one away and
   * then took it back» should look like.
   */
  it('books the liability on issue and reverses it on cancellation', async () => {
    const reference = await issued();

    const afterIssue = await legsFor(reference);

    expect(afterIssue.map((leg) => `${leg.account}:${leg.direction}`)).toStrictEqual([
      'gift_card_issued:debit',
      'gift_card_redemption:credit',
    ]);

    await cards.cancel(STAFF(staffId), reference, { reason: 'سُحبت الحملة.' });

    const all = await legsFor(reference);

    expect(all, 'two groups now: the issue and the reversal').toHaveLength(4);
    expect(new Set(all.map((leg) => leg.group)).size).toBe(2);

    /* Net zero per account across both groups — given away, then taken back. */
    const net = new Map<string, number>();

    for (const leg of all) {
      const signed = (leg.direction === 'debit' ? 1 : -1) * Number(leg.amount);

      net.set(leg.account, (net.get(leg.account) ?? 0) + signed);
    }

    expect(net.get('gift_card_issued')).toBe(0);
    expect(net.get('gift_card_redemption')).toBe(0);
  });

  /** A cancelled purchase moves the liability to the wallet rather than reversing an expense. */
  it('books a cancelled purchase against the wallet', async () => {
    const { reference } = await bought();

    await cards.cancel(STAFF(staffId), reference, { reason: 'طلب العميل الإلغاء.' });

    expect(
      (await legsFor(reference)).map((leg) => `${leg.account}:${leg.direction}`),
    ).toStrictEqual(['gift_card_redemption:debit', 'wallet_credit:credit']);
  });

  /** §15: who voided it, why, and what it was worth — and never the code. */
  it('audits the reason and the balance either side', async () => {
    const reference = await issued();

    await cards.cancel(STAFF(staffId), reference, { reason: 'أُصدرت لعنوان خاطئ.' });

    const rows = await db.execute<{
      actor: string | null;
      reason: string | null;
      before: string;
      after: string;
    }>(sql`
      SELECT actor_user_id::text AS actor, reason, before::text AS before, after::text AS after
      FROM audit_log WHERE action = 'gift_card.cancelled'
      ORDER BY created_at DESC LIMIT 1
    `);

    const entry = rows.rows[0];

    if (!entry) throw new Error('No audit row was written.');

    expect(entry.actor).toBe(staffId);
    expect(entry.reason).toContain('عنوان خاطئ');
    expect(entry.before, 'what it was worth before').toContain('60.00');
    expect(entry.after).toContain(reference);
  });
});
