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

/**
 * A partner payout's lifecycle (design handoff §7.1).
 *
 * These are states of a real money EVENT, not of an inferred obligation. What a partner is owed
 * already lives in the ledger as `partner_payable`; a payout is the transfer that discharges some
 * of it, and it exists as a row only once SAFRA has decided to make it.
 *
 * - `accruing`         the open period for this partner. Bookings join it as they become payable.
 * - `pending_release`  the period is closed and the total is fixed, awaiting a human.
 * - `on_hold`          frozen. An open dispute freezes the partner's entitlement (§8, the console
 *                      states this on every unresolved dispute), and so does a manual hold.
 * - `scheduled`        released by staff, with a date — the handoff's "مجدول يوم الخميس".
 * - `paid`             the transfer happened. Terminal, and the only state that writes the ledger.
 * - `cancelled`        abandoned before payment; its bookings return to accrual. Terminal.
 */
export const payoutStatus = pgEnum('payout_status', [
  'accruing',
  'pending_release',
  'on_hold',
  'scheduled',
  'paid',
  'cancelled',
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
  /**
   * SAFRA's side of a manual wallet movement made by finance — goodwill credited
   * to a customer, or an erroneous credit clawed back.
   *
   * Its own account rather than a debit against commission, for two reasons. A
   * goodwill gesture is an expense, not negative revenue, so netting it against
   * `safra_commission_customer` would understate what SAFRA actually earned. And
   * discretionary payments are exactly what an auditor asks to see in isolation
   * (§13.3) — a separate account makes "what did we hand out by hand this month?"
   * one query instead of a forensic exercise.
   */
  'wallet_adjustment',
]);

export const ledgerDirection = pgEnum('ledger_direction', ['debit', 'credit']);

export const walletTxnReason = pgEnum('wallet_txn_reason', [
  'sla_compensation',
  'refund',
  'booking_payment',
  'admin_adjustment',
  'gift_card_transfer',
  /**
   * Balance moved from a guest profile onto the account that claimed it, once the
   * email address was verified (§4).
   *
   * Its own reason rather than reusing `admin_adjustment`: nobody adjusted anything,
   * and the customer's statement has to explain why a balance appeared without an
   * accompanying booking or compensation event.
   */
  'profile_claim',
]);

/**
 * What a one-time auth token is for.
 *
 * Purpose is part of the row rather than implied by which table it lives in, so a
 * password-reset token can never be redeemed as an email verification or the other
 * way round — the redeeming code states what it expects and the lookup filters on it.
 */
export const authTokenPurpose = pgEnum('auth_token_purpose', [
  'password_reset',
  'email_verification',
  /**
   * A staff invitation. Separate from `password_reset` on purpose: an invitation is
   * the only token that turns an account with no password into a usable one, so it
   * must not be redeemable through the reset endpoint — and a reset token must not be
   * usable to activate an invitation that was never accepted.
   */
  'staff_invitation',
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

/**
 * A guest review's visibility (§7.3, P-006).
 *
 * There is no `deleted`. P-006 is explicit — *"لا يمكن حذف تقييم"* — so a review that should not
 * be shown becomes `hidden`, which is a moderation decision with an actor and a reason, and the
 * row survives. That is the whole difference between moderation and deletion, and it is the
 * difference the rule is about.
 *
 * `published` is the DEFAULT: a guest who writes a review expects it to appear, and holding every
 * review for approval would make the partner's ability to report one meaningless.
 */
export const reviewStatus = pgEnum('review_status', ['published', 'hidden']);

/**
 * Where a partner's report about a review has got to.
 *
 * `none` is the ordinary state. The pair `open`/`upheld`/`dismissed` is deliberately NOT a
 * separate table: a review carries at most one live report, and a second table would invite two
 * open reports disagreeing about the same review.
 */
export const reviewReportStatus = pgEnum('review_report_status', [
  'none',
  'open',
  'upheld',
  'dismissed',
]);

/**
 * How a scheduled job's run ended.
 *
 * `skipped` is a real outcome and not a failure: on a horizontally scaled API every replica fires
 * the same cron, and the ones that do not win the advisory lock skip. Recording it separately is
 * what stops "most runs skipped" reading as "most runs broken".
 */
export const jobRunStatus = pgEnum('job_run_status', [
  'running',
  'completed',
  'skipped',
  'failed',
]);
