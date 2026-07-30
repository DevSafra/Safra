import { pgEnum } from 'drizzle-orm/pg-core';

/**
 * Enums here encode BUSINESS LOGIC — states the code branches on. Anything the
 * admin must be able to extend without a deploy (cities, currencies, property
 * types, amenities, cancellation policies, partner types) is a TABLE instead.
 * That split is principle P-005: operational values never live in code.
 */

/** SRS §6.2. The full booking lifecycle. */
export const bookingStatus = pgEnum('booking_status', [
  'draft',
  'pending_payment',
  'pending_confirmation',
  'confirmed',
  'cancelled',
  'checked_in',
  'completed',
  'disputed',
]);

/** SRS §4. Visitor is not stored — it is the absence of a session. */
export const userRole = pgEnum('user_role', [
  'customer',
  'partner',
  'support_agent',
  'finance_officer',
  'operations_manager',
  'super_admin',
]);

export const userStatus = pgEnum('user_status', ['active', 'suspended', 'archived']);

/** SRS §8.1: nothing is published before SAFRA verifies it (principle P-002). */
export const verificationStatus = pgEnum('verification_status', [
  'pending',
  'in_review',
  'approved',
  'rejected',
]);

/** SRS §8.5: partner tiers, driven by the internal score. */
export const partnerTier = pgEnum('partner_tier', [
  'new',
  'needs_improvement',
  'silver',
  'gold',
]);

/**
 * §8.1: nothing publishes before SAFRA verifies it.
 *
 * `rejected` is a distinct state from `draft`: a rejected listing carries review
 * notes telling the partner what to fix, and it must be re-submitted rather than
 * silently reverting to an untouched draft. Without it there is nowhere to record
 * that a review happened and failed.
 */
export const propertyStatus = pgEnum('property_status', [
  'draft',
  'pending_review',
  'rejected',
  'approved',
  'published',
  'suspended',
  'archived',
]);

/** SRS §8.4: per-day calendar state for a unit. */
export const dayStatus = pgEnum('day_status', [
  'available',
  'booked',
  'closed',
  'maintenance',
]);

/**
 * Payment rails (SRS §7.1, narrowed by Bashar on 2026-07-30).
 *
 * The four the site offers a customer are **visa, mastercard, sham_cash, klarna**.
 * `paypal` and `apple_pay` were removed on instruction — §7.1 names PayPal, but it
 * refused Syria-originating business in March 2026, so the spec could not have been
 * satisfied anyway (ADR 0002).
 *
 * The remaining three are NOT customer-facing and exist for different reasons:
 *
 *  - `gift_card` and `wallet` are internal SAFRA balances, not gateways. §7.3's
 *    split payment and §11.2's gift cards are settled against them, so removing
 *    them would delete those features rather than a payment option.
 *  - `bank_transfer` is the finance-side SEPA fallback. It is deliberately absent
 *    from the offered set (see CUSTOMER_FACING_METHODS in @safra/contracts), so a
 *    customer never sees it, but it is retained because it is the only rail that
 *    needs no third-party agreement — which matters while all three external rails
 *    are pending underwriting.
 *
 * Which of the four are actually OFFERED is derived from provider routing, never
 * hardcoded: a method with no registered provider behind it is not shown.
 */
export const paymentMethod = pgEnum('payment_method', [
  'visa',
  'mastercard',
  'sham_cash',
  'klarna',
  'gift_card',
  'wallet',
  'bank_transfer',
]);

/**
 * `requires_action` is not cosmetic — it is PSD2/SCA.
 *
 * An EEA card payment routinely suspends mid-flow for a 3-D Secure challenge, so
 * "initiated" and "authorized" cannot describe the interval where the customer
 * has left for their bank's page. Without a state for it, a resumed payment looks
 * indistinguishable from a stalled one and the SLA sweep would cancel bookings
 * whose customers are mid-challenge.
 */
export const paymentStatus = pgEnum('payment_status', [
  'initiated',
  'requires_action',
  'authorized',
  'captured',
  'failed',
  'expired',
  'refunded',
  'partially_refunded',
]);

export const refundStatus = pgEnum('refund_status', [
  'pending',
  'processing',
  'completed',
  'failed',
]);

/**
 * Double-entry accounts. Every money movement writes balanced ledger rows, so
 * revenue is derived from the ledger rather than recomputed from bookings.
 */
export const ledgerAccount = pgEnum('ledger_account', [
  'customer_payment',
  'safra_commission_customer',
  'safra_commission_partner',
  'partner_payable',
  'partner_payout',
  'refund',
  'wallet_credit',
  'wallet_debit',
  'gift_card_redemption',
  'partner_fine',
  /**
   * What the PSP keeps. A cost to SAFRA, not to the partner and not to the
   * customer, so it needs its own account: netting it against commission would
   * overstate the fee SAFRA actually earned and make the margin unreadable.
   */
  'payment_provider_fee',
]);

export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);

export const walletTxnReason = pgEnum('wallet_txn_reason', [
  'sla_compensation',
  'refund',
  'booking_payment',
  'admin_adjustment',
  'gift_card_transfer',
]);

export const giftCardStatus = pgEnum('gift_card_status', [
  'active',
  'used',
  'expired',
  'cancelled',
]);

/** SRS §11.3. */
export const couponType = pgEnum('coupon_type', [
  'first_booking',
  'seasonal',
  'city',
  'partner',
  'campaign',
]);

export const couponValueKind = pgEnum('coupon_value_kind', ['percent', 'fixed']);

export const disputeStatus = pgEnum('dispute_status', [
  'open',
  'investigating',
  'resolved',
  'rejected',
]);

/** SRS §10.2: WhatsApp delivery state must be tracked per message. */
export const notificationChannel = pgEnum('notification_channel', [
  'whatsapp',
  'email',
  'in_app',
]);

export const notificationStatus = pgEnum('notification_status', [
  'queued',
  'sent',
  'delivered',
  'failed',
]);

/** SRS §6.4 / §8.5: partner violations that carry fines and score penalties. */
export const violationKind = pgEnum('violation_kind', [
  'no_response',
  'rejected_after_payment',
  'stale_calendar',
  'inaccurate_listing',
  'no_show',
]);

export const adStatus = pgEnum('ad_status', ['draft', 'active', 'paused', 'expired']);

/** SRS §5.4: the four fixed city categories. Cities may carry several. */
export const cityCategory = pgEnum('city_category', [
  'coastal',
  'mountain',
  'desert',
  'historic',
]);
