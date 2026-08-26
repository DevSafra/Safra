import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, normaliseGiftCode, type GiftCardIssueInput } from '@safra/contracts';
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

  /** The control: three decimals ARE accepted where the currency has three. */
  it('accepts a third decimal for a three-decimal currency', async () => {
    const result = await issue({ amount: '10.125', currency: 'JOD' });

    expect(result.card.originalAmount).toBe('10.125');
  });

  it('refuses a currency the platform does not know', async () => {
    await expect(issue({ currency: 'ZZZ' })).rejects.toMatchObject({
      response: { code: ERROR.GEO_CURRENCY_UNKNOWN },
    });
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

  /** No address, no mail — and the card still exists to be handed over in person. */
  it('sends nothing when no recipient was named', async () => {
    const result = await issue();

    expect(sent).toHaveLength(0);
    expect(result.code).not.toBe('');
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
