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

export const propertyStatus = pgEnum('property_status', [
  'draft',
  'pending_review',
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

/** SRS §7.1. Rails are enum values; which are ENABLED is per-country config. */
export const paymentMethod = pgEnum('payment_method', [
  'visa',
  'mastercard',
  'sham_cash',
  'paypal',
  'apple_pay',
  'gift_card',
  'wallet',
]);

export const paymentStatus = pgEnum('payment_status', [
  'initiated',
  'authorized',
  'captured',
  'failed',
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
