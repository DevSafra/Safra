CREATE TYPE "public"."payout_status" AS ENUM('accruing', 'pending_release', 'on_hold', 'scheduled', 'paid', 'cancelled');--> statement-breakpoint
CREATE TABLE "partner_payout_items" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"payout_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "partner_payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'PYT-' || lpad(nextval('payout_reference_seq')::text, 6, '0') NOT NULL,
	"partner_id" uuid NOT NULL,
	"currency_id" uuid NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"gross_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"fine_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"status" "payout_status" DEFAULT 'accruing' NOT NULL,
	"payout_account_id" uuid,
	"scheduled_for" date,
	"released_at" timestamp with time zone,
	"released_by_user_id" uuid,
	"paid_at" timestamp with time zone,
	"paid_by_user_id" uuid,
	"paid_reference" text,
	"hold_reason" text,
	"entry_group_id" uuid,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "partner_payouts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "partner_payout_items" ADD CONSTRAINT "partner_payout_items_payout_id_partner_payouts_id_fk" FOREIGN KEY ("payout_id") REFERENCES "public"."partner_payouts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_items" ADD CONSTRAINT "partner_payout_items_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_payout_account_id_partner_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."partner_payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payouts" ADD CONSTRAINT "partner_payouts_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payout_items_booking_unique" ON "partner_payout_items" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "partner_payout_items_payout_idx" ON "partner_payout_items" USING btree ("payout_id");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_payouts_one_accruing" ON "partner_payouts" USING btree ("partner_id","currency_id") WHERE status = 'accruing' AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "partner_payouts_partner_idx" ON "partner_payouts" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_payouts_status_idx" ON "partner_payouts" USING btree ("status","scheduled_for");