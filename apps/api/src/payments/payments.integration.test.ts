import { createHash, randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { BookingAccessService } from '../bookings/booking-access.service.js';
import { BookingActionsService } from '../bookings/booking-actions.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { PaymentIntentService } from './payment-intent.service.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { RefundService } from './refund.service.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import { ManualTransferProvider } from './providers/manual-transfer.provider.js';
// Only the signer is imported: the registry constructs the simulator itself when
// PAYMENT_SIMULATOR_ENABLED is set, which is exactly the behaviour under test.
import { signSimulatorPayload } from './providers/simulator.provider.js';
import type { AuditService } from '../common/audit/audit.service.js';
import type { SettingsService } from '../settings/settings.service.js';

/**
 * The payment path against a REAL PostgreSQL.
 *
 * Everything worth testing here lives in the database rather than in TypeScript:
 * the `(provider, provider_event_id)` unique index that makes webhook handling
 * exactly-once, the deferred trigger that rejects an unbalanced ledger group, and
 * the trigger that refuses to let a forged webhook payload be rewritten as verified.
 * None of that can be exercised with a mock.
 *
 * **Each test gets its own booking.** Not tidiness — a necessity. `ledger_entries`
 * is append-only and FK-references both `bookings` and `payments`, so once a capture
 * has posted, those rows can never be deleted. Sharing one booking across tests
 * would make the second test's cleanup fail, and scoping assertions to a fresh
 * booking id is the only way to count ledger legs reliably.
 *
 * Skipped when DATABASE_URL is unset so local `pnpm test` stays fast; CI provisions
 * a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const SECRET = 'p'.repeat(48);

const USER_ID = '99991111-0000-0000-0000-0000000000a1';
const PARTNER_ID = '99991111-0000-0000-0000-0000000000a2';
const PROPERTY_ID = '99991111-0000-0000-0000-0000000000a3';
const UNIT_ID = '99991111-0000-0000-0000-0000000000a4';
const PROFILE_ID = '99991111-0000-0000-0000-0000000000a5';

interface Booking {
  id: string;
  reference: string;
}

describeIfDb('payment collection, webhooks and refunds', () => {
  let db: Database;
  let access: BookingAccessService;
  let webhooks: PaymentWebhookService;
  let refunds: RefundService;
  let registry: PaymentProviderRegistry;
  let intents: PaymentIntentService;

  /** The booking under test, replaced before each case. */
  let booking: Booking;

  beforeAll(async () => {
    db = createDatabase(DATABASE_URL as string, 2);

    const audit = { record: () => Promise.resolve() } as unknown as AuditService;
    const ledger = new LedgerService(db);

    /** Routes everything to the simulator; the real routing table is tested separately. */
    const settings = {
      get: <T>(_key: string, _fallback: T) =>
        Promise.resolve({ '*': ['simulator'] } as unknown as T),
      getNumber: (_key: string, fallback: number) => Promise.resolve(fallback),
      invalidate: () => undefined,
    } as unknown as SettingsService;

    registry = new PaymentProviderRegistry(
      {
        PAYMENT_SIMULATOR_ENABLED: true,
        PAYMENT_SIMULATOR_WEBHOOK_SECRETS: [SECRET],
        APP_URL: 'https://safra.test',
      } as never,
      settings,
      new ManualTransferProvider(),
    );

    access = new BookingAccessService(db);

    const actions = new BookingActionsService(db, settings, audit, ledger);
    webhooks = new PaymentWebhookService(db, registry, actions, access);
    refunds = new RefundService(db, registry, ledger, audit);
    intents = new PaymentIntentService(
      db,
      { APP_URL: 'https://safra.test' } as never,
      access,
      registry,
      audit,
    );

    await seedFixtures(db);
  });

  afterAll(async () => {
    await teardown(db);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    booking = await createBooking(db);
  });

  // ── Guest authorization ──────────────────────────────────────────────────────

  describe('booking access token', () => {
    it('authorizes with the correct token', async () => {
      const token = await access.mint(db, booking.id, minutesFromNow(60));
      const subject = await access.authorize(booking.reference, token);

      expect(subject.id).toBe(booking.id);
    });

    /**
     * The reason this token exists. References are a year-scoped sequence (§13.2),
     * so a stranger can guess a live one — the token is what stops them acting on it.
     */
    it('refuses a valid reference with a wrong token', async () => {
      await access.mint(db, booking.id, minutesFromNow(60));

      await expect(access.authorize(booking.reference, 'x'.repeat(43))).rejects.toThrow(
        /not found/i,
      );
    });

    it('refuses an expired token', async () => {
      const token = await access.mint(db, booking.id, minutesFromNow(-1));

      await expect(access.authorize(booking.reference, token)).rejects.toThrow(
        /not found/i,
      );
    });

    it('refuses a booking that has no token at all', async () => {
      await expect(access.authorize(booking.reference, 'y'.repeat(43))).rejects.toThrow(
        /not found/i,
      );
    });

    /** 404 not 403 — a 403 would confirm the reference names a real booking. */
    it('reports a nonexistent reference identically to a wrong token', async () => {
      const missing = await access
        .authorize('BKG-9999-999999', 'z'.repeat(43))
        .catch((error: Error) => error.message);

      await access.mint(db, booking.id, minutesFromNow(60));
      const wrongToken = await access
        .authorize(booking.reference, 'z'.repeat(43))
        .catch((error: Error) => error.message);

      expect(missing).toBe(wrongToken);
    });

    it('stores only the digest, never the token', async () => {
      const token = await access.mint(db, booking.id, minutesFromNow(60));

      const rows = await db.execute<{ access_token_hash: string }>(sql`
        SELECT access_token_hash FROM bookings WHERE id = ${booking.id}::uuid
      `);

      expect(rows.rows[0]?.access_token_hash).not.toBe(token);
      expect(rows.rows[0]?.access_token_hash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
    });

    it('revokes the token so it cannot be reused after capture', async () => {
      const token = await access.mint(db, booking.id, minutesFromNow(60));
      await access.revoke(db, booking.id);

      await expect(access.authorize(booking.reference, token)).rejects.toThrow(
        /not found/i,
      );
    });
  });

  // ── Webhooks ─────────────────────────────────────────────────────────────────

  describe('webhook handling', () => {
    it('captures a payment and posts a balanced four-leg ledger group', async () => {
      const ref = `sim_${booking.id}`;
      const paymentId = await openPayment(db, booking.id, ref);

      expect(await deliver(webhooks, eventId(), ref)).toBe('accepted');
      expect(await bookingStatus(db, booking.id)).toBe('pending_confirmation');
      expect(await paymentStatus(db, paymentId)).toBe('captured');

      const legs = await ledgerLegs(db, booking.id);
      expect(legs.count).toBe(4);
      expect(legs.balanced).toBe(true);
    });

    /**
     * The single most important property here. PSPs guarantee at-least-once
     * delivery, so the same capture arrives repeatedly; without the unique index
     * each redelivery would post another four-leg group and double the revenue.
     */
    it('treats a redelivered event as a duplicate and posts the ledger once', async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);
      const id = eventId();

      expect(await deliver(webhooks, id, ref)).toBe('accepted');
      expect(await deliver(webhooks, id, ref)).toBe('duplicate');
      expect(await deliver(webhooks, id, ref)).toBe('duplicate');

      expect((await ledgerLegs(db, booking.id)).count).toBe(4);
    });

    it('records a forged payload without acting on it', async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);

      const raw = eventBody(eventId(), ref);
      const verdict = await webhooks.handle('simulator', raw, {
        'x-safra-signature': signSimulatorPayload(raw, 'wrong'.repeat(10), nowSec()),
      });

      expect(verdict).toBe('rejected');
      expect(await bookingStatus(db, booking.id)).toBe('pending_payment');
      expect((await ledgerLegs(db, booking.id)).count).toBe(0);

      const stored = await db.execute<{ signature_verified: boolean }>(sql`
        SELECT signature_verified FROM payment_provider_events
        WHERE provider_event_id = ${`unverified:${sha256(raw)}`}
      `);

      // Stored as evidence — the only trace that someone probed the endpoint.
      expect(stored.rows[0]?.signature_verified).toBe(false);
    });

    /**
     * A webhook can outrun the response that persisted `provider_ref`. Rejecting it
     * would make the provider give up on a capture that really is ours.
     */
    it('defers an event whose payment row does not exist yet', async () => {
      expect(await deliver(webhooks, eventId(), `sim_never_${booking.id}`)).toBe(
        'deferred',
      );
    });

    /**
     * If the provider's amount disagreed with SAFRA's record and were trusted,
     * anyone able to forge one webhook could decide what a stay cost.
     */
    it('refuses to capture when the reported amount disagrees', async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);

      const raw = eventBody(eventId(), ref, { amount: '1.00' });
      const verdict = await webhooks.handle('simulator', raw, {
        'x-safra-signature': signSimulatorPayload(raw, SECRET, nowSec()),
      });

      expect(verdict).toBe('rejected');
      expect(await bookingStatus(db, booking.id)).toBe('pending_payment');
      expect((await ledgerLegs(db, booking.id)).count).toBe(0);
    });

    it('records an event for an unregistered provider and rejects it', async () => {
      const raw = eventBody(eventId(), 'sim_x');

      expect(await webhooks.handle('nonexistent_psp', raw, {})).toBe('rejected');

      const stored = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM payment_provider_events
        WHERE provider = 'nonexistent_psp'
      `);

      expect(Number(stored.rows[0]?.count)).toBeGreaterThan(0);
    });

    it('leaves the booking payable after a failed attempt so the customer can retry', async () => {
      const ref = `sim_${booking.id}`;
      const paymentId = await openPayment(db, booking.id, ref);

      const raw = eventBody(eventId(), ref, {
        type: 'payment.failed',
        reason: 'insufficient_funds',
      });

      await webhooks.handle('simulator', raw, {
        'x-safra-signature': signSimulatorPayload(raw, SECRET, nowSec()),
      });

      expect(await paymentStatus(db, paymentId)).toBe('failed');
      // EC-001's sweep owns releasing the dates, not this path.
      expect(await bookingStatus(db, booking.id)).toBe('pending_payment');
    });

    it('refuses to rewrite a stored payload as verified', async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);
      const id = eventId();
      await deliver(webhooks, id, ref);

      const failure = await captureFailure(
        db.execute(sql`
          UPDATE payment_provider_events
          SET payload = '{"tampered":true}'::jsonb
          WHERE provider_event_id = ${id}
        `),
      );

      expect(failure).toMatch(/only processed_at/i);
    });

    it('refuses to delete a stored event', async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);
      const id = eventId();
      await deliver(webhooks, id, ref);

      const failure = await captureFailure(
        db.execute(
          sql`DELETE FROM payment_provider_events WHERE provider_event_id = ${id}`,
        ),
      );

      expect(failure).toMatch(/append-only/i);
    });

    /** Processing state must still be writable, or a retry could never be marked done. */
    it('still allows processed_at and processing_error to be updated', async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);
      const id = eventId();
      await deliver(webhooks, id, ref);

      await expect(
        db.execute(sql`
          UPDATE payment_provider_events
          SET processing_error = 'retried once'
          WHERE provider_event_id = ${id}
        `),
      ).resolves.toBeDefined();
    });
  });

  // ── Refunds ──────────────────────────────────────────────────────────────────

  describe('refunds against the snapshotted policy (§7.4)', () => {
    beforeEach(async () => {
      const ref = `sim_${booking.id}`;
      await openPayment(db, booking.id, ref);
      await deliver(webhooks, eventId(), ref);
    });

    it('quotes the tier that applies, against the base amount only', async () => {
      const quote = await refunds.quote(booking.reference);

      // Check-in is well over 168h out, so the 100% tier applies to the 200.00 base.
      expect(quote.refundPercent).toBe(100);
      expect(quote.refundAmount).toBe('200.00');
    });

    it('posts a balanced two-leg group and completes the refund', async () => {
      const result = await refunds.execute(
        booking.reference,
        'Customer request',
        undefined,
      );

      expect(result.status).toBe('completed');
      expect(result.amount).toBe('200.00');

      const legs = await db.execute<{ count: string; balanced: boolean }>(sql`
        SELECT COUNT(*)::text AS count,
               SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END) = 0 AS balanced
        FROM ledger_entries WHERE refund_id = ${result.refundId}::uuid
      `);

      expect(legs.rows[0]?.count).toBe('2');
      expect(legs.rows[0]?.balanced).toBe(true);
    });

    /**
     * Without subtracting what is already refunded, repeated calls would each pay
     * out the full amount — the most expensive possible bug in this file.
     */
    it('refuses a second refund once the refundable amount is exhausted', async () => {
      await refunds.execute(booking.reference, 'First', undefined);

      await expect(
        refunds.execute(booking.reference, 'Second', undefined),
      ).rejects.toThrow(/no refundable amount/i);
    });

    it('marks the payment refunded once the full base is returned', async () => {
      await refunds.execute(booking.reference, 'Full', undefined);

      const rows = await db.execute<{ status: string }>(sql`
        SELECT status::text AS status FROM payments
        WHERE booking_id = ${booking.id}::uuid ORDER BY created_at DESC LIMIT 1
      `);

      expect(['refunded', 'partially_refunded']).toContain(rows.rows[0]?.status);
    });

    it('never refunds SAFRA’s service fee, only the partner-side base', async () => {
      const quote = await refunds.quote(booking.reference);

      // Booking total is 201.99 = 200.00 base + 1.99 service fee. Only the base
      // is refundable: the fee is earned when the booking is made.
      expect(quote.refundAmount).toBe('200.00');
      expect(quote.refundAmount).not.toBe('201.99');
    });
  });

  // ── Routing ──────────────────────────────────────────────────────────────────

  describe('offered payment methods (§7.1)', () => {
    /**
     * The simulator serves all four approved rails, so with it routed the offered set
     * is the whole whitelist — and critically, in the approved display order rather
     * than whatever order the provider happens to declare.
     */
    it('returns the four approved methods in display order', async () => {
      expect(await registry.availableMethodsForCountry('SY')).toStrictEqual([
        'visa',
        'mastercard',
        'klarna',
        'sham_cash',
      ]);
    });

    it.each(['paypal', 'apple_pay'])('never offers %s', async (removed) => {
      const offered = await registry.availableMethodsForCountry('SY');
      expect(offered as readonly string[]).not.toContain(removed);
    });

    /**
     * `manual_transfer` supports only `bank_transfer`, which is not customer-facing.
     * An empty list is the correct answer — and the honest one while no external rail
     * is contracted. Offering something unservable would strand the customer.
     */
    it('offers nothing when only the offline rail is routed', async () => {
      const offlineOnly = new PaymentProviderRegistry(
        {
          PAYMENT_SIMULATOR_ENABLED: false,
          PAYMENT_SIMULATOR_WEBHOOK_SECRETS: [],
        } as never,
        {
          get: <T>(_key: string, _fallback: T) =>
            Promise.resolve({ '*': ['manual_transfer'] } as unknown as T),
        } as unknown as SettingsService,
        new ManualTransferProvider(),
      );

      expect(await offlineOnly.availableMethodsForCountry('SY')).toStrictEqual([]);
    });

    it('does not offer a method whose provider is not registered', async () => {
      const misconfigured = new PaymentProviderRegistry(
        {
          PAYMENT_SIMULATOR_ENABLED: false,
          PAYMENT_SIMULATOR_WEBHOOK_SECRETS: [],
        } as never,
        {
          get: <T>(_key: string, _fallback: T) =>
            Promise.resolve({ '*': ['some_unsigned_acquirer'] } as unknown as T),
        } as unknown as SettingsService,
        new ManualTransferProvider(),
      );

      expect(await misconfigured.availableMethodsForCountry('SY')).toStrictEqual([]);
    });
  });

  describe('the rail is recorded on the payment', () => {
    /**
     * Regression guard for a placeholder that used to hardcode `visa`: a Klarna or
     * Sham Cash payment labelled `visa` makes every report of the rail mix wrong, and
     * would misdirect anyone tracing a refund.
     */
    it.each(['klarna', 'sham_cash', 'mastercard'] as const)(
      'records %s when the customer chose it',
      async (chosen) => {
        const started = await intents.start({
          reference: booking.reference,
          accessToken: await access.mint(db, booking.id, minutesFromNow(60)),
          method: chosen,
          locale: 'ar',
        });

        expect(started.status).toBe('requires_action');

        const rows = await db.execute<{ method: string }>(sql`
          SELECT method::text AS method FROM payments
          WHERE booking_id = ${booking.id}::uuid ORDER BY created_at DESC LIMIT 1
        `);

        expect(rows.rows[0]?.method).toBe(chosen);
      },
    );

    it('falls back to a rail the provider supports when none is requested', async () => {
      await intents.start({
        reference: booking.reference,
        accessToken: await access.mint(db, booking.id, minutesFromNow(60)),
        locale: 'ar',
      });

      const rows = await db.execute<{ method: string }>(sql`
        SELECT method::text AS method FROM payments
        WHERE booking_id = ${booking.id}::uuid ORDER BY created_at DESC LIMIT 1
      `);

      // Whatever it is, it must be something the simulator actually serves.
      expect(['visa', 'mastercard', 'klarna', 'sham_cash']).toContain(
        rows.rows[0]?.method,
      );
    });
  });

  describe('provider routing', () => {
    it('falls back to the wildcard when a country has no explicit route', async () => {
      expect((await registry.resolveForCountry('DE', undefined)).slug).toBe('simulator');
    });

    it('looks a provider up by slug, as refunds must', () => {
      expect(registry.bySlug('manual_transfer')?.slug).toBe('manual_transfer');
      expect(registry.bySlug('nope')).toBeUndefined();
    });

    it('marks bank transfer offline so the UI cannot imply instant payment', () => {
      expect(registry.bySlug('manual_transfer')?.isOffline).toBe(true);
      expect(registry.bySlug('simulator')?.isOffline).toBe(false);
    });
  });
});

// ── Helpers ────────────────────────────────────────────────────────────────────

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

function minutesFromNow(minutes: number): Date {
  return new Date(Date.now() + minutes * 60_000);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * Flattens a rejected query into one searchable string.
 *
 * Drizzle wraps a driver error as `Failed query: …` and hangs the real PostgreSQL
 * message off `cause`, so `rejects.toThrow(/append-only/)` matches the wrapper and
 * passes or fails for the wrong reason. Walking the chain asserts on what the
 * database actually said.
 */
async function captureFailure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return '';
  } catch (error) {
    const parts: string[] = [];

    let current: unknown = error;
    while (current instanceof Error) {
      parts.push(current.message);
      current = (current as { cause?: unknown }).cause;
    }

    return parts.join(' | ');
  }
}

/** Unique per call, so no two tests can collide on the dedupe index. */
function eventId(): string {
  return `evt_${randomUUID()}`;
}

function eventBody(
  id: string,
  paymentRef: string,
  overrides: Record<string, unknown> = {},
): string {
  return JSON.stringify({
    id,
    type: 'payment.captured',
    payment_ref: paymentRef,
    amount: '201.99',
    currency: 'USD',
    ...overrides,
  });
}

async function deliver(
  webhooks: PaymentWebhookService,
  id: string,
  paymentRef: string,
): Promise<string> {
  const raw = eventBody(id, paymentRef);

  return webhooks.handle('simulator', raw, {
    'x-safra-signature': signSimulatorPayload(raw, SECRET, nowSec()),
  });
}

async function openPayment(
  db: Database,
  bookingId: string,
  providerRef: string,
): Promise<string> {
  const rows = await db.execute<{ id: string }>(sql`
    INSERT INTO payments (booking_id, method, provider, provider_ref, amount,
                          currency_id, status)
    SELECT ${bookingId}::uuid, 'visa', 'simulator', ${providerRef}, 201.99, cu.id,
           'requires_action'
    FROM currencies cu WHERE cu.code = 'USD' LIMIT 1
    RETURNING id
  `);

  const id = rows.rows[0]?.id;
  if (!id) throw new Error('Test payment insert returned no row.');

  return id;
}

async function bookingStatus(db: Database, bookingId: string): Promise<string> {
  const rows = await db.execute<{ status: string }>(sql`
    SELECT status::text AS status FROM bookings WHERE id = ${bookingId}::uuid
  `);

  return rows.rows[0]?.status ?? '';
}

async function paymentStatus(db: Database, paymentId: string): Promise<string> {
  const rows = await db.execute<{ status: string }>(sql`
    SELECT status::text AS status FROM payments WHERE id = ${paymentId}::uuid
  `);

  return rows.rows[0]?.status ?? '';
}

async function ledgerLegs(
  db: Database,
  bookingId: string,
): Promise<{ count: number; balanced: boolean }> {
  const rows = await db.execute<{ count: string; balanced: boolean | null }>(sql`
    SELECT COUNT(*)::text AS count,
           COALESCE(SUM(CASE WHEN direction = 'debit' THEN amount ELSE -amount END) = 0, true)
             AS balanced
    FROM ledger_entries WHERE booking_id = ${bookingId}::uuid
  `);

  return {
    count: Number(rows.rows[0]?.count ?? 0),
    balanced: rows.rows[0]?.balanced ?? true,
  };
}

/**
 * A fresh booking — on its own fresh unit — per test.
 *
 * The unit matters. `bookings_no_overlapping_stays_v2` EXCLUDEs overlapping live
 * bookings per `unit_id`, and rows a capture touched can never be deleted (the
 * ledger FK-references them and is append-only). Varying only the dates would still
 * collide with leftovers from a previous run, since any counter restarts at the same
 * value; giving each booking its own unit makes the constraint irrelevant here
 * without weakening it, and lets every booking keep identical dates so the refund
 * tier assertions stay stable.
 */
async function createBooking(db: Database): Promise<Booking> {
  const id = randomUUID();
  const unitId = randomUUID();
  const reference = `BKG-TEST-${id.slice(0, 8)}`;

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${unitId}::uuid, ${PROPERTY_ID}::uuid, 'وحدة', 'Unit', 'Einheit', 4, 50, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD'
    LIMIT 1`);

  await db.execute(sql`
    INSERT INTO bookings (
      id, reference, customer_profile_id, unit_id, property_id, partner_id, city_id,
      check_in, check_out, guests_adults, status,
      base_amount, customer_fee_mode, customer_fee_value, customer_fee_amount,
      partner_commission_rate, partner_commission_amount, total_amount,
      partner_payable_amount, currency_id, fx_rate_to_syp, total_syp,
      cancellation_policy_snapshot, confirmation_deadline_at)
    SELECT ${id}::uuid, ${reference}, ${PROFILE_ID}::uuid, ${unitId}::uuid,
           ${PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id,
           (now() + interval '30 days')::date,
           (now() + interval '34 days')::date, 2,
           'pending_payment',
           /**
            * These must satisfy total = base + customer fee, and
            * payable = base - commission. The ledger's balance trigger enforces
            * exactly that identity, so a fixture that violates it fails at COMMIT
            * rather than producing a misleading pass:
            *   total 201.99 = base 200.00 + fee 1.99
            *   payable 186.00 = base 200.00 - commission 14.00 (7%)
            */
           200.00, 'flat', 1.99, 1.99,
           0.07, 14.00, 201.99,
           186.00, cu.id, 13000.00000000, 2625870.00,
           ${JSON.stringify({
             code: 'flex',
             tiers: [
               { hoursBeforeCheckIn: 168, refundPercent: 100 },
               { hoursBeforeCheckIn: 48, refundPercent: 75 },
             ],
             minRefundPercent: 50,
           })}::jsonb,
           now() + interval '1 hour'
    FROM cities c, currencies cu
    WHERE c.slug = 'damascus' AND cu.code = 'USD'
    LIMIT 1`);

  return { id, reference };
}

