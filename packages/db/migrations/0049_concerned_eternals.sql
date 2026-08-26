-- SAFRA — money columns hold the currency's decimals, and compensation gets an account.
--
-- ── Every money column to numeric(15, 3) ────────────────────────────────────
--
-- They were numeric(14, 2). `currencies.decimals` has always said JOD has THREE,
-- and the column could not hold the third: 10.125 JOD became 10.13 on the way in,
-- silently, at every step of a booking. Nothing has lost money — checked before
-- writing this, every booking, unit and payment on 2026-08-26 is USD or SYP.
--
-- Three rather than four: it covers every currency SAFRA lists and the whole ISO
-- three-decimal set (JOD, KWD, BHD, OMR, TND). Precision 15 rather than 14 so the
-- integer side keeps its twelve digits — 14,3 would have cost an order of
-- magnitude on a platform that settles in SYP.
--
-- Postgres renders numeric(15,3) with three decimals always, so a USD amount now
-- reads `109.000` on the wire. Same value, and uniform. What a PERSON sees comes
-- from the currency: `amount(value, currency)` writes `$109.00` and `10.125 JOD`.
--
-- ── `wallet_compensation` ───────────────────────────────────────────────────
--
-- SAFRA's side of money paid to a customer for a failure of its own. Its own
-- account rather than `wallet_adjustment`, which is a finance CORRECTION: both are
-- SAFRA's money leaving, and «what did compensation cost us» is a question the
-- ledger should answer without grepping descriptions. Enum values cannot be
-- removed in PostgreSQL, so this is one-way.
--
-- ── Operationally ───────────────────────────────────────────────────────────
--
-- ALTER TYPE on numeric REWRITES the table under an ACCESS EXCLUSIVE lock.
-- Milliseconds on this data, and it will not be at 1M users — `bookings` and
-- `ledger_entries` are the two that grow without bound. Maintenance window.

ALTER TYPE "public"."ledger_account" ADD VALUE 'wallet_compensation';--> statement-breakpoint
ALTER TABLE "partner_payout_items" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "gross_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "gross_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "fine_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "fine_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "net_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "partner_payouts" ALTER COLUMN "net_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "partner_violations" ALTER COLUMN "fine_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "partner_violations" ALTER COLUMN "customer_compensation_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "availability_days" ALTER COLUMN "price" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "units" ALTER COLUMN "base_price" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "base_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "customer_fee_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "partner_commission_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "discount_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "discount_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "gift_card_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "gift_card_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "wallet_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "wallet_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "total_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "bookings" ALTER COLUMN "partner_payable_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "ledger_entries" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "provider_fee_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "wallet_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "refunds" ALTER COLUMN "wallet_amount" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ALTER COLUMN "discount_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "value" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "max_discount_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "coupons" ALTER COLUMN "min_booking_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ALTER COLUMN "balance_after" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "gift_cards" ALTER COLUMN "original_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "gift_cards" ALTER COLUMN "remaining_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "wallet_transactions" ALTER COLUMN "amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "wallet_transactions" ALTER COLUMN "balance_after" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "balance" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "wallets" ALTER COLUMN "balance" SET DEFAULT '0';--> statement-breakpoint
ALTER TABLE "disputes" ALTER COLUMN "compensation_amount" SET DATA TYPE numeric(15, 3);--> statement-breakpoint
ALTER TABLE "ad_campaigns" ALTER COLUMN "price_amount" SET DATA TYPE numeric(15, 3);