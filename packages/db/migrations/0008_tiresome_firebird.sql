ALTER TYPE "public"."ledger_account" ADD VALUE 'payment_provider_fee';--> statement-breakpoint
ALTER TYPE "public"."payment_method" ADD VALUE 'bank_transfer';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'requires_action' BEFORE 'authorized';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'expired' BEFORE 'refunded';--> statement-breakpoint
CREATE TABLE "payment_provider_events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payment_id" uuid,
	"payload" jsonb NOT NULL,
	"signature_verified" boolean NOT NULL,
	"processed_at" timestamp with time zone,
	"processing_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "access_token_hash" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "access_token_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "provider_fee_amount" numeric(14, 2);--> statement-breakpoint
ALTER TABLE "payment_provider_events" ADD CONSTRAINT "payment_provider_events_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "payment_provider_events_dedupe" ON "payment_provider_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "payment_provider_events_payment_idx" ON "payment_provider_events" USING btree ("payment_id","created_at");--> statement-breakpoint
CREATE INDEX "payment_provider_events_unprocessed_idx" ON "payment_provider_events" USING btree ("created_at") WHERE processed_at IS NULL;--> statement-breakpoint
CREATE INDEX "payments_expiry_idx" ON "payments" USING btree ("expires_at") WHERE status IN ('initiated','requires_action') AND expires_at IS NOT NULL;