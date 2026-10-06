import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { unlockedJobRuns } from '../common/jobs/job-run.testing.js';
import type { Env } from '../config/env.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { NotificationService } from '../notifications/notification.service.js';
import type { MoneySettingsService } from '../settings/money-settings.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { BookingActionsService } from './booking-actions.service.js';
import { SlaService } from './sla.service.js';
import { VoucherService } from './voucher.service.js';
import { interleaved } from '../common/testing/interleaved.testing.js';

/**
 * Two writers meeting on one booking, and only the one whose guarded UPDATE moved the row acting.
 *
 * ## Why these are interleavings and not `Promise.all`
 *
 * The rollback harness pins one connection, so two calls fired "at once" would simply run one
 * after the other and pass whatever the code did. What each defect needs is a precise moment: the
 * other writer commits AFTER this one read the status and BEFORE its transaction wrote. So the test
 * puts the other writer exactly there, through a seam the service already crosses at that moment
 * (the money settings the sweep resolves between its read and its transaction; the start of the
 * service's own `transaction`). Deterministic, and it fails against the old code every time rather
 * than one run in fifty.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a booking two writers reach at once', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: { template: string; bookingId: string | undefined }[] = [];
  const notifications = {
    notify: (
      template: string,
      _mail: unknown,
      _locale: string,
      subject?: { bookingId?: string },
    ) => {
      sent.push({ template, bookingId: subject?.bookingId });

      return Promise.resolve();
    },
  } as unknown as NotificationService;

  const fx = {
    rateToSyp: () => {
      throw new Error('FX must not be consulted for a same-currency movement.');
    },
  } as unknown as FxRateService;

  const crypto = new FieldEncryptionService({
    FIELD_ENCRYPTION_KEY: 'c'.repeat(64),
  } as unknown as Env);

  /** The service, over whichever handle the test wants it to see. */
  const actionsOver = (handle: Database) =>
    new BookingActionsService(
      handle,
      new SettingsService(handle),
      new AuditService(handle),
      new LedgerService(handle),
      new WalletService(handle, fx),
      notifications,
      {
        PARTNER_URL: 'https://partner.test',
        APP_URL: 'https://safra.test',
      } as unknown as Env,
      new VoucherService(handle),
      crypto,
    );

  let booking = { id: '', reference: '', partnerId: '' };

  beforeEach(async () => {
    await harness.begin();
    sent.length = 0;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const statusOf = async () =>
    (
      await db.execute<{ status: string }>(sql`
        SELECT status::text AS status FROM bookings WHERE id = ${booking.id}
      `)
    ).rows[0]?.status;

  const countOf = async (query: ReturnType<typeof sql>) =>
    Number((await db.execute<{ n: string }>(query)).rows[0]?.n ?? 0);

  /* ── 1. The §6.4 sweep and the partner's «قبول» ───────────────────────────────────────── */

  describe('the confirmation sweep against the partner accepting', () => {
    beforeEach(async () => {
      booking = await aBooking('pending_confirmation', `now() - INTERVAL '1 minute'`);

      /*
        Every OTHER overdue booking pushed out of the window, inside the rollback, so the sweep's
        candidate list is this one alone and the interleaving below fires on it.
      */
      await db.execute(sql`
        UPDATE bookings SET confirmation_deadline_at = now() + INTERVAL '10 hours'
        WHERE status IN ('pending_confirmation', 'pending_payment') AND id <> ${booking.id}
      `);
    });

    /**
     * The partner accepts after the sweep has listed the booking and before it cancels.
     *
     * Watched to fail against the old code: the UPDATE matched nothing, and the fine, the wallet
     * compensation, the ledger group and «أُلغي حجزك» all went out on a CONFIRMED booking.
     */
    it('fines, compensates and tells nobody about a booking the partner just confirmed', async () => {
      let accepted = false;

      const money = {
        resolveOrFallback: async (_key: string, fallback: string) => {
          if (!accepted) {
            accepted = true;
            await db.execute(sql`
              UPDATE bookings
              SET status = 'confirmed', partner_responded_at = now(), confirmed_at = now(),
                  confirmation_deadline_at = NULL
              WHERE id = ${booking.id}
            `);
          }

          return fallback;
        },
      } as unknown as MoneySettingsService;

      const sla = new SlaService(
        db,
        money,
        new LedgerService(db),
        new WalletService(db, fx),
        unlockedJobRuns(db),
        notifications,
        { APP_URL: 'https://safra.test', PARTNER_URL: 'https://partner.test' } as never,
      );

      await sla.sweep();

      expect(await statusOf()).toBe('confirmed');
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM partner_violations
                          WHERE booking_id = ${booking.id}`),
        'a violation on a booking the partner confirmed',
      ).toBe(0);
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM wallet_transactions
                          WHERE booking_id = ${booking.id}`),
        'compensation for a stay that is going ahead',
      ).toBe(0);
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM ledger_entries
                          WHERE booking_id = ${booking.id}`),
      ).toBe(0);
      expect(sent.filter((one) => one.bookingId === booking.id)).toHaveLength(0);
    });

    /** The control: with nobody accepting, the sweep still does all of it. */
    it('still cancels, fines and tells the customer when nobody answered', async () => {
      const sla = new SlaService(
        db,
        {
          resolveOrFallback: (_k: string, fallback: string) => Promise.resolve(fallback),
        } as never,
        new LedgerService(db),
        new WalletService(db, fx),
        unlockedJobRuns(db),
        notifications,
        { APP_URL: 'https://safra.test', PARTNER_URL: 'https://partner.test' } as never,
      );

      await sla.sweep();

      expect(await statusOf()).toBe('cancelled');
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM partner_violations
                          WHERE booking_id = ${booking.id}`),
      ).toBe(1);
      expect(
        sent.filter((one) => one.bookingId === booking.id).map((one) => one.template),
      ).toEqual(['booking.cancelled_refund']);
    });

    /** The sweep cancels after the partner read the booking and before they wrote. */
    const sweepCancels = () =>
      db.execute(sql`
        UPDATE bookings
        SET status = 'cancelled', cancelled_at = now(),
            cancellation_reason = 'system.partner_no_response'
        WHERE id = ${booking.id}
      `);

    it('does not confirm, or mail a voucher for, a booking the sweep just cancelled', async () => {
      const refusal = await actionsOver(interleaved(db, sweepCancels))
        .partnerDecision(
          booking.reference,
          booking.partnerId,
          'confirm',
          undefined,
          undefined,
        )
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe(ERROR.BOOKING_TRANSITION_INVALID);
      expect(await statusOf()).toBe('cancelled');
      expect(
        sent.filter(
          (one) => one.bookingId === booking.id && one.template === 'booking.confirmed',
        ),
        'a voucher for a cancelled stay',
      ).toHaveLength(0);
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM timeline_events
                          WHERE subject_id = ${booking.id} AND event_type = 'booking.confirmed'`),
      ).toBe(0);
    });

    it('does not record a second violation when the partner rejects one the sweep cancelled', async () => {
      const refusal = await actionsOver(interleaved(db, sweepCancels))
        .partnerDecision(
          booking.reference,
          booking.partnerId,
          'reject',
          'full',
          undefined,
        )
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe(ERROR.BOOKING_TRANSITION_INVALID);
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM partner_violations
                          WHERE booking_id = ${booking.id} AND kind = 'rejected_after_payment'`),
      ).toBe(0);
    });

    /** The control for both: a partner answering in time is answered. */
    it('confirms when nothing interferes', async () => {
      await db.execute(sql`
        UPDATE bookings SET confirmation_deadline_at = now() + INTERVAL '1 hour'
        WHERE id = ${booking.id}
      `);

      await actionsOver(db).partnerDecision(
        booking.reference,
        booking.partnerId,
        'confirm',
        undefined,
        undefined,
      );

      expect(await statusOf()).toBe('confirmed');
    });
  });

  /* ── 2. A capture against the payment-expiry sweep, and against itself ─────────────────── */

  describe('a payment captured while the booking moves underneath it', () => {
    beforeEach(async () => {
      booking = await aBooking('pending_payment', `now() + INTERVAL '20 minutes'`);
    });

    const capturesFor = () =>
      countOf(sql`SELECT count(DISTINCT entry_group_id)::text AS n FROM ledger_entries
                  WHERE booking_id = ${booking.id}`);

    /**
     * EC-001 expires the booking between the capture's read and its write.
     *
     * Watched to fail against the old code: the UPDATE matched nothing and the capture still posted
     * revenue and a captured payment against a CANCELLED booking.
     */
    it('posts nothing for a booking the expiry sweep cancelled first', async () => {
      const expire = () =>
        db.execute(sql`
          UPDATE bookings SET status = 'cancelled', cancelled_at = now(),
                 cancellation_reason = 'system.payment_expired'
          WHERE id = ${booking.id}
        `);

      const refusal = await actionsOver(interleaved(db, expire))
        .markPaid(booking.reference, undefined)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe(ERROR.BOOKING_TRANSITION_INVALID);
      expect(await statusOf()).toBe('cancelled');
      expect(await capturesFor(), 'revenue on a cancelled booking').toBe(0);
      expect(
        await countOf(sql`SELECT count(*)::text AS n FROM payments
                          WHERE booking_id = ${booking.id} AND status = 'captured'`),
      ).toBe(0);
    });

    /** Two capture events for one payment: the second must not post a second group. */
    it('posts one capture when two arrive together', async () => {
      const first = () => actionsOver(db).markPaid(booking.reference, undefined);

      const refusal = await actionsOver(interleaved(db, first))
        .markPaid(booking.reference, undefined)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe(ERROR.BOOKING_TRANSITION_INVALID);
      expect(await statusOf()).toBe('pending_confirmation');
      expect(await capturesFor(), 'the money counted twice').toBe(1);
    });
  });

  /* ── 10. Staff recording an arrival before the stay starts ─────────────────────────────── */

  describe('staff checking a guest in', () => {
    it('refuses before the check-in date', async () => {
      booking = await aBooking('confirmed', 'NULL', 'current_date + 5');

      const refusal = await actionsOver(db)
        .staffCheckIn(booking.reference, undefined)
        .catch((error: unknown) => error);

      expect(codeOf(refusal)).toBe(ERROR.BOOKING_CHECK_IN_TOO_EARLY);
      expect(await statusOf()).toBe('confirmed');
    });

    /**
     * The control, and the boundary the rule is about: the morning of arrival, in the CITY's own
     * calendar. Today in the city's zone is the check-in date here, so it is allowed.
     */
    it('allows it on the check-in date in the city’s own zone', async () => {
      booking = await aBooking(
        'confirmed',
        'NULL',
        `(now() AT TIME ZONE (SELECT timezone FROM cities WHERE id = ref.city_id))::date`,
      );

      await actionsOver(db).staffCheckIn(booking.reference, undefined);

      expect(await statusOf()).toBe('checked_in');
    });
  });

  /** One booking of this test's own, in `status`, with the given deadline and arrival. */
  async function aBooking(
    status: string,
    deadline: string,
    checkIn = 'current_date + 1400',
  ): Promise<{ id: string; reference: string; partnerId: string }> {
    const made = await db.execute<{
      id: string;
      reference: string;
      partner_id: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM currencies WHERE code = 'USD')           AS currency_id,
               (SELECT id FROM property_types LIMIT 1)                  AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)           AS policy_id
      ), cu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('race-c-' || gen_random_uuid() || '@safra.test', '+963900000071', 'customer',
                'active', 'ar')
        RETURNING id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('race-p-' || gen_random_uuid() || '@safra.test', '+963900000072', 'partner',
                'active')
        RETURNING id
      ), cp AS (
        INSERT INTO customer_profiles (user_id, full_name, email, phone, is_guest)
        SELECT cu.id, 'نزيل السباق', 'race-c-' || gen_random_uuid() || '@safra.test',
               '+963900000071', false
        FROM cu RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Race Test', 'شريك السباق', ref.city_id, 'x',
               '+963900000072', 'race-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'race-test-' || gen_random_uuid(), 'عقار السباق', 'Race', 'Race', 'x', 'published'
        FROM pa, ref RETURNING id, partner_id
      ), un AS (
        INSERT INTO units (property_id, name_ar, name_en, name_de, max_guests, base_price,
                           currency_id)
        SELECT pr.id, 'وحدة', 'Unit', 'Einheit', 4, '100.00', ref.currency_id
        FROM pr, ref RETURNING id
      ), bk AS (
        INSERT INTO bookings (customer_profile_id, unit_id, property_id, partner_id, city_id,
                              check_in, check_out, guests_adults, guests_children, status,
                              paid_at, confirmation_deadline_at,
                              base_amount, customer_fee_value, customer_fee_amount,
                              partner_commission_rate, partner_commission_amount,
                              total_amount, partner_payable_amount, currency_id,
                              fx_rate_to_syp, total_syp, cancellation_policy_snapshot)
        SELECT cp.id, un.id, pr.id, pr.partner_id, ref.city_id,
               ${sql.raw(checkIn)}, ${sql.raw(checkIn)} + 2, 2, 0,
               ${status}::booking_status,
               CASE WHEN ${status} = 'pending_payment' THEN NULL ELSE now() END,
               ${sql.raw(deadline)},
               '200.00', '18.00', '18.00', '0.0700', '14.00',
               '218.00', '186.00', ref.currency_id, '13000.00000000', '2834000.00',
               '{"code":"flex"}'::jsonb
        FROM cp, un, pr, ref RETURNING id, reference, partner_id
      )
      SELECT id, reference, partner_id FROM bk
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    return { id: row.id, reference: row.reference, partnerId: row.partner_id };
  }
});
