-- A bank-transfer refund returns to the account the money came from (2026-10-02).
-- The sender's account on the payment, the destination and bank reference on the refund; the rule
-- that ties them is in post/0027_bank_transfer_refund.sql.
ALTER TABLE "payments" ADD COLUMN "payer_account_encrypted" text;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "payer_account_last4" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_account_encrypted" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "destination_account_last4" text;--> statement-breakpoint
ALTER TABLE "refunds" ADD COLUMN "transfer_reference" text;
