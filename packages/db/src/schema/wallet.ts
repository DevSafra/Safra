import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  createdAt,
  foreignId,
  money,
  notDeleted,
  primaryId,
  timestamps,
} from './_shared.js';
import {
  couponType,
  couponValueKind,
  giftCardStatus,
  ledgerDirection,
  walletTxnReason,
} from './enums.js';
import { bookings } from './booking.js';
import { cities, currencies } from './geo.js';
import { customerProfiles, users } from './identity.js';
import { partners } from './partner.js';

/**
 * SRS §2.3 / §7.3. The wallet holds compensation (e.g. the $10 credited when a
 * partner misses the SLA) and may be combined with a gift card and a card in one
 * payment.
 *
 * `balance` is a cache of walletTransactions, kept correct by writing both inside
 * one transaction. The authoritative balance is always SUM(transactions) — a
 * scheduled job reconciles the two and alerts on drift.
 */
export const wallets = pgTable(
  'wallets',
  {
    id: primaryId(),
    customerProfileId: foreignId('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id),
    balance: money('balance').notNull().default('0'),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('wallets_customer_unique').on(t.customerProfileId).where(notDeleted),
  ],
);

/** Append-only; UPDATE/DELETE revoked in the SQL migration. */
export const walletTransactions = pgTable(
  'wallet_transactions',
  {
    id: primaryId(),
    walletId: foreignId('wallet_id')
      .notNull()
      .references(() => wallets.id),
    direction: ledgerDirection('direction').notNull(),
    reason: walletTxnReason('reason').notNull(),
    amount: money('amount').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    /** Balance after this movement, for statement rendering without re-summing. */
    balanceAfter: money('balance_after').notNull(),
    bookingId: foreignId('booking_id').references(() => bookings.id),
    /** Required when reason = admin_adjustment (§4.1: sensitive, audited). */
    createdByUserId: foreignId('created_by_user_id').references(() => users.id),
    note: text('note'),
    ...createdAt,
  },
  (t) => [
    index('wallet_transactions_wallet_idx').on(t.walletId, t.createdAt),
    index('wallet_transactions_booking_idx').on(t.bookingId),
  ],
);

/**
 * SRS §11.2. A gift card is a BEARER INSTRUMENT: whoever knows the code can spend
 * it. The code is therefore hashed like a password and never stored in clear — a
 * leaked database must not hand over spendable balances. `codeLast4` exists so
 * staff can identify a card in support without being able to redeem it.
 */
export const giftCards = pgTable(
  'gift_cards',
  {
    id: primaryId(),
    reference: text('reference')
      .notNull()
      .unique()
      .default(sql`'GIF-' || lpad(nextval('gift_card_reference_seq')::text, 6, '0')`),
    codeHash: text('code_hash').notNull().unique(),
    codeLast4: text('code_last4').notNull(),
    originalAmount: money('original_amount').notNull(),
    remainingAmount: money('remaining_amount').notNull(),
    currencyId: foreignId('currency_id')
      .notNull()
      .references(() => currencies.id),
    status: giftCardStatus('status').notNull().default('active'),
    expiresAt: timestamp('expires_at', { withTimezone: true }),
    /** Who bought it, and who it was issued to (may differ — it is a gift). */
    purchasedByCustomerId: foreignId('purchased_by_customer_id').references(
      () => customerProfiles.id,
    ),
    recipientEmail: text('recipient_email'),
    recipientName: text('recipient_name'),
    /** §11.2: creation and edits require specific admin permissions. */
    issuedByUserId: foreignId('issued_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    index('gift_cards_status_idx').on(t.status, t.expiresAt),
    index('gift_cards_purchaser_idx').on(t.purchasedByCustomerId),
  ],
);

/** Append-only redemption trail; a partial spend leaves a remaining balance (§2.3). */
export const giftCardTransactions = pgTable(
  'gift_card_transactions',
  {
    id: primaryId(),
    giftCardId: foreignId('gift_card_id')
      .notNull()
      .references(() => giftCards.id),
    bookingId: foreignId('booking_id').references(() => bookings.id),
    amount: money('amount').notNull(),
    balanceAfter: money('balance_after').notNull(),
    createdByUserId: foreignId('created_by_user_id').references(() => users.id),
    ...createdAt,
  },
  (t) => [index('gift_card_transactions_card_idx').on(t.giftCardId, t.createdAt)],
);

/** SRS §11.3 — separate from gift cards, as the spec insists. */
export const coupons = pgTable(
  'coupons',
  {
    id: primaryId(),
    code: text('code').notNull(),
    type: couponType('type').notNull(),
    valueKind: couponValueKind('value_kind').notNull(),
    /** Percent (0–100) or a fixed amount in `currencyId`. */
    value: money('value').notNull(),
    currencyId: foreignId('currency_id').references(() => currencies.id),
    /** Cap on a percentage discount, so "50% off" cannot become unbounded. */
    maxDiscountAmount: money('max_discount_amount'),
    minBookingAmount: money('min_booking_amount'),
    startsAt: timestamp('starts_at', { withTimezone: true }).notNull(),
    endsAt: timestamp('ends_at', { withTimezone: true }).notNull(),
    maxRedemptions: integer('max_redemptions'),
    maxRedemptionsPerCustomer: smallint('max_redemptions_per_customer')
      .notNull()
      .default(1),
    redemptionsCount: integer('redemptions_count').notNull().default(0),
    /** Scoping for city / partner coupon types. */
    cityId: foreignId('city_id').references(() => cities.id),
    partnerId: foreignId('partner_id').references(() => partners.id),
    isActive: boolean('is_active').notNull().default(true),
    createdByUserId: foreignId('created_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    uniqueIndex('coupons_code_unique').on(t.code).where(notDeleted),
    index('coupons_window_idx').on(t.startsAt, t.endsAt),
  ],
);

export const couponRedemptions = pgTable(
  'coupon_redemptions',
  {
    id: primaryId(),
    couponId: foreignId('coupon_id')
      .notNull()
      .references(() => coupons.id),
    bookingId: foreignId('booking_id')
      .notNull()
      .references(() => bookings.id),
    customerProfileId: foreignId('customer_profile_id')
      .notNull()
      .references(() => customerProfiles.id),
    discountAmount: money('discount_amount').notNull(),
    ...createdAt,
  },
  (t) => [
    // Enforces maxRedemptionsPerCustomer = 1 at the database level for the common case.
    uniqueIndex('coupon_redemptions_booking_unique').on(t.couponId, t.bookingId),
    index('coupon_redemptions_customer_idx').on(t.couponId, t.customerProfileId),
  ],
);

export const walletsRelations = relations(wallets, ({ one, many }) => ({
  customerProfile: one(customerProfiles, {
    fields: [wallets.customerProfileId],
    references: [customerProfiles.id],
  }),
  transactions: many(walletTransactions),
}));

export const giftCardsRelations = relations(giftCards, ({ many }) => ({
  transactions: many(giftCardTransactions),
}));
