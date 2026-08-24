CREATE TYPE "public"."violation_stage" AS ENUM('recorded', 'warned', 'fined', 'suspension');--> statement-breakpoint
ALTER TABLE "partner_violations" ADD COLUMN "stage" "violation_stage" DEFAULT 'recorded' NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD COLUMN "warned_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD COLUMN "warning_note" text;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD COLUMN "waiver_ledger_group_id" uuid;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "suspended_notes" text;--> statement-breakpoint
ALTER TABLE "partners" ADD COLUMN "suspended_by_user_id" uuid;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_suspended_by_user_id_users_id_fk" FOREIGN KEY ("suspended_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Existing violations carrying a fine ARE fined, and the stage must say so.
--
-- Unlike migration 0043's `opened_by_user_id`, this backfill is not an invention: `fine_amount IS
-- NOT NULL` is the fact, and `stage` is a new way of writing a fact the row already states. Leaving
-- them all at 'recorded' would make the console's escalation view claim that no partner has ever
-- been fined, while the money column beside it says otherwise — a count disagreeing with its own
-- list, which is the failure the pagination rules exist to prevent, in a different column.
--
-- Nothing becomes 'warned': being warned means somebody TOLD the partner, and no row records that
-- having happened. Inferring a warning from a fine would put words in a conversation that was never
-- had, and an appeal turns on exactly that question.
UPDATE "partner_violations" SET "stage" = 'fined' WHERE "fine_amount" IS NOT NULL;
