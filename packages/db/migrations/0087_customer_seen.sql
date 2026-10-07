-- What the customer has already seen, so الدعم and النزاعات can badge like notifications (Bashar,
-- 2026-10-07). See the notes on `conversations.customer_seen_at` and `disputes.customer_seen_status`.
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "customer_seen_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "disputes" ADD COLUMN IF NOT EXISTS "customer_seen_status" "dispute_status";--> statement-breakpoint
-- The badges count from today. Without this every reply ever written and every dispute ever decided
-- would arrive as news on the first page load after the deploy, which is a flood, not a notification.
UPDATE "conversations" SET "customer_seen_at" = now() WHERE "customer_seen_at" IS NULL;--> statement-breakpoint
UPDATE "disputes" SET "customer_seen_status" = "status" WHERE "customer_seen_status" IS NULL;
