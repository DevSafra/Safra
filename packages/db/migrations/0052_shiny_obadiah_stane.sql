-- SAFRA — the advertising domain gets a creative, an invoice and its own two accounts.
--
-- ── The creative ────────────────────────────────────────────────────────────
--
-- `ad_campaigns` had a price, a window and counters but nothing to SHOW: no
-- headline, no target, no image. A campaign could be created and could never be
-- delivered. Three headline columns, exactly as `properties` stores a name,
-- because the customer app serves ar/en/de and one stored string for three
-- readers is the failure `content.ts` documents.
--
-- Safe as NOT NULL with no default: zero campaigns exist. Verified before
-- writing this, not assumed.
--
-- ── The invoice ─────────────────────────────────────────────────────────────
--
-- `payments.booking_id` is NOT NULL, so that table cannot record money that is
-- not for a stay — the same wall gift-card purchases met. An ad is billed per
-- PERIOD, so an invoice is the shape it actually has.
--
-- ── The accounts ────────────────────────────────────────────────────────────
--
-- `ad_payment` ↔ `ad_revenue`, posted when an invoice is PAID rather than when
-- it is issued: a due invoice is a claim, not revenue. Kept out of
-- `customer_payment` because الدفع's «حُصّل اليوم» filters on that account, and
-- folding ad money in would overstate booking revenue with money that has
-- nothing to do with a stay. Enum values are one-way in PostgreSQL.

CREATE TYPE "public"."ad_invoice_status" AS ENUM('due', 'paid', 'void');--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'ad_payment';--> statement-breakpoint
ALTER TYPE "public"."ledger_account" ADD VALUE 'ad_revenue';--> statement-breakpoint
CREATE TABLE "ad_invoices" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'ADI-' || reference_number(nextval('ad_invoice_reference_seq')) NOT NULL,
	"campaign_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"amount" numeric(15, 3) NOT NULL,
	"currency_id" uuid NOT NULL,
	"status" "ad_invoice_status" DEFAULT 'due' NOT NULL,
	"paid_at" timestamp with time zone,
	"paid_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ad_invoices_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "headline_ar" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "headline_en" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "headline_de" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "target_url" text NOT NULL;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD COLUMN "image_path" text;--> statement-breakpoint
ALTER TABLE "ad_invoices" ADD CONSTRAINT "ad_invoices_campaign_id_ad_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."ad_campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_invoices" ADD CONSTRAINT "ad_invoices_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_invoices" ADD CONSTRAINT "ad_invoices_paid_by_user_id_users_id_fk" FOREIGN KEY ("paid_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ad_invoices_period_unique" ON "ad_invoices" USING btree ("campaign_id","period_start");--> statement-breakpoint
CREATE INDEX "ad_invoices_status_idx" ON "ad_invoices" USING btree ("status","period_start");