async function seedFixtures(db: Database): Promise<void> {
  await db.execute(sql`
    INSERT INTO users (id, email, role)
    VALUES (${USER_ID}::uuid, 'payments-test@safra.test', 'partner')
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO partners (id, user_id, partner_type_id, legal_name, display_name, city_id,
                          address, phone, email)
    SELECT ${PARTNER_ID}::uuid, ${USER_ID}::uuid, pt.id, 'Pay Test', 'دفع', c.id,
           'Addr', '+963900000001', 'payments-test@safra.test'
    FROM partner_types pt, cities c
    WHERE pt.code = 'accommodation' AND c.slug = 'damascus'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO properties (id, partner_id, city_id, property_type_id, slug,
                            name_ar, name_en, name_de, address, cancellation_policy_id, status)
    SELECT ${PROPERTY_ID}::uuid, ${PARTNER_ID}::uuid, c.id, pt.id, 'payments-test-property',
           'دفع', 'Payments Test', 'Test', 'Addr', cp.id, 'published'
    FROM cities c, property_types pt, cancellation_policies cp
    WHERE c.slug = 'damascus' AND pt.code = 'apartment' AND cp.code = 'flex'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO units (id, property_id, name_ar, name_en, name_de, max_guests,
                       base_price, currency_id, min_nights)
    SELECT ${UNIT_ID}::uuid, ${PROPERTY_ID}::uuid, 'وحدة', 'Unit', 'Einheit', 4, 50, cu.id, 1
    FROM currencies cu WHERE cu.code = 'USD'
    LIMIT 1
    ON CONFLICT DO NOTHING`);

  await db.execute(sql`
    INSERT INTO customer_profiles (id, full_name, email, phone)
    VALUES (${PROFILE_ID}::uuid, 'Payments Guest', 'pay-guest@safra.test', '+963900000002')
    ON CONFLICT DO NOTHING`);
}

/**
 * Best-effort cleanup.
 *
 * Three categories of row here CANNOT be removed, by design rather than oversight:
 * `payment_provider_events` is append-only by trigger, and `ledger_entries` is both
 * append-only and FK-referencing `bookings` and `payments`. Attempting those deletes
 * would fail the suite on constraints that are supposed to hold — the very
 * guarantees the tests above assert.
 *
 * So only bookings no capture ever touched are removed. CI runs against a fresh
 * database; locally the residue is namespaced `BKG-TEST-*`.
 */
async function teardown(db: Database): Promise<void> {
  await db
    .execute(
      sql`DELETE FROM bookings WHERE reference LIKE 'BKG-TEST-%'
                 AND id NOT IN (SELECT DISTINCT booking_id FROM ledger_entries
                                WHERE booking_id IS NOT NULL)
                 AND id NOT IN (SELECT DISTINCT booking_id FROM payments)`,
    )
    .catch(() => undefined);
}
