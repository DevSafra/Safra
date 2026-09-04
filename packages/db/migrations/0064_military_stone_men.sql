ALTER TYPE "public"."ledger_account" ADD VALUE 'safra_payout' BEFORE 'refund';--> statement-breakpoint
CREATE TABLE "safra_payout_accounts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"label" text NOT NULL,
	"method" text NOT NULL,
	"account_holder" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"account_number_last4" text NOT NULL,
	"bank_name" text,
	"swift_code" text,
	"currency_id" uuid NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"status" "payout_account_status" DEFAULT 'pending' NOT NULL,
	"created_by_user_id" uuid,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"rejected_at" timestamp with time zone,
	"rejected_by_user_id" uuid,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "safra_payouts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'SPY-' || reference_number(nextval('payout_reference_seq')) NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"commission_partner_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"commission_customer_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"ad_revenue_amount" numeric(18, 2) DEFAULT '0' NOT NULL,
	"net_amount" numeric(18, 2) NOT NULL,
	"status" "payout_status" DEFAULT 'pending_release' NOT NULL,
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
	CONSTRAINT "safra_payouts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "safra_payout_accounts" ADD CONSTRAINT "safra_payout_accounts_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safra_payout_accounts" ADD CONSTRAINT "safra_payout_accounts_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safra_payout_accounts" ADD CONSTRAINT "safra_payout_accounts_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safra_payout_accounts" ADD CONSTRAINT "safra_payout_accounts_rejected_by_user_id_users_id_fk" FOREIGN KEY ("rejected_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safra_payouts" ADD CONSTRAINT "safra_payouts_payout_account_id_safra_payout_accounts_id_fk" FOREIGN KEY ("payout_account_id") REFERENCES "public"."safra_payout_accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safra_payouts" ADD CONSTRAINT "safra_payouts_released_by_user_id_users_id_fk" FOREIGN KEY ("released_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "safra_payouts" ADD CONSTRAINT "safra_payouts_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "safra_payout_accounts_default_idx" ON "safra_payout_accounts" USING btree ("is_default") WHERE is_default AND deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "safra_payouts_period_idx" ON "safra_payouts" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "safra_payouts_status_idx" ON "safra_payouts" USING btree ("status");