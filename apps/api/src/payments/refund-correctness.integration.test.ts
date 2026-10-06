import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { FxRateService } from '../fx/fx-rate.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import type { Env } from '../config/env.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { BookingActionsService } from '../bookings/booking-actions.service.js';
import type { BookingAccessService } from '../bookings/booking-access.service.js';
import { InternalCaptureProvider } from './providers/internal-capture.provider.js';
import { ManualTransferProvider } from './providers/manual-transfer.provider.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import { signSimulatorPayload } from './providers/simulator.provider.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { RefundService } from './refund.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';

const testCrypto = new FieldEncryptionService({
  FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
} as unknown as Env);

const SECRET = 'r'.repeat(48);

/**
 * The refund defects found by the money audit of 2026-10-06, each watched to fail first.
 *
 * Every case drives the real `RefundService` (and, for a provider's confirmation, the real
 * webhook service) against PostgreSQL, because the faults live where the service meets the
 * database: a trigger refusing a figure, a status computed in SQL, a scope predicate, a timezone.
 * Rolled back after every test, so nothing here outlives the run.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('refund correctness (audit 2026-10-06)', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const settings = new SettingsService(db);
  const manual = new ManualTransferProvider();
  const registry = new PaymentProviderRegistry(
    {
      PAYMENT_SIMULATOR_ENABLED: true,
      PAYMENT_SIMULATOR_WEBHOOK_SECRETS: [SECRET],
      APP_URL: 'https://safra.test',
    } as never,
    settings,
    manual,
    new InternalCaptureProvider(),
  );
  const wallet = new WalletService(db, {
    rateToSyp: () => {
      throw new Error('FX must not be consulted for a same-currency wallet movement.');
    },
  } as unknown as FxRateService);
  const ledger = new LedgerService(db);
  const refunds = new RefundService(
    db,
    registry,
    ledger,
    new AuditService(db),
    wallet,
    { notify: () => Promise.resolve() } as unknown as NotificationService,
    { APP_URL: 'https://safra.test' } as never,
    testCrypto,
  );
  /* Capture is not exercised here, so the two collaborators only it uses are never reached. */
  const webhooks = new PaymentWebhookService(
    db,
    registry,
    {} as BookingActionsService,
    {} as BookingAccessService,
    ledger,
  );

  beforeEach(() => harness.begin());
  afterEach(async () => {
    vi.restoreAllMocks();
    await harness.rollback();
  });
  afterAll(() => harness.close());

  // ── 1. A coupon comes off what is refundable ─────────────────────────────────

  describe('a couponed stay', () => {
    /* 200 base + 10 fee − 50 coupon = 160 paid; the partner is still owed 186 of the 200. */
    const couponed = (tiers: { hoursBeforeCheckIn: number; refundPercent: number }[]) =>
      seed({
        base: '200.00',
        fee: '10.00',
        discount: '50.00',
        commission: '14.00',
        payment: 'simulator',
        captureLedger: true,
        policy: { code: 'flex', minRefundPercent: 50, tiers },
      });

    it('refunds 100% of what was PAID toward the stay, and reverses the whole payable', async () => {
      const fixture = await couponed([{ hoursBeforeCheckIn: 168, refundPercent: 100 }]);

      const result = await refunds.execute(
        fixture.reference,
        'Customer request',
        undefined,
      );

      expect(result.status).toBe('completed');
      expect(result.amount, 'the base less the coupon, never more than was paid').toBe(
        '150.000',
      );

      const books = await balances(fixture.bookingId);
      expect(
        books.partner_payable,
        'the partner is owed nothing for a refunded stay',
      ).toBe('0.000');
      expect(books.safra_commission_partner).toBe('0.000');
      expect(books.refund, 'the clearing account nets to zero').toBe('0.000');
      expect(
        books.coupon_discount,
        'SAFRA gave up no discount on a stay that never was',
      ).toBe('0.000');
      expect(await payableColumn(fixture.bookingId)).toBe('0.000');
    });

    it('refunds 50% of what was paid, and reverses half of each', async () => {
      const fixture = await couponed([]);

      expect((await refunds.quote(fixture.reference, undefined)).refundAmount).toBe(
        '75.000',
      );

      const result = await refunds.execute(
        fixture.reference,
        'Customer request',
        undefined,
      );
      expect(result.amount).toBe('75.000');

      const books = await balances(fixture.bookingId);
      expect(books.partner_payable, 'half of 186 still owed').toBe('-93.000');
      expect(books.safra_commission_partner).toBe('-7.000');
      expect(books.refund).toBe('0.000');
      expect(books.coupon_discount, 'half the discount given back').toBe('25.000');
      expect(await payableColumn(fixture.bookingId)).toBe('93.000');
    });
  });

  // ── 4. Settling needs WRITE scope ────────────────────────────────────────────

  it('refuses a read-only officer settling a refund outside their cities', async () => {
    const fixture = await seed({ base: '90.00', payment: 'bank_transfer' });
    const issued = await refunds.refundInFull(
      fixture.reference,
      'system.partner_no_response',
    );
    const elsewhere = await otherCity(fixture.cityId);

    const settle = (cityIds: string[]) =>
      refunds.settle(
        issued.refundId,
        {
          role: 'finance_officer',
          scope: { kind: 'cities', cityIds, outside: 'read_only' },
        } as unknown as AccessTokenClaims,
        {
          sourceAccount: 'SY22 2222 2222 2222',
          destinationAccount: 'SY22 2222 2222 2222',
          transferReference: 'TRX-SCOPE-1',
        },
      );

    await expect(settle([elsewhere])).rejects.toSatisfy(
      (error) => codeOf(error) === ERROR.SCOPE_OUTSIDE,
    );
    expect(await refundStatus(issued.refundId), 'nothing was settled').toBe('processing');

    /* The opposite control: the same officer, in the booking's own city, settles it. */
    await settle([fixture.cityId]);
    expect(await refundStatus(issued.refundId)).toBe('completed');
  });

  // ── 7. A refused refund does not credit the wallet twice ─────────────────────

  it('retries a refund the provider refused without crediting the wallet share again', async () => {
    const fixture = await seed({
      base: '200.00',
      wallet: '50.00',
      payment: 'bank_transfer',
    });
    const sent = vi
      .spyOn(manual, 'refund')
      .mockResolvedValueOnce({ kind: 'failed', reason: 'declined' });

    const first = await refunds.refundInFull(
      fixture.reference,
      'system.partner_no_response',
    );
    expect(first.status).toBe('failed');
    expect(await walletCredited(fixture.bookingId)).toBe('50.000');

    /* What the hourly sweep does an hour later. */
    const retry = await refunds.refundInFull(
      fixture.reference,
      'system.partner_no_response',
    );

    expect(retry.amount, 'only the gateway share is still owed').toBe('150.000');
    expect(await walletCredited(fixture.bookingId), 'credited once, not twice').toBe(
      '50.000',
    );
    expect(sent.mock.calls[1]?.[0].amount.value).toBe('150.000');

    /* And the books say the gateway share went out once. */
    expect((await balances(fixture.bookingId)).customer_payment).toBe('-150.000');
  });

  // ── 8. The payment's status, for each way a stay can be paid ─────────────────

  describe('a fully refunded payment reads refunded', () => {
    it('when the wallet paid for all of it', async () => {
      const fixture = await seed({ base: '120.00', wallet: '120.00', payment: 'wallet' });

      await refunds.refundInFull(fixture.reference, 'system.partner_no_response');

      expect(await paymentStatus(fixture.paymentId)).toBe('refunded');
    });

    it('when the gateway paid for all of it', async () => {
      const fixture = await seed({ base: '120.00', payment: 'bank_transfer' });

      await refunds.refundInFull(fixture.reference, 'system.partner_no_response');

      expect(await paymentStatus(fixture.paymentId)).toBe('refunded');
    });

    it('when the two split it, and only once both shares are back', async () => {
      const fixture = await seed({
        base: '200.00',
        wallet: '60.00',
        payment: 'bank_transfer',
      });

      await refunds.execute(fixture.reference, 'Customer request', undefined);
      expect(await paymentStatus(fixture.paymentId), 'half back is not all back').toBe(
        'partially_refunded',
      );

      await refunds.refundInFull(fixture.reference, 'system.partner_no_response');
      expect(await paymentStatus(fixture.paymentId)).toBe('refunded');
    });
  });

  // ── 9. The tier clock runs in the city's timezone ────────────────────────────

  it('measures the tier to midnight of check-in in the city’s own timezone', async () => {
    const fixture = await seed({
      base: '100.00',
      payment: 'bank_transfer',
      checkInDays: 3,
    });

    const clock = await db.execute<{ utc: number; local: number }>(sql`
      SELECT floor(extract(epoch FROM (b.check_in::timestamp AT TIME ZONE 'UTC' - now())) / 3600)::int
               AS utc,
             floor(extract(epoch FROM (b.check_in::timestamp AT TIME ZONE c.timezone - now())) / 3600)::int
               AS local
        FROM bookings b JOIN cities c ON c.id = b.city_id
       WHERE b.id = ${fixture.bookingId}::uuid
    `);
    const { utc, local } = clock.rows[0]!;

    expect(
      utc,
      'the fixture city must not be on UTC, or this proves nothing',
    ).toBeGreaterThan(local);

    /* A threshold the UTC clock still meets and the city's clock has already passed. */
    await db.execute(sql`
      UPDATE bookings
         SET cancellation_policy_snapshot = ${JSON.stringify({
           code: 'flex',
           minRefundPercent: 50,
           tiers: [{ hoursBeforeCheckIn: local + 1, refundPercent: 100 }],
         })}::jsonb
       WHERE id = ${fixture.bookingId}::uuid
    `);

    const quote = await refunds.quote(fixture.reference, undefined);

    expect(quote.hoursBeforeCheckIn).toBe(local);
    expect(quote.refundPercent, 'the tier has closed in Damascus').toBe(50);
  });

  // ── 10. A provider's confirmation completes the refund it names ─────────────

  describe('a provider confirming a refund', () => {
    it('matches on the provider’s share, not on the gross refund', async () => {
      const fixture = await seed({
        base: '200.00',
        wallet: '50.00',
        payment: 'simulator',
      });
      const refundId = await openRefund(fixture, '100.00', '50.00');

      expect(await confirm(fixture.providerRef, '50.00')).toBe('accepted');
      expect(await refundStatus(refundId)).toBe('completed');
    });

    it('completes nothing when an event with no amount could mean either of two refunds', async () => {
      const fixture = await seed({ base: '200.00', payment: 'simulator' });
      const one = await openRefund(fixture, '50.00', '0');
      const two = await openRefund(fixture, '60.00', '0');

      expect(await confirm(fixture.providerRef, null)).toBe('rejected');
      expect(await refundStatus(one)).toBe('processing');
      expect(await refundStatus(two)).toBe('processing');
    });

    it('completes the only open refund when the event carries no amount', async () => {
      const fixture = await seed({ base: '200.00', payment: 'simulator' });
      const only = await openRefund(fixture, '50.00', '0');

      expect(await confirm(fixture.providerRef, null)).toBe('accepted');
      expect(await refundStatus(only)).toBe('completed');
    });
  });

  // ── Fixtures ────────────────────────────────────────────────────────────────

  async function confirm(paymentRef: string, amount: string | null): Promise<string> {
    const raw = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      type: 'refund.completed',
      payment_ref: paymentRef,
      ...(amount ? { amount, currency: 'USD' } : {}),
    });

    return webhooks.handle('simulator', raw, {
      'x-safra-signature': signSimulatorPayload(
        raw,
        SECRET,
        Math.floor(Date.now() / 1000),
      ),
    });
  }

  async function openRefund(
    fixture: { bookingId: string; paymentId: string },
    amount: string,
    walletShare: string,
  ): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO refunds (payment_id, booking_id, amount, wallet_amount, currency_id, reason, status)
      SELECT ${fixture.paymentId}::uuid, b.id, ${amount}, ${walletShare}, b.currency_id,
             'webhook test', 'processing'::refund_status
        FROM bookings b WHERE b.id = ${fixture.bookingId}::uuid
      RETURNING id::text
    `);
    return rows.rows[0]!.id;
  }

  /** Net balance per account for one booking: debits minus credits. */
  async function balances(bookingId: string): Promise<Record<string, string>> {
    const rows = await db.execute<{ account: string; net: string }>(sql`
      SELECT account::text AS account,
             SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END)::numeric(18,3)::text
               AS net
        FROM ledger_entries WHERE booking_id = ${bookingId}::uuid
       GROUP BY account
    `);
    return Object.fromEntries(rows.rows.map((r) => [r.account, r.net]));
  }

  async function payableColumn(bookingId: string): Promise<string> {
    const rows = await db.execute<{ v: string }>(sql`
      SELECT partner_payable_amount::text AS v FROM bookings WHERE id = ${bookingId}::uuid
    `);
    return rows.rows[0]!.v;
  }

  async function refundStatus(refundId: string): Promise<string> {
    const rows = await db.execute<{ s: string }>(sql`
      SELECT status::text AS s FROM refunds WHERE id = ${refundId}::uuid
    `);
    return rows.rows[0]!.s;
  }

  async function paymentStatus(paymentId: string): Promise<string> {
    const rows = await db.execute<{ s: string }>(sql`
      SELECT status::text AS s FROM payments WHERE id = ${paymentId}::uuid
    `);
    return rows.rows[0]!.s;
  }

  async function walletCredited(bookingId: string): Promise<string> {
    const rows = await db.execute<{ total: string }>(sql`
      SELECT COALESCE(SUM(amount), 0)::text AS total FROM wallet_transactions
       WHERE booking_id = ${bookingId}::uuid AND reason = 'refund' AND direction = 'credit'
    `);
    return rows.rows[0]?.total ?? '0';
  }

  async function otherCity(cityId: string): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL AND id <> ${cityId}::uuid LIMIT 1
    `);
    return rows.rows[0]!.id;
  }

  /**
   * One paid, cancelled booking with its capture.
   *
   * The amounts keep the platform's identities — total = base + fee − discount, payable = base −
   * commission — because the ledger's balance trigger refuses a capture group that does not, and
   * a fixture the platform could never produce proves nothing about it.
   */
  async function seed(options: {
    base: string;
    fee?: string;
    discount?: string;
    commission?: string;
    wallet?: string;
    payment: 'bank_transfer' | 'wallet' | 'simulator';
    captureLedger?: boolean;
    checkInDays?: number;
    policy?: unknown;
  }): Promise<{
    reference: string;
    bookingId: string;
    paymentId: string;
    providerRef: string;
    cityId: string;
  }> {
    const fee = options.fee ?? '0';
    const discount = options.discount ?? '0';
    const commission = options.commission ?? '0';
    const wallet = options.wallet ?? '0';
    const total = (Number(options.base) + Number(fee) - Number(discount)).toFixed(2);
    const payable = (Number(options.base) - Number(commission)).toFixed(2);
    const providerRef = `RC-${crypto.randomUUID()}`;

    const made = await db.execute<{
      reference: string;
      booking_id: string;
      city_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rc-c-' || gen_random_uuid() || '@safra.test', '+963900000081', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('rc-p-' || gen_random_uuid() || '@safra.test', '+963900000082', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل', 'rc-c-' || gen_random_uuid() || '@safra.test', '+963900000081', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Refund Correctness', 'شريك', ref.city_id, 'x',
               '+963900000082', 'rc-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'refund-correct-' || gen_random_uuid(), 'عقار', 'Stay', 'Stay', 'x', 'draft'
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
                              discount_amount, total_amount, wallet_amount,
                              partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + ${options.checkInDays ?? 1300}::int,
               current_date + ${(options.checkInDays ?? 1300) + 2}::int, 2, 0,
               'cancelled'::booking_status, now(), now(), 'system.partner_no_response',
               ${options.base}, ${fee}, ${fee}, '0.0700', ${commission},
               ${discount}, ${total}, ${wallet}, ${payable}, ref.currency_id,
               '13000.00000000', '1300000.00',
               ${JSON.stringify(options.policy ?? { code: 'flex', minRefundPercent: 50, tiers: [] })}::jsonb
        FROM cp, un, pr, ref RETURNING id, reference, city_id
      )
      SELECT reference, id::text AS booking_id, city_id::text FROM bk
    `);

    const booking = made.rows[0]!;
    const amount =
      options.payment === 'wallet' ? total : (Number(total) - Number(wallet)).toFixed(2);
    const provider =
      options.payment === 'wallet'
        ? 'internal'
        : options.payment === 'simulator'
          ? 'simulator'
          : 'manual_transfer';
    const method = options.payment === 'simulator' ? 'visa' : options.payment;

    const paid = await db.execute<{ id: string }>(sql`
      INSERT INTO payments (booking_id, method, provider, provider_ref, amount, currency_id,
                            status, captured_at)
      SELECT ${booking.booking_id}::uuid, ${method}::payment_method, ${provider},
             ${options.payment === 'wallet' ? null : providerRef}, ${amount}, currency_id,
             'captured'::payment_status, now()
        FROM bookings WHERE id = ${booking.booking_id}::uuid
      RETURNING id::text
    `);
    const paymentId = paid.rows[0]!.id;

    if (options.captureLedger) {
      const row = await db.execute<{
        partner_id: string;
        customer_profile_id: string;
        currency_id: string;
      }>(sql`
        SELECT partner_id::text, customer_profile_id::text, currency_id::text
          FROM bookings WHERE id = ${booking.booking_id}::uuid
      `);
      const b = row.rows[0]!;

      await ledger.postBookingPayment(
        db,
        {
          id: booking.booking_id,
          partnerId: b.partner_id,
          customerProfileId: b.customer_profile_id,
          currencyId: b.currency_id,
          fxRateToSyp: '13000.00000000',
          totalAmount: total,
          walletAmount: wallet,
          customerFeeAmount: fee,
          partnerCommissionAmount: commission,
          partnerPayableAmount: payable,
          discountAmount: discount,
          reference: booking.reference,
        },
        paymentId,
      );
    }

    return {
      reference: booking.reference,
      bookingId: booking.booking_id,
      paymentId,
      providerRef,
      cityId: booking.city_id,
    };
  }
});
