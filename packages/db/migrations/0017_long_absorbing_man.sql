CREATE TYPE "public"."partner_contract_kind" AS ENUM('base', 'commission_annex', 'renewal');--> statement-breakpoint
CREATE TYPE "public"."partner_contract_status" AS ENUM('awaiting_partner_signature', 'active', 'superseded', 'terminated');--> statement-breakpoint
CREATE TYPE "public"."dispute_kind" AS ENUM('property_unavailable', 'not_as_described', 'partner_no_response', 'complaint');--> statement-breakpoint
CREATE TYPE "public"."message_sender" AS ENUM('customer', 'partner', 'staff', 'system');--> statement-breakpoint
CREATE TYPE "public"."ad_billing_period" AS ENUM('weekly', 'monthly', 'quarterly');--> statement-breakpoint
CREATE TYPE "public"."advertiser_kind" AS ENUM('restaurant', 'activity', 'shop', 'transport', 'other');--> statement-breakpoint
CREATE TABLE "partner_contracts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" "partner_contract_kind" NOT NULL,
	"status" "partner_contract_status" DEFAULT 'awaiting_partner_signature' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"content_type" text DEFAULT 'application/pdf' NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid NOT NULL,
	"signed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"superseded_by_contract_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "dispute_evidence" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"dispute_id" uuid NOT NULL,
	"kind" text DEFAULT 'photo' NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"uploaded_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disputes" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'DSP-' || lpad(nextval('dispute_reference_seq')::text, 6, '0') NOT NULL,
	"booking_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"kind" "dispute_kind" NOT NULL,
	"status" "dispute_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"compensation_amount" numeric(14, 2),
	"compensation_currency_id" uuid,
	"opened_by_user_id" uuid,
	"assigned_to_user_id" uuid,
	"resolution" text,
	"closed_by_user_id" uuid,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "disputes_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'CNV-' || lpad(nextval('conversation_reference_seq')::text, 6, '0') NOT NULL,
	"booking_id" uuid,
	"dispute_id" uuid,
	"partner_id" uuid,
	"customer_profile_id" uuid,
	"last_message_at" timestamp with time zone,
	"unread_for_staff" integer DEFAULT 0 NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "conversations_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"sender_kind" "message_sender" NOT NULL,
	"sender_user_id" uuid,
	"body" text NOT NULL,
	"redacted_count" integer DEFAULT 0 NOT NULL,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel" "notification_channel" NOT NULL,
	"template_key" text NOT NULL,
	"locale" text NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"booking_id" uuid,
	"dispute_id" uuid,
	"customer_profile_id" uuid,
	"partner_id" uuid,
	"provider_ref" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"failure_reason" text,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ad_campaigns" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'ADS-' || lpad(nextval('ad_reference_seq')::text, 6, '0') NOT NULL,
	"advertiser_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"status" "ad_status" DEFAULT 'draft' NOT NULL,
	"billing_period" "ad_billing_period" DEFAULT 'monthly' NOT NULL,
	"price_amount" numeric(14, 2),
	"price_currency_id" uuid,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"impressions" bigint DEFAULT 0 NOT NULL,
	"clicks" bigint DEFAULT 0 NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "ad_campaigns_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "advertisers" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'ADV-' || lpad(nextval('advertiser_reference_seq')::text, 6, '0') NOT NULL,
	"name" text NOT NULL,
	"kind" "advertiser_kind" NOT NULL,
	"city_id" uuid NOT NULL,
	"contact_email" text,
	"contact_phone" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "advertisers_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "partner_contracts" ADD CONSTRAINT "partner_contracts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_contracts" ADD CONSTRAINT "partner_contracts_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dispute_evidence" ADD CONSTRAINT "dispute_evidence_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_compensation_currency_id_currencies_id_fk" FOREIGN KEY ("compensation_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_opened_by_user_id_users_id_fk" FOREIGN KEY ("opened_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_assigned_to_user_id_users_id_fk" FOREIGN KEY ("assigned_to_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disputes" ADD CONSTRAINT "disputes_closed_by_user_id_users_id_fk" FOREIGN KEY ("closed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_dispute_id_disputes_id_fk" FOREIGN KEY ("dispute_id") REFERENCES "public"."disputes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_advertiser_id_advertisers_id_fk" FOREIGN KEY ("advertiser_id") REFERENCES "public"."advertisers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_price_currency_id_currencies_id_fk" FOREIGN KEY ("price_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_campaigns" ADD CONSTRAINT "ad_campaigns_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "advertisers" ADD CONSTRAINT "advertisers_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_contracts_partner_idx" ON "partner_contracts" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_contracts_expiry_idx" ON "partner_contracts" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "dispute_evidence_dispute_idx" ON "dispute_evidence" USING btree ("dispute_id","created_at");--> statement-breakpoint
CREATE INDEX "disputes_status_idx" ON "disputes" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "disputes_booking_idx" ON "disputes" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "disputes_partner_idx" ON "disputes" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "disputes_customer_idx" ON "disputes" USING btree ("customer_profile_id");--> statement-breakpoint
CREATE INDEX "conversations_recent_idx" ON "conversations" USING btree ("last_message_at");--> statement-breakpoint
CREATE INDEX "conversations_booking_idx" ON "conversations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "conversations_dispute_idx" ON "conversations" USING btree ("dispute_id");--> statement-breakpoint
CREATE INDEX "conversations_partner_idx" ON "conversations" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "conversations_unread_idx" ON "conversations" USING btree ("unread_for_staff");--> statement-breakpoint
CREATE INDEX "messages_conversation_idx" ON "messages" USING btree ("conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "notifications_recent_idx" ON "notifications" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "notifications_status_idx" ON "notifications" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_booking_idx" ON "notifications" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "notifications_template_idx" ON "notifications" USING btree ("template_key","channel");--> statement-breakpoint
CREATE INDEX "ad_campaigns_status_idx" ON "ad_campaigns" USING btree ("status","ends_at");--> statement-breakpoint
CREATE INDEX "ad_campaigns_city_idx" ON "ad_campaigns" USING btree ("city_id","status");--> statement-breakpoint
CREATE INDEX "ad_campaigns_advertiser_idx" ON "ad_campaigns" USING btree ("advertiser_id");--> statement-breakpoint
CREATE INDEX "advertisers_city_idx" ON "advertisers" USING btree ("city_id");