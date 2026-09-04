CREATE TYPE "public"."payout_account_status" AS ENUM('pending', 'verified', 'rejected');--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "status" "payout_account_status" DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "submitted_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "verified_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "rejected_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD COLUMN "rejection_reason" text;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_payout_accounts_partner_status_idx" ON "partner_payout_accounts" USING btree ("partner_id","status");