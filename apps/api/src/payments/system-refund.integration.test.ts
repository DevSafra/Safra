import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';

import type { FxRateService } from '../fx/fx-rate.service.js';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { ManualTransferProvider } from './providers/manual-transfer.provider.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import { RefundService } from './refund.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { SystemRefundService } from './system-refund.service.js';
import { WalletService } from '../wallet/wallet.service.js';

/**
 * §6.4's «استرداد كامل» — the refund on a booking SAFRA itself cancelled.
 *
 * ## What has to be true, and what would look identical if it were not
 *
 * The obvious assertion — «a refund row exists» — is satisfied by a sweep that refunds the wrong
 * AMOUNT, and the wrong amount is the likely defect here: `RefundService.execute` prices a
 * customer's change of mind against `base_amount` with §7.4's tiers, and reaching for it would
 * return roughly half of the accommodation and none of the service fee. So the amount is asserted
 * against the booking's TOTAL, with a fixture whose base, fee and total are all different numbers —
 * a fixture where the fee were zero would pass against either implementation.
 *
 * The scope needs the opposite control for the same reason `arrivals` does: a sweep that refunded
 * EVERY cancelled booking would satisfy every positive assertion here. So a customer-cancelled
 * booking sits beside the system-cancelled one and must be left alone.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the system refund sweep', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /* The simulator stays OFF: this suite is about the offline rail, which is the only real one. */
  const registry = new PaymentProviderRegistry(
    {
      PAYMENT_SIMULATOR_ENABLED: false,
      PAYMENT_SIMULATOR_WEBHOOK_SECRETS: [],
      APP_URL: 'https://safra.test',
    } as never,
    new SettingsService(db),
    new ManualTransferProvider(),
  );
  const refunds = new RefundService(
    db,
    registry,
    new LedgerService(db),
    new AuditService(db),
    new WalletService(
      db,
      /*
        FX throws rather than returning a rate — the same stub `payments.integration.test.ts` uses.

        Every fixture here is priced in USD and its wallet leg is USD, so a conversion would mean
        the same-currency fast path had been skipped. A loud failure says that; a plausible number
        would hide it.
      */
      {
        rateToSyp: () => {
          throw new Error(
            'FX must not be consulted for a same-currency wallet movement.',
          );
        },
      } as unknown as FxRateService,
    ),
  );
  const sweep = new SystemRefundService(db, refunds, new JobRunService(db));

  /**
   * One booking a pass — which, given the fixture is cancelled ten years ago and the sweep works
   * oldest-first, is exactly OUR booking and nothing else.
   *
   * Not a tidiness choice. An unbounded pass over this database refunds up to two hundred real
   * seed bookings and holds their row locks for the length of the file, which timed out
   * `payments.integration.test.ts` — a suite that commits for real and shares the same wallets.
   */
  const ONLY_OURS = 1;

  /** Distinct on purpose — see the note on the fixture above. */
  const BASE = '400.00';
  const FEE = '36.00';
  const TOTAL = '436.00';

  let systemCancelled = '';
  let customerCancelled = '';

  beforeEach(async () => {
    await harness.begin();
    systemCancelled = await seed('system.partner_no_response');
    customerCancelled = await seed('غيّرت رأيي، لن أسافر.');
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('returns the WHOLE amount the customer paid, fee included', async () => {
    await sweep.sweep(ONLY_OURS);

    const refund = await refundFor(systemCancelled);

    expect(refund, 'a refund was issued').not.toBeUndefined();
    /* The total, NOT `base_amount` — the tiered path would have returned a share of 400.00. */
    expect(refund?.amount).toBe(TOTAL);
    expect(refund?.applied_refund_percent).toBe('100.00');
    /* Nobody pressed anything: a system refund has no initiating user. */
    expect(refund?.initiated_by_user_id).toBeNull();
  });

  it("leaves a customer's own cancellation to the policy", async () => {
    await sweep.sweep(ONLY_OURS);

    expect(
      await refundFor(customerCancelled),
      'the tiered path owns this one',
    ).toBeUndefined();

    /* The control: the sweep DID run and did refund the other, so this is scope, not inaction. */
    expect(await refundFor(systemCancelled)).not.toBeUndefined();
  });

  it('does not refund the same booking twice', async () => {
    await sweep.sweep(ONLY_OURS);
    await sweep.sweep(ONLY_OURS);

    const rows = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM refunds r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.reference = ${systemCancelled}
    `);

    expect(rows.rows[0]?.count).toBe('1');
  });

  /**
   * The recovery path, and the reason `failed` is excluded from the "already owed" check.
   *
   * A provider that was briefly unreachable leaves a `failed` refund, and the booking is owed
   * again. A sweep that treated any refund row as satisfaction would strand that customer for
   * ever — the row exists, so nothing would ever look at them again.
   */
  /**
   * The SECOND line of defence, asserted directly because the first one hides it.
   *
   * `owed()` already excludes a booking that has a live refund, so the sweep never calls this
   * twice and a mutation that removed `refundInFull`'s own already-refunded subtraction left every
   * other test in this file green. The method's doc claims it is idempotent by the AMOUNT; that
   * claim needs its own assertion, or the day somebody calls it from a second place the money goes
   * out twice.
   */
  it('refuses a second full refund of the same booking', async () => {
    await sweep.sweep(ONLY_OURS);

    /*
      The CODE, not the status — and that distinction is the whole assertion.

      `toMatchObject({ status: 409 })` passed against a mutation that removed the subtraction,
      because the second attempt then failed one step later with BOOKING_NO_CAPTURED_PAYMENT: the
      first refund had already moved the payment to `refunded`. Two different faults, one status,
      and the test could not tell them apart.
    */
    await expect(
      refunds.refundInFull(systemCancelled, 'system.partner_no_response'),
    ).rejects.toMatchObject({
      /* The code lives in the RESPONSE body — `app-error.ts` builds `{statusCode, code, message}`. */
      response: { code: ERROR.BOOKING_NO_REFUNDABLE_AMOUNT },
    });
  });

  it('does not retry a refund that only just failed', async () => {
    await sweep.sweep(ONLY_OURS);
    await failTheRefund(systemCancelled, false);
    await sweep.sweep(ONLY_OURS);

    expect(await liveRefunds(systemCancelled), 'the backoff holds it').toBe('0');
  });

  it('retries a booking whose earlier refund failed, once the backoff has passed', async () => {
    await sweep.sweep(ONLY_OURS);
    await failTheRefund(systemCancelled, true);
    await sweep.sweep(ONLY_OURS);

    expect(await liveRefunds(systemCancelled), 'a fresh attempt').toBe('1');
  });

  /** Refunds on this booking that are still going somewhere — the sweep's own definition. */
  async function liveRefunds(reference: string): Promise<string> {
    const rows = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM refunds r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.reference = ${reference}
        AND r.status IN ('pending', 'processing', 'completed')
    `);

    return rows.rows[0]?.count ?? '0';
  }

  /**
   * Puts the booking into the state a provider failure really leaves.
   *
   * Two things a naive `UPDATE` would get wrong, and both would make the test assert a fiction:
   *
   * 1. **The PAYMENT goes back to `captured`.** `RefundService` only calls
   *    `markPaymentRefundState` when the provider did NOT fail, so a failed refund never moves the
   *    payment off `captured`. Leaving it `refunded` is a state the system cannot produce.
   * 2. **`updated_at` cannot be aged by an ordinary write.** `touch_updated_at` — one trigger over
   *    every table with the column — sets it to `now()` on EVERY update, which is precisely what
   *    makes the hour's backoff measure the last real attempt in production. So the trigger is
   *    disabled for this one statement inside the rolled-back transaction. Doing it any other way
   *    would mean testing a backoff the trigger had already defeated.
   */
  async function failTheRefund(reference: string, aged: boolean): Promise<void> {
    if (aged) await db.execute(sql`ALTER TABLE refunds DISABLE TRIGGER USER`);

    await db.execute(sql`
      UPDATE refunds
      SET status = 'failed'::refund_status,
          updated_at = CASE WHEN ${aged} THEN now() - INTERVAL '2 hours' ELSE now() END
      WHERE booking_id = (SELECT id FROM bookings WHERE reference = ${reference})
    `);

    if (aged) await db.execute(sql`ALTER TABLE refunds ENABLE TRIGGER USER`);

    await db.execute(sql`
      UPDATE payments SET status = 'captured'::payment_status
      WHERE booking_id = (SELECT id FROM bookings WHERE reference = ${reference})
    `);
  }

  async function refundFor(reference: string): Promise<
    | {
        amount: string;
        applied_refund_percent: string;
        initiated_by_user_id: string | null;
      }
    | undefined
  > {
    const rows = await db.execute<{
      amount: string;
      applied_refund_percent: string;
      initiated_by_user_id: string | null;
    }>(sql`
      SELECT r.amount::text, r.applied_refund_percent::text, r.initiated_by_user_id
      FROM refunds r
      JOIN bookings b ON b.id = r.booking_id
      WHERE b.reference = ${reference}
        AND r.status IN ('pending', 'processing', 'completed')
      LIMIT 1
    `);

    return rows.rows[0];
  }

  /** A paid, captured, cancelled booking — the shape the sweep is looking for. */
  async function seed(cancellationReason: string): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('sr-c-' || gen_random_uuid() || '@safra.test', '+963900000061', 'customer', 'active')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('sr-p-' || gen_random_uuid() || '@safra.test', '+963900000062', 'partner', 'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل الاسترداد', 'sr-c-' || gen_random_uuid() || '@safra.test',
               '+963900000061', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Refund Test', 'شريك الاسترداد', ref.city_id, 'x',
               '+963900000062', 'sr-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'refund-test-' || gen_random_uuid(), 'عقار الاسترداد', 'Refund', 'Refund', 'x',
               'published'
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
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               current_date + 1200, current_date + 1204, 2, 0,
               /*
                 Cancelled a decade ago, so these two sort to the HEAD of the sweep's batch.

                 The dev database already holds thousands of system-cancelled bookings from the
                 seed, and the batch is ordered oldest-first — a fixture cancelled at now() sits
                 behind all of them and is never reached, which is exactly how this test failed
                 the first time it ran.
               */
               'cancelled'::booking_status, now(), now() - INTERVAL '10 years',
               ${cancellationReason},
               ${BASE}, ${FEE}, ${FEE}, '0.0700', '28.00',
               ${TOTAL}, '372.00', ref.currency_id, '13000.00000000', '5668000.00',
               /* A policy with real tiers, so the tiered path would produce a DIFFERENT figure. */
               '{"code":"flex","minRefundPercent":50,"tiers":[{"hoursBeforeCheckIn":48,"refundPercent":80}]}'::jsonb
        FROM cp, un, pr, ref RETURNING id, reference, currency_id
      ), pay AS (
        INSERT INTO payments (booking_id, method, provider, provider_ref, amount, currency_id,
                              status, captured_at)
        SELECT bk.id, 'bank_transfer'::payment_method, 'manual_transfer', 'SEPA-' || gen_random_uuid(),
               ${TOTAL}, bk.currency_id, 'captured'::payment_status, now()
        FROM bk RETURNING id
      )
      SELECT reference FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    return row.reference;
  }
});
