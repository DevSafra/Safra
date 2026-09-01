import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
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
  couponPartnerStatus,
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
      .default(sql`'GIF-' || reference_number(nextval('gift_card_reference_seq'))`),
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
    /*
      `(purchased_by_customer_id, created_at)`, not the customer alone.

      بطاقاتي is keyset-paginated on `(created_at, id)` like every other customer list, and the
      single-column index made the database filter by customer and then SORT — the shape rule 2 warns
      about, because the set being sorted grows with every card a customer buys. The composite matches
      `bookings_customer_idx`, which is the pattern the other keyset lists already use.
    */
    index('gift_cards_purchaser_idx').on(t.purchasedByCustomerId, t.createdAt),
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

/**
 * Which partners have taken up a coupon, and which have refused it.
 *
 * ## Why a coupon needs opting into at all
 *
 * A discount comes off what the CUSTOMER pays and the partner is still owed what the stay is
 * worth — but a coupon changes the price a listing is advertised at, and that is the partner's
 * business decision rather than SAFRA's. So a new coupon is OFFERED: every eligible partner gets a
 * pending row, and only the ones who accept are eligible for bookings against it
 * (Bashar, 2026-09-01).
 *
 * ## Accepting is final
 *
 * There is no path from `accepted` back to anything, and the portal says so before the partner
 * confirms. The reason is not policy for its own sake: once a coupon is live on a listing a
 * customer may have booked against it, and letting a partner withdraw would either break that
 * booking's price or leave a discount nobody agreed to still honoured. Rejecting IS reversible in
 * the sense that nothing was ever offered to a customer — but it is not made reversible here
 * either, because a partner who changes their mind can be re-offered by staff.
 */
export const couponPartners = pgTable(
  'coupon_partners',
  {
    couponId: foreignId('coupon_id')
      .notNull()
      .references(() => coupons.id),
    partnerId: foreignId('partner_id')
      .notNull()
      .references(() => partners.id),
    status: couponPartnerStatus('status').notNull().default('pending'),
    /** Null while pending — set once, when the partner decides. */
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    decidedByUserId: foreignId('decided_by_user_id').references(() => users.id),
    ...timestamps,
  },
  (t) => [
    primaryKey({ columns: [t.couponId, t.partnerId] }),
    /* The partner portal's own list: their coupons, by what they still have to decide. */
    index('coupon_partners_partner_idx').on(t.partnerId, t.status),
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
    /*
      One redemption of one coupon per BOOKING — idempotency, not a per-customer limit.
      
      The comment here used to claim it enforced `max_redemptions_per_customer = 1` at the database
      level. It does not and cannot: the limit is a column on `coupons`, so no static index over
      this table can express it. What this actually prevents is a retried request redeeming the same
      coupon twice against one booking, which is worth having on its own.

      The per-customer limit is enforced in `CouponService`, under the coupon's row lock — see the
      note there on why the lock is what makes the count safe.
    */
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

/**
 * Inverse sides, required by Drizzle.
 *
 * A `many()` without its matching `one()` throws at QUERY time, not compile time —
 * see `schema/relations.test.ts`, which now runs every relation to keep this class
 * of bug from shipping again.
 */
export const walletTransactionsRelations = relations(walletTransactions, ({ one }) => ({
  wallet: one(wallets, {
    fields: [walletTransactions.walletId],
    references: [wallets.id],
  }),
}));

export const giftCardTransactionsRelations = relations(
  giftCardTransactions,
  ({ one }) => ({
    giftCard: one(giftCards, {
      fields: [giftCardTransactions.giftCardId],
      references: [giftCards.id],
    }),
  }),
);
