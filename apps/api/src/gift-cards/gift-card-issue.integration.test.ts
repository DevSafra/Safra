import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  ERROR,
  GIFT_CARD_CURRENCIES,
  giftCardIssueSchema,
  normaliseGiftCode,
  type GiftCardIssueInput,
} from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { GiftCardService } from './gift-card.service.js';
import { WalletService } from './../wallet/wallet.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';

/**
 * Issuing a gift card SAFRA is giving away — §9.3's «+ إنشاء بطاقة هدية».
 *
 * ## Three halves of a feature
 *
 * `GIFT_CARD_MANAGE` was held by finance and super admin with no route behind it, `issued_by_user_id`
 * was a column nothing wrote, and the console's create button was `aria-disabled` with the reasoning
 * written beside it. All three were honest about being unfinished; none of them was finished.
 *
 * ## What is worth asserting
 *
 * The parts where getting it wrong is expensive and invisible: the code is a BEARER INSTRUMENT, so
 * anything that stores or records it hands over spendable money later. And an issued card is a
 * liability created out of nothing, so who created it and why must be on the record.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a gift card issued by staff', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: OutgoingMail[] = [];
  let giftCards: GiftCardService;
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

    giftCards = new GiftCardService(
      db,
      { APP_URL: 'https://safra.test' } as unknown as Env,
      new WalletService(db, {
        rateToSyp: () => Promise.resolve('13000.00000000'),
        decimalsOf: () => Promise.resolve(2),
      } as unknown as FxRateService),
      new AuditService(db),
      /* Captures what would have been sent, so the CODE in the body can be asserted. */
      {
        send: (mail: OutgoingMail) => Promise.resolve(void sent.push(mail)),
      } as unknown as MailService,
    );

    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('gc-issue-' || gen_random_uuid() || '@safra.test', '+963900000097',
              'finance_officer', 'active')
      RETURNING id
    `);

    staffId = made.rows[0]?.id ?? '';
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const issue = (over: Partial<GiftCardIssueInput> = {}) =>
    giftCards.issue(STAFF(staffId), {
      amount: '75.00',
      currency: 'USD',
      recipientEmail: 'guest@example.test',
      reason: 'تعويض عن تأخّر في معالجة طلب دعم.',
      ...over,
    });

  /**
   * The card exists, it is SAFRA's, and it names who made it.
   *
   * `issued_by_user_id` had no writer at all until this route; `purchased_by_customer_id` staying
   * null is not an omission but the truth — nobody bought it.
   */
  it('records who issued it, and that nobody bought it', async () => {
    const result = await issue();

    const rows = await db.execute<{
      issued_by: string | null;
      purchased_by: string | null;
      status: string;
      original: string;
      remaining: string;
    }>(sql`
      SELECT issued_by_user_id::text AS issued_by,
             purchased_by_customer_id::text AS purchased_by,
             status::text AS status,
             original_amount::text AS original,
             remaining_amount::text AS remaining
      FROM gift_cards WHERE reference = ${result.card.reference}
    `);

    expect(rows.rows[0]).toStrictEqual({
      issued_by: staffId,
      purchased_by: null,
      status: 'active',
      original: '75.000',
      remaining: '75.000',
    });
  });

  /**
   * THE assertion: the code is never stored, and the stored hash is of the code returned.
   *
   * A console that could recover a code would be a way to spend other people's money. The plaintext
   * exists in the return value and in one email, and nowhere else — so this checks both halves: that
   * the row carries no trace of it, and that the hash it does carry actually matches, because a hash
   * of the wrong thing would make every card unredeemable and nothing would say so until somebody
   * tried.
   */
  it('stores a hash that matches the code, and never the code', async () => {
    const result = await issue();

    const rows = await db.execute<{ hash: string; last4: string; row: string }>(sql`
      SELECT code_hash AS hash, code_last4 AS last4, gift_cards::text AS row
      FROM gift_cards WHERE reference = ${result.card.reference}
    `);

    const stored = rows.rows[0];
    const normalised = normaliseGiftCode(result.code);

    if (!stored) throw new Error('No card was written.');

    /* The whole row as text — no column anywhere holds the code or a piece of it beyond four. */
    expect(stored.row).not.toContain(normalised);
    expect(stored.row).not.toContain(result.code);

    expect(stored.last4, 'four characters, for identifying it on screen').toBe(
      normalised.slice(-4),
    );

    /* And the hash is of THIS code: redeeming it must find this row. */
    const { createHash } = await import('node:crypto');

    expect(stored.hash).toBe(createHash('sha256').update(normalised).digest('hex'));
  });

  /** The audit row carries why, and carries no way to spend the card. */
  it('audits the reason and never the code', async () => {
    const result = await issue({ reason: 'تعويض عن انقطاع الخدمة يوم الثلاثاء.' });

    const rows = await db.execute<{
      reason: string | null;
      after: string;
      actor: string | null;
    }>(sql`
      SELECT reason, after::text AS after, actor_user_id::text AS actor
      FROM audit_log
      WHERE action = 'gift_card.issued'
      ORDER BY created_at DESC LIMIT 1
    `);

    const entry = rows.rows[0];

    if (!entry) throw new Error('No audit row was written.');

    expect(entry.actor, '§15: the staff member who created the liability').toBe(staffId);
    expect(entry.reason).toContain('انقطاع الخدمة');
    expect(entry.after).toContain('75.00');
    expect(entry.after).toContain('USD');

    /* The payload is read on سجل التدقيق — a code there is a spendable code on a screen. */
    expect(entry.after).not.toContain(normaliseGiftCode(result.code));
  });

  /**
   * Refused, not rounded, when the amount is finer than its currency.
   *
   * `10.005 USD` is not payable. The field schema allows three decimals because JOD needs three and
   * cannot see which currency this is, so the service decides — the same rule as a wallet
   * adjustment, and the same reason: SAFRA must not quietly issue a different number.
   */
  it('refuses an amount finer than its currency', async () => {
    await expect(issue({ amount: '10.005' })).rejects.toMatchObject({
      response: { code: ERROR.VALIDATION_DECIMAL_STRING },
    });
  });

  /**
   * A currency SAFRA lists but does not issue cards in is refused (Bashar, 2026-08-26).
   *
   * JOD and LBP are active currencies — bookings can be priced in them — and a gift card may not be
   * denominated in either. A card is a bearer instrument SAFRA must honour for as long as it lives,
   * and each currency it can carry is another exposure.
   *
   * Asserted at the API because the picker is a COURTESY: somebody who edits the DOM, replays the
   * form or types the request by hand meets this, not a dropdown.
   */
  it('refuses a currency SAFRA does not issue cards in', async () => {
    for (const currency of ['JOD', 'LBP']) {
      await expect(
        issue({ currency } as Partial<GiftCardIssueInput>),
      ).rejects.toBeDefined();
    }
  });

  /** The control: each of the three that ARE allowed is accepted. */
  it('accepts each currency a card may be issued in', async () => {
    for (const currency of GIFT_CARD_CURRENCIES) {
      const result = await issue({ currency, amount: '50.00' });

      expect(result.card.currencyCode, `${currency} is issuable`).toBe(currency);
    }
  });

  /**
   * The ceiling is per CURRENCY, because one number cannot serve both.
   *
   * SYP and USD differ by four orders of magnitude. A flat cap of 1000 — which is what this was
   * before SYP was offered — would have limited a SYP card to about eight US cents and made the
   * currency unusable the moment it appeared in the picker.
   */
  it('caps each currency on its own scale', async () => {
    await expect(issue({ amount: '1001', currency: 'USD' })).rejects.toBeDefined();

    /* The same figure is ordinary in SYP, and must go through. */
    const syp = await issue({ amount: '1001', currency: 'SYP' });

    expect(syp.card.originalAmount).toBe('1001.000');

    /* And SYP has a ceiling of its own. */
    await expect(issue({ amount: '15000001', currency: 'SYP' })).rejects.toBeDefined();
  });

  /** An address gets the card; the staff member's REASON does not travel with it. */
  it('emails the recipient the code, and nothing a caller wrote', async () => {
    const result = await issue({
      recipientEmail: 'guest@example.test',
      reason: 'مراسلة داخلية لا يجب أن تصل العميل.',
    });

    expect(sent, 'one message, to the address named').toHaveLength(1);
    expect(sent[0]?.to).toBe('guest@example.test');

    const body = JSON.stringify(sent[0]);

    expect(body, 'the recipient can actually use it').toContain(result.code);
    expect(body, 'a caller’s words never travel in SAFRA’s mail').not.toContain(
      'مراسلة داخلية',
    );
  });

  /**
   * The address is REQUIRED, so a card with nowhere to go cannot be created.
   *
   * Only `code_hash` is stored: a card whose code exists solely in a browser session that has since
   * been closed is a liability SAFRA owes to somebody who cannot claim it.
   */
  it('refuses to issue a card with nowhere to send it', async () => {
    await expect(issue({ recipientEmail: '' })).rejects.toMatchObject({
      response: { code: ERROR.VALIDATION_EMAIL_INVALID },
    });

    /* And the FORMAT is the schema's job — the route never reaches the service with this. */
    expect(
      giftCardIssueSchema.safeParse({
        amount: '10.00',
        currency: 'USD',
        recipientEmail: 'not-an-address',
        reason: 'اختبار.',
      }).success,
    ).toBe(false);
  });

  it('stores the expiry it was given', async () => {
    const result = await issue({ expiresOn: '2027-01-31' });

    const rows = await db.execute<{ expires: string | null }>(sql`
      SELECT expires_at::date::text AS expires FROM gift_cards
      WHERE reference = ${result.card.reference}
    `);

    expect(rows.rows[0]?.expires).toBe('2027-01-31');
  });
});
