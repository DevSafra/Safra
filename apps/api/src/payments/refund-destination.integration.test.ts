import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { FxRateService } from '../fx/fx-rate.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BookingActionsService } from '../bookings/booking-actions.service.js';
import { VoucherService } from '../bookings/voucher.service.js';
import type { Env } from '../config/env.js';
import { InternalCaptureProvider } from './providers/internal-capture.provider.js';
import { ManualTransferProvider } from './providers/manual-transfer.provider.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import { RefundService } from './refund.service.js';

/**
 * «A customer refund must always be returned to the exact same payment method that was originally
 * used for the payment» (Bashar, 2026-10-02), proved by trying to break it.
 *
 * Two halves. The SERVICE half drives real refunds and asserts where the money went: the gateway
 * share through the payment's own provider and reference, the wallet share to the wallet and never
 * more than the wallet paid. The DATABASE half writes the rows a buggy or hostile path would write,
 * directly, and asserts each is refused by `post/0026_refund_destination.sql`, because a rule held
 * only by the one service that happens to write refunds today is held by convention.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a refund returns through the payment it refunds', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const settings = new SettingsService(db);
  const manual = new ManualTransferProvider();
  const registry = new PaymentProviderRegistry(
    {
      PAYMENT_SIMULATOR_ENABLED: false,
      PAYMENT_SIMULATOR_WEBHOOK_SECRETS: [],
      APP_URL: 'https://safra.test',
    } as never,
    settings,
    manual,
    new InternalCaptureProvider(),
  );
  const notifications = {
    notify: () => Promise.resolve(),
  } as unknown as NotificationService;
  const wallet = new WalletService(db, {
    rateToSyp: () => {
      throw new Error('FX must not be consulted for a same-currency wallet movement.');
    },
  } as unknown as FxRateService);
  const ledger = new LedgerService(db);
  const audit = new AuditService(db);
  const refunds = new RefundService(db, registry, ledger, audit, wallet, notifications, {
    APP_URL: 'https://safra.test',
  } as never);
  const actions = new BookingActionsService(
    db,
    settings,
    audit,
    ledger,
    wallet,
    notifications,
    { PARTNER_URL: 'http://localhost:3002' } as unknown as Env,
    new VoucherService(db),
  );

  beforeEach(() => harness.begin());
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.rollback();
  });
  afterAll(() => harness.close());

  /**
   * Refused BY THE RULE, not merely failed. A write that errors for some other reason (a typo in the
   * fixture's SQL, a missing column) would pass a bare `rejects`, which is a test that cannot fail.
   * So the SQLSTATE is asserted: 23514 is the guard's `check_violation`, 23505 the unique index.
   */
  const refused = (write: Promise<unknown>, code = '23514') =>
    expect(write).rejects.toSatisfy((error: unknown) => {
      const cause = (error as { cause?: { code?: string } }).cause;
      return (cause?.code ?? (error as { code?: string }).code) === code;
    });

  // ── Where the money goes ──────────────────────────────────────────────────

  it('sends the gateway share through the payment’s own provider, against its own reference', async () => {
    const fixture = await seed({
      total: '200.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });
    const sent = vi.spyOn(manual, 'refund');

    await refunds.refundInFull(fixture.reference, 'system.partner_no_response');

    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent.mock.calls[0]?.[0].paymentProviderRef).toBe(fixture.providerRef);
    expect(sent.mock.calls[0]?.[0].amount.value).toBe('200.000');

    const row = await refundOf(fixture.bookingId);
    expect(row?.payment_id, 'the refund names the payment that took the money').toBe(
      fixture.paymentId,
    );
    expect(row?.wallet_amount).toBe('0.000');
  });

  it('returns the wallet’s share to the wallet and only the rest through the provider', async () => {
    const fixture = await seed({
      total: '200.00',
      wallet: '50.00',
      payment: 'bank_transfer',
    });
    const sent = vi.spyOn(manual, 'refund');

    await refunds.refundInFull(fixture.reference, 'system.partner_no_response');

    expect(
      sent.mock.calls[0]?.[0].amount.value,
      'the transfer gets back what it paid',
    ).toBe('150.000');
    expect((await refundOf(fixture.bookingId))?.wallet_amount).toBe('50.000');
    expect(await walletCredited(fixture.bookingId)).toBe('50.000');
  });

  it('returns a wallet-funded stay to the wallet and calls no provider at all', async () => {
    const fixture = await seed({ total: '120.00', wallet: '120.00', payment: 'wallet' });
    const sent = vi.spyOn(manual, 'refund');

    await refunds.refundInFull(fixture.reference, 'system.partner_no_response');

    expect(sent).not.toHaveBeenCalled();
    expect(await walletCredited(fixture.bookingId)).toBe('120.000');
  });

  /*
    The counterexample the audit found: finance confirming a transfer on a booking that had no
    payment intent minted a `wallet` payment for money that came from a bank account, and its refund
    then went out the manual `internal` route. It now records the transfer it was.
  */
  it('records a confirmed transfer as a bank transfer, so its refund goes back the same way', async () => {
    const fixture = await seed({
      total: '300.00',
      wallet: '0.00',
      payment: null,
      status: 'pending_payment',
    });

    await actions.recordPaymentReceived(fixture.reference, undefined);

    const payment = (
      await db.execute<{ method: string; provider: string; amount: string }>(sql`
        SELECT method::text AS method, provider, amount::text AS amount
          FROM payments WHERE booking_id = ${fixture.bookingId}::uuid
      `)
    ).rows;

    expect(payment).toEqual([
      { method: 'bank_transfer', provider: 'manual_transfer', amount: '300.000' },
    ]);

    /* And the opposite control: a stay the wallet paid in full is still recorded as the wallet. */
    const funded = await seed({
      total: '80.00',
      wallet: '80.00',
      payment: null,
      status: 'pending_payment',
    });
    await actions.recordPaymentReceived(funded.reference, undefined);
    const walletRow = await db.execute<{ method: string; provider: string }>(sql`
      SELECT method::text AS method, provider FROM payments WHERE booking_id = ${funded.bookingId}::uuid
    `);
    expect(walletRow.rows).toEqual([{ method: 'wallet', provider: 'internal' }]);
  });

  // ── Every way to point it elsewhere, refused by the database ──────────────

  it('refuses a refund naming another booking’s payment', async () => {
    const mine = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });
    const theirs = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });

    await refused(
      insertRefund({
        bookingId: mine.bookingId,
        paymentId: theirs.paymentId,
        amount: '10',
      }),
    );
  });

  it('refuses a refund on a payment that never took money', async () => {
    const fixture = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
      paymentStatus: 'requires_action',
    });

    await refused(
      insertRefund({
        bookingId: fixture.bookingId,
        paymentId: fixture.paymentId,
        amount: '10',
      }),
    );
  });

  it('refuses refunds through a payment that add up to more than it took', async () => {
    const fixture = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });

    await insertRefund({
      bookingId: fixture.bookingId,
      paymentId: fixture.paymentId,
      amount: '60',
    });
    await refused(
      insertRefund({
        bookingId: fixture.bookingId,
        paymentId: fixture.paymentId,
        amount: '41',
      }),
    );
  });

  it('refuses a wallet share larger than the wallet paid', async () => {
    const fixture = await seed({
      total: '100.00',
      wallet: '20.00',
      payment: 'bank_transfer',
    });

    await refused(
      insertRefund({
        bookingId: fixture.bookingId,
        paymentId: fixture.paymentId,
        amount: '30',
        wallet: '30',
      }),
    );
  });

  it('refuses a refund in a currency the payment was not taken in', async () => {
    const fixture = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });

    await refused(
      insertRefund({
        bookingId: fixture.bookingId,
        paymentId: fixture.paymentId,
        amount: '10',
        currency: 'SYP',
      }),
    );
  });

  it('refuses re-pointing an existing refund at another payment', async () => {
    const mine = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });
    const theirs = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });
    const id = await insertRefund({
      bookingId: mine.bookingId,
      paymentId: mine.paymentId,
      amount: '10',
    });

    await refused(
      db.execute(
        sql`UPDATE refunds SET payment_id = ${theirs.paymentId}::uuid WHERE id = ${id}::uuid`,
      ),
    );
  });

  it('refuses rewriting the method, provider or reference of a payment that took money', async () => {
    const fixture = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });

    for (const change of [
      sql`method = 'visa'::payment_method`,
      sql`provider = 'internal'`,
      sql`provider_ref = 'SOMEBODY-ELSE'`,
    ]) {
      await refused(
        db.execute(
          sql`UPDATE payments SET ${change} WHERE id = ${fixture.paymentId}::uuid`,
        ),
      );
    }

    /* The opposite control: a payment still waiting for money may change its rail. */
    const pending = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
      paymentStatus: 'requires_action',
    });
    await db.execute(
      sql`UPDATE payments SET provider_ref = 'RETRY-1' WHERE id = ${pending.paymentId}::uuid`,
    );
  });

  it('refuses a second captured payment on one booking', async () => {
    const fixture = await seed({
      total: '100.00',
      wallet: '0.00',
      payment: 'bank_transfer',
    });

    await refused(
      db.execute(sql`
        INSERT INTO payments (booking_id, method, provider, amount, currency_id, status, captured_at)
        SELECT id, 'visa'::payment_method, 'manual_transfer', 100, currency_id,
               'captured'::payment_status, now()
          FROM bookings WHERE id = ${fixture.bookingId}::uuid
      `),
      '23505',
    );
  });

  // ── Fixtures ──────────────────────────────────────────────────────────────

  async function refundOf(bookingId: string) {
    const rows = await db.execute<{ payment_id: string; wallet_amount: string }>(sql`
      SELECT payment_id::text, wallet_amount::text FROM refunds WHERE booking_id = ${bookingId}::uuid
    `);
    return rows.rows[0];
  }

  async function walletCredited(bookingId: string): Promise<string> {
    const rows = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS total FROM wallet_transactions
       WHERE booking_id = ${bookingId}::uuid AND reason = 'refund' AND direction = 'credit'
    `);
    return rows.rows[0]?.total ?? '0';
  }

  async function insertRefund(input: {
    bookingId: string;
    paymentId: string;
    amount: string;
    wallet?: string;
    currency?: string;
  }): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO refunds (payment_id, booking_id, amount, wallet_amount, currency_id, reason, status)
      VALUES (${input.paymentId}::uuid, ${input.bookingId}::uuid, ${input.amount},
              ${input.wallet ?? '0'},
              (SELECT id FROM currencies WHERE code = ${input.currency ?? 'USD'}),
              'counterexample', 'pending'::refund_status)
      RETURNING id::text
    `);
    return rows.rows[0]!.id;
  }

  async function seed(options: {
    total: string;
    wallet: string;
    payment: 'bank_transfer' | 'wallet' | null;
    paymentStatus?: 'captured' | 'requires_action';
    status?: 'cancelled' | 'pending_payment';
  }): Promise<{
    reference: string;
    bookingId: string;
    paymentId: string;
    providerRef: string;
  }> {
    const status = options.status ?? 'cancelled';
    const providerRef = `SEPA-${crypto.randomUUID()}`;
    const made = await db.execute<{ reference: string; booking_id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rd-c-' || gen_random_uuid() || '@safra.test', '+963900000071', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rd-p-' || gen_random_uuid() || '@safra.test', '+963900000072', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل الاسترداد', 'rd-c-' || gen_random_uuid() || '@safra.test',
               '+963900000071', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Refund Destination', 'شريك', ref.city_id, 'x',
               '+963900000072', 'rd-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'refund-dest-' || gen_random_uuid(), 'عقار', 'Stay', 'Stay', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price, currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, guests_children, status,
                              paid_at, cancelled_at, cancellation_reason,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, wallet_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 1300, current_date + 1302, 2, 0, ${status}::booking_status,
               ${status === 'cancelled' ? sql`now()` : sql`NULL`},
               ${status === 'cancelled' ? sql`now()` : sql`NULL`},
               ${status === 'cancelled' ? 'system.partner_no_response' : null},
               ${options.total}, '0', '0', '0.0700', '0', ${options.total}, ${options.wallet},
               ${options.total}, ref.currency_id, '13000.00000000', '1300000.00',
               '{"code":"flex","minRefundPercent":50,"tiers":[]}'::jsonb
        FROM cp, un, pr, ref RETURNING id, reference
      )
      SELECT reference, id::text AS booking_id FROM bk
    `);

    const booking = made.rows[0]!;
    let paymentId = '';

    if (options.payment) {
      const amount =
        options.payment === 'wallet'
          ? options.total
          : (Number(options.total) - Number(options.wallet)).toFixed(2);
      const paid = await db.execute<{ id: string }>(sql`
        INSERT INTO payments (booking_id, method, provider, provider_ref, amount, currency_id,
                              status, captured_at)
        SELECT ${booking.booking_id}::uuid, ${options.payment}::payment_method,
               ${options.payment === 'wallet' ? 'internal' : 'manual_transfer'},
               ${options.payment === 'wallet' ? null : providerRef},
               ${amount}, currency_id, ${options.paymentStatus ?? 'captured'}::payment_status,
               ${(options.paymentStatus ?? 'captured') === 'captured' ? sql`now()` : sql`NULL`}
          FROM bookings WHERE id = ${booking.booking_id}::uuid
        RETURNING id::text
      `);
      paymentId = paid.rows[0]!.id;
    }

    return {
      reference: booking.reference,
      bookingId: booking.booking_id,
      paymentId,
      providerRef,
    };
  }
});
