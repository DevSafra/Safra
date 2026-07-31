import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { createdAt, foreignId, fxRate, money, primaryId, timestamps } from './_shared.js';
import {
  ledgerAccount,
  ledgerDirection,
  paymentMethod,
  paymentStatus,
  refundStatus,
} from './enums.js';
import { bookings } from './booking.js';
import { currencies } from './geo.js';
import { customerProfiles, users } from './identity.js';
import { partners } from './partner.js';

export const payments = pgTable(
  'payments',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'PAY-' || lpad(nextval('payment_reference_seq')::text, 6, '0')`),
    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    method: paymentMethod('method').notNull(),
    /**
     * Provider slug ("manual_transfer", "klarna", …) — the GATEWAY, distinct from
     * `method`, which is the rail the customer chose. Stored per payment because a
     * refund must route back through whichever provider took the money, and rails
     * differ per country. See ADR 0002.
     */
    provider: text('provider').notNull(),
    providerRef: text('provider_ref'),
    amount: money('amount').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    status: paymentStatus('status').notNull().default('initiated'),
    authorizedAt: timestamp('authorized_at', { withTimezone: true }),
    capturedAt: timestamp('captured_at', { withTimezone: true }),
    failedAt: timestamp('failed_at', { withTimezone: true }),
    /** Provider message for staff. Never surfaced raw to the customer (§1). */
    failureReason: text('failure_reason'),
    /**
     * When this attempt stops being payable. Mirrors the booking's payment window
     * so an abandoned intent cannot be completed after EC-001 released the dates —
     * otherwise a customer pays for a stay someone else now holds.
     */
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /**
     * What the PSP kept. Nullable because most rails only reveal it on settlement,
     * and a guessed fee in the books is worse than a missing one.
     */
    providerFeeAmount: money('provider_fee_amount'),
    ...timestamps,
  },
  (t) => [
    index('payments_booking_idx').on(t.bookingId),
    uniqueIndex('payments_provider_ref_unique')
      .on(t.provider, t.providerRef)
      .where(sql`provider_ref IS NOT NULL`),
    index('payments_status_idx').on(t.status, t.createdAt),
    /** The sweep that expires abandoned intents; partial so it stays small. */
    index('payments_expiry_idx')
      .on(t.expiresAt)
      .where(sql`status IN ('initiated','requires_action') AND expires_at IS NOT NULL`),
  ],
);

/**
 * Every webhook a provider ever sent us, append-only.
 *
 * A table rather than a jsonb array on `payments`, for three reasons that all bite
 * in production:
 *
 *  1. **Dedupe needs a unique index.** PSPs retry aggressively and guarantee only
 *     at-least-once delivery, so the same event arrives repeatedly. `(provider,
 *     provider_event_id)` unique turns a replayed capture into a no-op instead of a
 *     double ledger posting.
 *  2. **It must be writable before the payment is known.** A webhook for an unknown
 *     or mismatched reference still has to be recorded — that is precisely the
 *     evidence needed to investigate. `payment_id` is therefore nullable.
 *  3. An array column grows without bound on a row read in the payment hot path.
 *
 * EC-002 (payment succeeded, customer's connection dropped) is resolved from here,
 * never from the client's claim about what happened.
 */
export const paymentProviderEvents = pgTable(
  'payment_provider_events',
  {
    id: primaryId(),
    provider: text('provider').notNull(),
    /** The PSP's own event id — the dedupe key. */
    providerEventId: text('provider_event_id').notNull(),
    eventType: text('event_type').notNull(),
    paymentId: foreignId('payment_id').references(() => payments.id),
    /** Unparsed body as received, so a signature can be re-verified later. */
    payload: jsonb('payload').notNull(),
    /**
     * False means the signature did not verify. Such an event is stored and NEVER
     * acted upon: discarding it would erase the only trace of someone probing the
     * webhook endpoint.
     */
    signatureVerified: boolean('signature_verified').notNull(),
    /** Null until handled, so a crash mid-processing is visibly unfinished. */
    processedAt: timestamp('processed_at', { withTimezone: true }),
    processingError: text('processing_error'),
    ...createdAt,
  },
  (t) => [
    uniqueIndex('payment_provider_events_dedupe').on(t.provider, t.providerEventId),
    index('payment_provider_events_payment_idx').on(t.paymentId, t.createdAt),
    /** Finds events that were received but never completed processing. */
    index('payment_provider_events_unprocessed_idx')
      .on(t.createdAt)
      .where(sql`processed_at IS NULL`),
  ],
);

export const refunds = pgTable(
  'refunds',
  {
    id: primaryId(),
    paymentId: foreignId('payment_id')
      .notNull()
      .references(() => payments.id),
    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    amount: money('amount').notNull(),
    /**
     * How much of `amount` went back to the customer's wallet rather than out
     * through the gateway (§7.3).
     *
     * Recorded per refund rather than derived, because "how much stored value has
     * already been returned on this booking?" is what bounds the next partial
     * refund, and deriving it from the ledger would mean reconstructing intent from
     * accounts that also carry unrelated movements.
     */
    walletAmount: money('wallet_amount').notNull().default('0'),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    /** Percent actually applied, for audit against the policy snapshot (§7.4). */
    appliedRefundPercent: numeric('applied_refund_percent', { precision: 5, scale: 2 }),
    reason: text('reason').notNull(),
    status: refundStatus('status').notNull().default('pending'),
    providerRef: text('provider_ref'),
    initiatedByUserId: foreignId('initiated_by_user_id').references(() => users.id),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    ...timestamps,
  },
  (t) => [
    index('refunds_booking_idx').on(t.bookingId),
    index('refunds_status_idx').on(t.status),
  ],
);

/**
 * SRS §13.3: "every financial operation needs an immutable transaction record."
 *
 * Double-entry: each movement writes balanced debit/credit rows sharing an
 * `entryGroupId`. Revenue, partner payables and commission are DERIVED from this
 * table by summation — never recomputed from bookings, which can be edited.
 *
 * migrations/post/0001_constraints.sql installs a BEFORE UPDATE OR DELETE trigger
 * that raises instead of allowing the write. Corrections are made by inserting a
 * reversing entry, exactly as in real accounting.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: primaryId(),
    /** Groups the debit and credit legs of one movement. */
    entryGroupId: foreignId('entry_group_id').notNull(),
    account: ledgerAccount('account').notNull(),
    direction: ledgerDirection('direction').notNull(),
    amount: money('amount').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    /** Snapshot, so historical reports in SYP never shift (§1.4). */
    fxRateToSyp: fxRate('fx_rate_to_syp').notNull(),
    amountSyp: numeric('amount_syp', { precision: 18, scale: 2 }).notNull(),

    bookingId: foreignId('booking_id').references(() => bookings.id),
    paymentId: foreignId('payment_id').references(() => payments.id),
    refundId: foreignId('refund_id').references(() => refunds.id),
    partnerId: foreignId('partner_id').references(() => partners.id),
    customerProfileId: foreignId('customer_profile_id').references(
      () => customerProfiles.id,
    ),

    description: text('description').notNull(),
    /** Set only for a reversal; points at the entry being corrected. */
    reversesEntryId: foreignId('reverses_entry_id'),
    createdByUserId: foreignId('created_by_user_id').references(() => users.id),
    ...createdAt,
  },
  (t) => [
    index('ledger_entries_group_idx').on(t.entryGroupId),
    index('ledger_entries_booking_idx').on(t.bookingId),
    index('ledger_entries_partner_idx').on(t.partnerId, t.createdAt),
    index('ledger_entries_account_date_idx').on(t.account, t.createdAt),
  ],
);

/**
 * EC-003: the customer double-clicks Pay. The unique key makes the second request
 * return the FIRST request's stored response instead of charging again.
 *
 * Enforced at the database level rather than in Redis, because the guarantee must
 * survive a cache eviction — a duplicate charge is not a recoverable error.
 */
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    key: text('key').primaryKey(),
    /** e.g. "payment.create" — keys are namespaced per operation. */
    scope: text('scope').notNull(),
    /** Hash of the request body: same key + different payload = client bug, 422. */
    requestHash: text('request_hash').notNull(),
    status: text('status').notNull().default('in_progress'),
    responseBody: jsonb('response_body'),
    responseStatus: numeric('response_status', { precision: 3, scale: 0 }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    ...createdAt,
  },
  (t) => [index('idempotency_keys_expiry_idx').on(t.expiresAt)],
);

export const paymentsRelations = relations(payments, ({ one, many }) => ({
  booking: one(bookings, { fields: [payments.bookingId], references: [bookings.id] }),
  currency: one(currencies, {
    fields: [payments.currencyId],
    references: [currencies.id],
  }),
  refunds: many(refunds),
  providerEvents: many(paymentProviderEvents),
}));

export const paymentProviderEventsRelations = relations(
  paymentProviderEvents,
  ({ one }) => ({
    payment: one(payments, {
      fields: [paymentProviderEvents.paymentId],
      references: [payments.id],
    }),
  }),
);
