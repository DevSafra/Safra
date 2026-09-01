import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import type { AccessTokenClaims } from '../auth/token.service.js';

import { AuditService } from '../common/audit/audit.service.js';
import { DisputeService } from './dispute.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../wallet/wallet.service.js';

/**
 * Compensation paid when a dispute is resolved — «تعويض» on النزاعات.
 *
 * ## Why this file exists
 *
 * `close()`'s compensation branch had NO test at all. Nothing anywhere in the suite passed a
 * `compensationAmount`, which is how it kept a hand-written INSERT beside a
 * `balance = balance + amount::numeric` for as long as it did.
 *
 * A wallet holds ONE currency, forever — fixed at creation, never changed. That branch let a staff
 * member name a different one and added the two anyway. It is the second of the three defects the
 * wallet ADR records from 2026-08-01, back in the codebase in another service: «a customer
 * compensated on a USD booking and then a JOD one had 10 + 10 = 20 in a currency that does not
 * exist».
 *
 * It was not hypothetical. On 2026-08-26, 512 of 11,801 wallets are EUR, and
 * `close-dispute-form.tsx` posts a hardcoded `'USD'` under a comment asserting that every wallet
 * is USD. No row had drifted — none of those customers had been compensated yet — so the whole
 * failure was waiting on one support agent resolving one complaint.
 *
 * ## What is asserted
 *
 * The CONVERSION, on a EUR wallet compensated in USD, because that is the exact pair the console
 * produces. A same-currency test would pass against the broken code and is the reason a partial
 * fixture is worse than none.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const STAFF = (sub: string): AccessTokenClaims =>
  ({
    sub,
    role: 'operations_manager',
    permissions: ['dispute.manage'],
  }) as unknown as AccessTokenClaims;

describeIfDb('compensation paid on a resolved dispute', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const disputes = new DisputeService(
    db,
    new AuditService(db),
    new WalletService(db, new FxRateService(db, new AuditService(db))),
    new LedgerService(db),
    new FxRateService(db, new AuditService(db)),
    /* The notifier only announces a closure; these suites assert the closure itself. */
    { closed: () => Promise.resolve() } as never,
  );

  let bookingReference = '';
  let staffId = '';
  let profileId = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const open = () =>
    disputes.openForBooking(STAFF(staffId), {
      bookingReference,
      kind: 'not_as_described',
      title: 'الغرفة لا تطابق الوصف',
      description: 'أفاد العميل بأن الغرفة أصغر بكثير مما ظهر في الصور المنشورة.',
    });

  const walletNow = async (): Promise<{ balance: string; currency: string }> => {
    const rows = await db.execute<{ balance: string; currency: string }>(sql`
      SELECT w.balance::text AS balance, c.code AS currency
      FROM wallets w JOIN currencies c ON c.id = w.currency_id
      WHERE w.customer_profile_id = ${profileId}::uuid
    `);

    const row = rows.rows[0];

    if (!row) throw new Error('The customer has no wallet.');

    return row;
  };

  /**
   * The assertion the fix exists for.
   *
   * Watched to fail against the old code: it wrote `20.00` — ten euros plus ten dollars — and the
   * transaction row said USD while the wallet said EUR. The figure it produced was not a rounding
   * difference, it was a number in no currency at all.
   */
  it('converts into the wallet’s own currency rather than adding across two', async () => {
    const dispute = await open();

    const before = await walletNow();

    expect(before, 'the fixture wallet is EUR — the case that broke').toStrictEqual({
      balance: '10.000',
      currency: 'EUR',
    });

    await disputes.close(STAFF(staffId), dispute.reference, {
      outcome: 'resolved',
      resolution: 'عُوّض العميل عن الفارق في الوصف.',
      compensationAmount: '10.000',
      compensationCurrency: 'USD',
    });

    const after = await walletNow();

    expect(after.currency, 'the wallet keeps its own currency').toBe('EUR');
    /* Ten dollars is not ten euros, and the whole defect was writing 20.00 here. */
    expect(after.balance, 'ten dollars, converted, added to ten euros').not.toBe('20.00');
    expect(Number(after.balance)).toBeGreaterThan(10);
    expect(Number(after.balance)).toBeLessThan(20);
  });

  /**
   * And the movement it wrote is denominated in the wallet's currency too.
   *
   * The old code stored the REQUESTED currency on the transaction, so المحفظة printed «+10.00 USD»
   * over a balance that had moved by a different amount in a different currency — a statement line
   * that cannot be reconciled against the balance beside it.
   */
  it('records the movement in the currency the balance actually moved by', async () => {
    const dispute = await open();

    await disputes.close(STAFF(staffId), dispute.reference, {
      outcome: 'resolved',
      resolution: 'عُوّض العميل عن الفارق في الوصف.',
      compensationAmount: '10.000',
      compensationCurrency: 'USD',
    });

    const rows = await db.execute<{
      currency: string;
      amount: string;
      balance_after: string;
      actor: string | null;
    }>(sql`
      SELECT c.code AS currency, t.amount::text AS amount,
             t.balance_after::text AS balance_after, t.created_by_user_id::text AS actor
      FROM wallet_transactions t
      JOIN wallets w     ON w.id = t.wallet_id
      JOIN currencies c  ON c.id = t.currency_id
      WHERE w.customer_profile_id = ${profileId}::uuid
      ORDER BY t.created_at DESC LIMIT 1
    `);

    const move = rows.rows[0];

    if (!move) throw new Error('No wallet movement was written.');

    expect(move.currency, 'the movement is in the wallet’s currency').toBe('EUR');
    /* `balance_after` must agree with the balance, or a statement cannot be read. */
    expect(move.balance_after).toBe((await walletNow()).balance);
    /* §15: the staff member who resolved it is on the row. */
    expect(move.actor).toBe(staffId);
  });

  /**
   * A customer with no wallet yet gets one — the compensation does not evaporate.
   *
   * The old block was `UPDATE wallets WHERE customer_profile_id = …` feeding an `INSERT … SELECT
   * FROM credited`. With no wallet row the UPDATE matched nothing, `credited` was empty, and the
   * INSERT wrote zero rows. No error: the dispute closed, `compensation_amount` was stored, the
   * operator was told it worked, and no money moved.
   *
   * Not an edge case. On 2026-08-26, 1,886 of 2,935 live customers — 64% — had no wallet row,
   * because one is created on first use rather than at sign-up. This was the ORDINARY path.
   */
  it('creates the wallet when the customer has none, instead of paying nobody', async () => {
    /* Before any movement exists, so nothing references it. */
    await db.execute(sql`
      DELETE FROM wallets WHERE customer_profile_id = ${profileId}::uuid
    `);

    const dispute = await open();

    await disputes.close(STAFF(staffId), dispute.reference, {
      outcome: 'resolved',
      resolution: 'عُوّض العميل عن الفارق في الوصف.',
      compensationAmount: '10.000',
      compensationCurrency: 'USD',
    });

    /* A wallet now exists, in the compensation's currency, holding the compensation. */
    expect(await walletNow()).toStrictEqual({ balance: '10.000', currency: 'USD' });
  });

  /**
   * The books balance — a wallet credit with no matching debit is money from nowhere.
   *
   * This path posted NOTHING to `ledger_entries`, which made a dispute resolution the one
   * compensation outside the accounting model. The SLA sweep has always posted `partner_fine` ↔
   * `wallet_credit` through `postPartnerFine`, because there the PARTNER funds it. Here nobody is
   * fined: SAFRA decided to pay, so SAFRA's own account carries the debit.
   *
   * The deferred constraint trigger already refuses an unbalanced GROUP, so this asserts what the
   * trigger cannot: that a group was written at all, in the right accounts, at the amount that
   * actually landed rather than the one that was asked for.
   */
  it('posts a balanced ledger group in the accounts that describe it', async () => {
    const dispute = await open();

    await disputes.close(STAFF(staffId), dispute.reference, {
      outcome: 'resolved',
      resolution: 'عُوّض العميل عن الفارق في الوصف.',
      compensationAmount: '10.00',
      compensationCurrency: 'USD',
    });

    const legs = await db.execute<{
      account: string;
      direction: string;
      amount: string;
      group: string;
    }>(sql`
      SELECT account::text, direction::text, amount::text, entry_group_id::text AS group
      FROM ledger_entries
      WHERE customer_profile_id = ${profileId}::uuid
      ORDER BY account
    `);

    const rows = legs.rows;

    expect(rows, 'a group was posted at all').toHaveLength(2);
    /* One group, or they are not two legs of one movement. */
    expect(new Set(rows.map((r) => r.group)).size).toBe(1);

    expect(rows.map((r) => `${r.account}:${r.direction}`)).toStrictEqual([
      'wallet_compensation:debit',
      'wallet_credit:credit',
    ]);

    /*
      At what LANDED — 10.00 USD into a EUR wallet is 9.29 EUR, and that is what SAFRA owes.
      Booking the requested figure would leave the ledger disagreeing with the balance it exists
      to explain.
    */
    const landed = (await walletNow()).balance;

    for (const leg of rows) {
      expect(
        Number(leg.amount),
        'the leg is the applied amount, not the requested one',
      ).toBe(Number(landed) - 10);
    }
  });

  /**
   * A dispute resolved in the customer's favour is compensation, not cash (Bashar, 2026-09-01).
   *
   * Named by him as one of the three examples, and asserted on this path rather than only on the
   * wallet's, for the reason the SLA sweep's test gives: the rule lives in `WalletService`, and a
   * caller that reached past it would be invisible to a test that only ever asks the service.
   */
  it('credits the compensation as money that cannot be withdrawn', async () => {
    const dispute = await open();

    await disputes.close(STAFF(staffId), dispute.reference, {
      outcome: 'resolved',
      resolution: 'عُوّض العميل عن الفارق في الوصف.',
      compensationAmount: '10.00',
      compensationCurrency: 'USD',
    });

    const movement = await db.execute<{ amount: string; restricted: string }>(sql`
      SELECT wt.amount::text AS amount, wt.restricted_amount::text AS restricted
      FROM wallet_transactions wt
      JOIN wallets w ON w.id = wt.wallet_id
      WHERE w.customer_profile_id = ${profileId}::uuid AND wt.direction = 'credit'
      ORDER BY wt.created_at DESC LIMIT 1
    `);

    const row = movement.rows[0];

    expect(row?.restricted, 'the whole credit is restricted').toBe(row?.amount);

    /*
      And the wallet agrees — about the compensation ONLY.

      The fixture opens with 10 EUR that nobody classified, which stands in for money the customer
      already had. After a 9.29 compensation the balance is 19.29 and exactly 9.29 of it is held
      back: the credit restricted itself and left the rest alone. Asserting «all of it is
      restricted» would have passed just as well against a rule that restricted the whole balance
      on any compensation, which is the neighbouring bug.
    */
    const wallet = await db.execute<{ balance: string; restricted: string }>(sql`
      SELECT balance::text AS balance, restricted_balance::text AS restricted
      FROM wallets WHERE customer_profile_id = ${profileId}::uuid
    `);

    expect(wallet.rows[0]).toStrictEqual({ balance: '19.290', restricted: '9.290' });
  });

  /** A currency the platform does not know is refused, not silently skipped. */
  it('refuses a currency code that is not on the platform', async () => {
    const dispute = await open();

    await expect(
      disputes.close(STAFF(staffId), dispute.reference, {
        outcome: 'resolved',
        resolution: 'عُوّض العميل.',
        compensationAmount: '10.000',
        compensationCurrency: 'ZZZ',
      }),
    ).rejects.toMatchObject({ response: { code: 'geo.currency_unknown' } });

    /* And nothing moved: the refusal rolled the resolution back with it. */
    expect((await walletNow()).balance).toBe('10.000');
  });

  async function seed(): Promise<void> {
    const made = await db.execute<{
      reference: string;
      staff: string;
      profile: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS usd_id,
               (SELECT id FROM currencies WHERE code = 'EUR')           AS eur_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), st AS (
        INSERT INTO users (full_name, email, phone, role, status)
        VALUES ('مدير العمليات', 'cmp-s-' || gen_random_uuid() || '@safra.test',
                '+963900000084', 'operations_manager', 'active')
        RETURNING id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('cmp-c-' || gen_random_uuid() || '@safra.test', '+963900000085',
                'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('cmp-p-' || gen_random_uuid() || '@safra.test', '+963900000086',
                'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل التعويض', 'cmp-c-' || gen_random_uuid() || '@safra.test',
               '+963900000085', false
        FROM cu RETURNING id
      ), fx AS (
        /*
          A EUR→SYP rate, because this database has none and the conversion refuses without one —
          correctly and loudly. Set inside the rollback so it is this test's fixture and not a
          change to anybody's data. That the real database is missing this rate is reported
          separately; it is an operational gap, not something a test should paper over.
        */
        INSERT INTO fx_rates (base_currency_id, quote_currency_id, rate, effective_from, source)
        SELECT ref.eur_id, (SELECT id FROM currencies WHERE code = 'SYP'),
               '14000.00000000', now() - interval '1 hour', 'test'
        FROM ref
        RETURNING id
      ), wa AS (
        /* EUR, deliberately — 512 real wallets are, and the console pays in USD. */
        INSERT INTO wallets (customer_profile_id, currency_id, balance)
        SELECT cp.id, ref.eur_id, '10.000' FROM cp, ref
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Compensation Test', 'تعويض', ref.city_id, 'x',
               '+963900000086', 'cmp-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'compensation-test-' || gen_random_uuid(), 'عقار التعويض', 'Comp', 'Comp', 'x',
               'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 2, '100.00', ref.usd_id FROM pr, ref
        RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, status, paid_at, checked_in_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 620, current_date + 623, 2, 'checked_in'::booking_status,
               now(), now(),
               '200.00', '1.99', '1.99', '0.0700', '14.00', '201.99', '186.00',
               ref.usd_id, '13000.00000000', '2625870.00', '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref
        RETURNING reference, customer_profile_id
      )
      SELECT bk.reference, st.id AS staff, bk.customer_profile_id AS profile
      FROM bk, st, wa, fx
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    bookingReference = row.reference;
    staffId = row.staff;
    profileId = row.profile;
  }
});
