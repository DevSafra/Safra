CREATE TYPE "public"."ad_status" AS ENUM('draft', 'active', 'paused', 'expired');--> statement-breakpoint
CREATE TYPE "public"."booking_status" AS ENUM('draft', 'pending_payment', 'pending_confirmation', 'confirmed', 'cancelled', 'checked_in', 'completed', 'disputed');--> statement-breakpoint
CREATE TYPE "public"."city_category" AS ENUM('coastal', 'mountain', 'desert', 'historic');--> statement-breakpoint
CREATE TYPE "public"."coupon_type" AS ENUM('first_booking', 'seasonal', 'city', 'partner', 'campaign');--> statement-breakpoint
CREATE TYPE "public"."coupon_value_kind" AS ENUM('percent', 'fixed');--> statement-breakpoint
CREATE TYPE "public"."day_status" AS ENUM('available', 'booked', 'closed', 'maintenance');--> statement-breakpoint
CREATE TYPE "public"."dispute_status" AS ENUM('open', 'investigating', 'resolved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."gift_card_status" AS ENUM('active', 'used', 'expired', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ledger_account" AS ENUM('customer_payment', 'safra_commission_customer', 'safra_commission_partner', 'partner_payable', 'partner_payout', 'refund', 'wallet_credit', 'wallet_debit', 'gift_card_redemption', 'partner_fine');--> statement-breakpoint
CREATE TYPE "public"."ledger_direction" AS ENUM('debit', 'credit');--> statement-breakpoint
CREATE TYPE "public"."notification_channel" AS ENUM('whatsapp', 'email', 'in_app');--> statement-breakpoint
CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'delivered', 'failed');--> statement-breakpoint
CREATE TYPE "public"."partner_tier" AS ENUM('new', 'needs_improvement', 'silver', 'gold');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('visa', 'mastercard', 'sham_cash', 'paypal', 'apple_pay', 'gift_card', 'wallet');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'authorized', 'captured', 'failed', 'refunded', 'partially_refunded');--> statement-breakpoint
CREATE TYPE "public"."property_status" AS ENUM('draft', 'pending_review', 'approved', 'published', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."refund_status" AS ENUM('pending', 'processing', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('customer', 'partner', 'support_agent', 'finance_officer', 'operations_manager', 'super_admin');--> statement-breakpoint
CREATE TYPE "public"."user_status" AS ENUM('active', 'suspended', 'archived');--> statement-breakpoint
CREATE TYPE "public"."verification_status" AS ENUM('pending', 'in_review', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."violation_kind" AS ENUM('no_response', 'rejected_after_payment', 'stale_calendar', 'inaccurate_listing', 'no_show');--> statement-breakpoint
CREATE TYPE "public"."wallet_txn_reason" AS ENUM('sla_compensation', 'refund', 'booking_payment', 'admin_adjustment', 'gift_card_transfer');--> statement-breakpoint
CREATE TABLE "cities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"country_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"description_de" text,
	"timezone" text NOT NULL,
	"same_day_cutoff_hour" smallint,
	"latitude" text,
	"longitude" text,
	"categories" "city_category"[] DEFAULT '{}' NOT NULL,
	"tags_ar" text[] DEFAULT '{}' NOT NULL,
	"tags_en" text[] DEFAULT '{}' NOT NULL,
	"tags_de" text[] DEFAULT '{}' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "countries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" char(2) NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"display_currency_id" uuid NOT NULL,
	"is_launch_market" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "countries_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" char(3) NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"symbol" text NOT NULL,
	"decimals" smallint DEFAULT 2 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "currencies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"base_currency_id" uuid NOT NULL,
	"quote_currency_id" uuid NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"effective_from" timestamp with time zone NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "customer_profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text DEFAULT 'CUS-' || lpad(nextval('customer_reference_seq')::text, 6, '0') NOT NULL,
	"user_id" uuid,
	"full_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"preferred_locale" text DEFAULT 'ar' NOT NULL,
	"preferred_currency_id" uuid,
	"is_guest" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "customer_profiles_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"family_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"replaced_by_token_hash" text,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "refresh_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"password_hash" text,
	"role" "user_role" NOT NULL,
	"status" "user_status" DEFAULT 'active' NOT NULL,
	"preferred_locale" text DEFAULT 'ar' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone_verified_at" timestamp with time zone,
	"totp_secret_encrypted" text,
	"totp_enabled_at" timestamp with time zone,
	"permission_overrides" jsonb,
	"failed_login_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_documents" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"status" "verification_status" DEFAULT 'pending' NOT NULL,
	"reviewed_by_user_id" uuid,
	"reviewed_at" timestamp with time zone,
	"review_notes" text,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_payout_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid NOT NULL,
	"method" text NOT NULL,
	"account_holder" text NOT NULL,
	"account_number_encrypted" text NOT NULL,
	"account_number_last4" text NOT NULL,
	"bank_name" text,
	"swift_code" text,
	"currency_id" uuid NOT NULL,
	"is_primary" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partner_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"capabilities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "partner_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "partner_violations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"partner_id" uuid NOT NULL,
	"booking_id" uuid,
	"kind" "violation_kind" NOT NULL,
	"occurrence_number" integer DEFAULT 1 NOT NULL,
	"fine_amount" numeric(14, 2),
	"fine_currency_id" uuid,
	"customer_compensation_amount" numeric(14, 2),
	"score_penalty" integer DEFAULT 0 NOT NULL,
	"collected_at" timestamp with time zone,
	"waived_at" timestamp with time zone,
	"waived_by_user_id" uuid,
	"waived_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text DEFAULT 'PAR-' || lpad(nextval('partner_reference_seq')::text, 6, '0') NOT NULL,
	"user_id" uuid NOT NULL,
	"partner_type_id" uuid NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"city_id" uuid NOT NULL,
	"address" text NOT NULL,
	"latitude" text,
	"longitude" text,
	"phone" text NOT NULL,
	"email" text NOT NULL,
	"verification" "verification_status" DEFAULT 'pending' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"sanctions_screened_at" timestamp with time zone,
	"sanctions_screening_result" jsonb,
	"score" integer DEFAULT 100 NOT NULL,
	"tier" "partner_tier" DEFAULT 'new' NOT NULL,
	"avg_response_minutes" integer,
	"cancellation_count" integer DEFAULT 0 NOT NULL,
	"complaint_count" integer DEFAULT 0 NOT NULL,
	"contract_signed_at" timestamp with time zone,
	"suspended_at" timestamp with time zone,
	"suspended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "partners_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "amenities" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"category" text DEFAULT 'facilities' NOT NULL,
	"is_filterable" boolean DEFAULT true NOT NULL,
	"icon" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "amenities_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "availability_days" (
	"unit_id" uuid NOT NULL,
	"date" date NOT NULL,
	"status" "day_status" DEFAULT 'available' NOT NULL,
	"price" numeric(14, 2),
	"min_nights" smallint,
	"note" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "availability_days_unit_id_date_pk" PRIMARY KEY("unit_id","date")
);
--> statement-breakpoint
CREATE TABLE "cancellation_policies" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"description_ar" text NOT NULL,
	"description_en" text NOT NULL,
	"description_de" text NOT NULL,
	"tiers" jsonb NOT NULL,
	"min_refund_percent" smallint DEFAULT 50 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "cancellation_policies_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text DEFAULT 'PRO-' || lpad(nextval('property_reference_seq')::text, 6, '0') NOT NULL,
	"partner_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"property_type_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"description_de" text,
	"address" text NOT NULL,
	"latitude" text,
	"longitude" text,
	"status" "property_status" DEFAULT 'draft' NOT NULL,
	"verified_at" timestamp with time zone,
	"verified_by_user_id" uuid,
	"cancellation_policy_id" uuid NOT NULL,
	"rating" numeric(2, 1),
	"reviews_count" integer DEFAULT 0 NOT NULL,
	"badges" text[] DEFAULT '{}' NOT NULL,
	"recommendation_score" numeric(6, 3) DEFAULT '0' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "properties_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "property_images" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"file_key" text NOT NULL,
	"alt_ar" text,
	"alt_en" text,
	"alt_de" text,
	"width" integer,
	"height" integer,
	"is_cover" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "property_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"has_multiple_units" boolean DEFAULT false NOT NULL,
	"glyph" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "property_types_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "unit_amenities" (
	"unit_id" uuid NOT NULL,
	"amenity_id" uuid NOT NULL,
	CONSTRAINT "unit_amenities_unit_id_amenity_id_pk" PRIMARY KEY("unit_id","amenity_id")
);
--> statement-breakpoint
CREATE TABLE "units" (
	"id" uuid PRIMARY KEY NOT NULL,
	"property_id" uuid NOT NULL,
	"name_ar" text NOT NULL,
	"name_en" text NOT NULL,
	"name_de" text NOT NULL,
	"max_guests" smallint NOT NULL,
	"bedrooms" smallint DEFAULT 1 NOT NULL,
	"beds" smallint DEFAULT 1 NOT NULL,
	"bathrooms" smallint DEFAULT 1 NOT NULL,
	"base_price" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"min_nights" smallint DEFAULT 1 NOT NULL,
	"max_nights" smallint,
	"room_type_code" text,
	"unit_label" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text DEFAULT 'BKG-' || to_char(now(), 'YYYY') || '-' || lpad(nextval('booking_reference_seq')::text, 6, '0') NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"check_in" date NOT NULL,
	"check_out" date NOT NULL,
	"nights" integer GENERATED ALWAYS AS ((check_out - check_in)) STORED,
	"guests_adults" smallint NOT NULL,
	"guests_children" smallint DEFAULT 0 NOT NULL,
	"guests_infants" smallint DEFAULT 0 NOT NULL,
	"status" "booking_status" DEFAULT 'draft' NOT NULL,
	"base_amount" numeric(14, 2) NOT NULL,
	"customer_fee_rate" numeric(6, 4) NOT NULL,
	"customer_fee_amount" numeric(14, 2) NOT NULL,
	"partner_commission_rate" numeric(6, 4) NOT NULL,
	"partner_commission_amount" numeric(14, 2) NOT NULL,
	"discount_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"gift_card_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"wallet_amount" numeric(14, 2) DEFAULT '0' NOT NULL,
	"total_amount" numeric(14, 2) NOT NULL,
	"partner_payable_amount" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"fx_rate_to_syp" numeric(18, 8) NOT NULL,
	"total_syp" numeric(18, 2) NOT NULL,
	"cancellation_policy_snapshot" jsonb NOT NULL,
	"paid_at" timestamp with time zone,
	"confirmation_deadline_at" timestamp with time zone,
	"partner_responded_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"confirmed_by_user_id" uuid,
	"cancelled_at" timestamp with time zone,
	"cancelled_by_user_id" uuid,
	"cancellation_reason" text,
	"checked_in_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"search_attributes" text[] DEFAULT '{}' NOT NULL,
	"internal_notes" text,
	"created_ip" text,
	"created_user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "bookings_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "timeline_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"event_type" text NOT NULL,
	"actor_type" text DEFAULT 'system' NOT NULL,
	"actor_user_id" uuid,
	"payload" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"key" text PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"response_body" jsonb,
	"response_status" numeric(3, 0),
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"entry_group_id" uuid NOT NULL,
	"account" "ledger_account" NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"fx_rate_to_syp" numeric(18, 8) NOT NULL,
	"amount_syp" numeric(18, 2) NOT NULL,
	"booking_id" uuid,
	"payment_id" uuid,
	"refund_id" uuid,
	"partner_id" uuid,
	"customer_profile_id" uuid,
	"description" text NOT NULL,
	"reverses_entry_id" uuid,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text DEFAULT 'PAY-' || lpad(nextval('payment_reference_seq')::text, 6, '0') NOT NULL,
	"booking_id" uuid NOT NULL,
	"method" "payment_method" NOT NULL,
	"provider" text NOT NULL,
	"provider_ref" text,
	"amount" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"authorized_at" timestamp with time zone,
	"captured_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"failure_reason" text,
	"provider_events" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "payments_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
CREATE TABLE "refunds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"payment_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"applied_refund_percent" numeric(5, 2),
	"reason" text NOT NULL,
	"status" "refund_status" DEFAULT 'pending' NOT NULL,
	"provider_ref" text,
	"initiated_by_user_id" uuid,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "coupon_redemptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"coupon_id" uuid NOT NULL,
	"booking_id" uuid NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"discount_amount" numeric(14, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "coupons" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"type" "coupon_type" NOT NULL,
	"value_kind" "coupon_value_kind" NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"currency_id" uuid,
	"max_discount_amount" numeric(14, 2),
	"min_booking_amount" numeric(14, 2),
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"max_redemptions" integer,
	"max_redemptions_per_customer" smallint DEFAULT 1 NOT NULL,
	"redemptions_count" integer DEFAULT 0 NOT NULL,
	"city_id" uuid,
	"partner_id" uuid,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "gift_card_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"gift_card_id" uuid NOT NULL,
	"booking_id" uuid,
	"amount" numeric(14, 2) NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"created_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gift_cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"reference" text DEFAULT 'GIF-' || lpad(nextval('gift_card_reference_seq')::text, 6, '0') NOT NULL,
	"code_hash" text NOT NULL,
	"code_last4" text NOT NULL,
	"original_amount" numeric(14, 2) NOT NULL,
	"remaining_amount" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"status" "gift_card_status" DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone,
	"purchased_by_customer_id" uuid,
	"recipient_email" text,
	"recipient_name" text,
	"issued_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "gift_cards_reference_unique" UNIQUE("reference"),
	CONSTRAINT "gift_cards_code_hash_unique" UNIQUE("code_hash")
);
--> statement-breakpoint
CREATE TABLE "wallet_transactions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"wallet_id" uuid NOT NULL,
	"direction" "ledger_direction" NOT NULL,
	"reason" "wallet_txn_reason" NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency_id" uuid NOT NULL,
	"balance_after" numeric(14, 2) NOT NULL,
	"booking_id" uuid,
	"created_by_user_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wallets" (
	"id" uuid PRIMARY KEY NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"balance" numeric(14, 2) DEFAULT '0' NOT NULL,
	"currency_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY NOT NULL,
	"actor_user_id" uuid,
	"actor_role" "user_role",
	"action" text NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid,
	"before" jsonb,
	"after" jsonb,
	"ip_address" text,
	"user_agent" text,
	"request_id" text,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emergency_modes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"scope" text NOT NULL,
	"scope_id" uuid,
	"flags" jsonb NOT NULL,
	"message_ar" text,
	"message_en" text,
	"message_de" text,
	"activated_by_user_id" uuid NOT NULL,
	"activated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deactivated_at" timestamp with time zone,
	"deactivated_by_user_id" uuid,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"scope" text DEFAULT 'global' NOT NULL,
	"scope_id" uuid,
	"value" jsonb NOT NULL,
	"value_schema" text NOT NULL,
	"description_ar" text,
	"description_en" text,
	"required_permission" text DEFAULT 'settings.update' NOT NULL,
	"updated_by_user_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings_history" (
	"id" uuid PRIMARY KEY NOT NULL,
	"setting_id" uuid NOT NULL,
	"key" text NOT NULL,
	"previous_value" jsonb,
	"new_value" jsonb NOT NULL,
	"changed_by_user_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cities" ADD CONSTRAINT "cities_country_id_countries_id_fk" FOREIGN KEY ("country_id") REFERENCES "public"."countries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "countries" ADD CONSTRAINT "countries_display_currency_id_currencies_id_fk" FOREIGN KEY ("display_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_base_currency_id_currencies_id_fk" FOREIGN KEY ("base_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fx_rates" ADD CONSTRAINT "fx_rates_quote_currency_id_currencies_id_fk" FOREIGN KEY ("quote_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "customer_profiles" ADD CONSTRAINT "customer_profiles_preferred_currency_id_currencies_id_fk" FOREIGN KEY ("preferred_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_documents" ADD CONSTRAINT "partner_documents_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_payout_accounts" ADD CONSTRAINT "partner_payout_accounts_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD CONSTRAINT "partner_violations_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD CONSTRAINT "partner_violations_fine_currency_id_currencies_id_fk" FOREIGN KEY ("fine_currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_violations" ADD CONSTRAINT "partner_violations_waived_by_user_id_users_id_fk" FOREIGN KEY ("waived_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_partner_type_id_partner_types_id_fk" FOREIGN KEY ("partner_type_id") REFERENCES "public"."partner_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partners" ADD CONSTRAINT "partners_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "availability_days" ADD CONSTRAINT "availability_days_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_property_type_id_property_types_id_fk" FOREIGN KEY ("property_type_id") REFERENCES "public"."property_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_verified_by_user_id_users_id_fk" FOREIGN KEY ("verified_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_cancellation_policy_id_cancellation_policies_id_fk" FOREIGN KEY ("cancellation_policy_id") REFERENCES "public"."cancellation_policies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_images" ADD CONSTRAINT "property_images_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_amenities" ADD CONSTRAINT "unit_amenities_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unit_amenities" ADD CONSTRAINT "unit_amenities_amenity_id_amenities_id_fk" FOREIGN KEY ("amenity_id") REFERENCES "public"."amenities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "units" ADD CONSTRAINT "units_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_confirmed_by_user_id_users_id_fk" FOREIGN KEY ("confirmed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_user_id_users_id_fk" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "timeline_events" ADD CONSTRAINT "timeline_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_refund_id_refunds_id_fk" FOREIGN KEY ("refund_id") REFERENCES "public"."refunds"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_payment_id_payments_id_fk" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refunds" ADD CONSTRAINT "refunds_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_coupon_id_coupons_id_fk" FOREIGN KEY ("coupon_id") REFERENCES "public"."coupons"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_gift_card_id_gift_cards_id_fk" FOREIGN KEY ("gift_card_id") REFERENCES "public"."gift_cards"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_card_transactions" ADD CONSTRAINT "gift_card_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_purchased_by_customer_id_customer_profiles_id_fk" FOREIGN KEY ("purchased_by_customer_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gift_cards" ADD CONSTRAINT "gift_cards_issued_by_user_id_users_id_fk" FOREIGN KEY ("issued_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_wallet_id_wallets_id_fk" FOREIGN KEY ("wallet_id") REFERENCES "public"."wallets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wallets" ADD CONSTRAINT "wallets_currency_id_currencies_id_fk" FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_modes" ADD CONSTRAINT "emergency_modes_activated_by_user_id_users_id_fk" FOREIGN KEY ("activated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "emergency_modes" ADD CONSTRAINT "emergency_modes_deactivated_by_user_id_users_id_fk" FOREIGN KEY ("deactivated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_updated_by_user_id_users_id_fk" FOREIGN KEY ("updated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_setting_id_settings_id_fk" FOREIGN KEY ("setting_id") REFERENCES "public"."settings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settings_history" ADD CONSTRAINT "settings_history_changed_by_user_id_users_id_fk" FOREIGN KEY ("changed_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "cities_country_slug_unique" ON "cities" USING btree ("country_id","slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "cities_country_active_idx" ON "cities" USING btree ("country_id","is_active");--> statement-breakpoint
CREATE INDEX "cities_categories_idx" ON "cities" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "fx_rates_lookup_idx" ON "fx_rates" USING btree ("base_currency_id","quote_currency_id","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "customer_profiles_user_unique" ON "customer_profiles" USING btree ("user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "customer_profiles_email_idx" ON "customer_profiles" USING btree ("email");--> statement-breakpoint
CREATE INDEX "customer_profiles_phone_idx" ON "customer_profiles" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "refresh_tokens_user_idx" ON "refresh_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "refresh_tokens_family_idx" ON "refresh_tokens" USING btree ("family_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unique" ON "users" USING btree ("email") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "users_role_status_idx" ON "users" USING btree ("role","status");--> statement-breakpoint
CREATE INDEX "partner_documents_partner_status_idx" ON "partner_documents" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "partner_payout_accounts_partner_idx" ON "partner_payout_accounts" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "partner_violations_partner_idx" ON "partner_violations" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "partner_violations_booking_idx" ON "partner_violations" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "partners_city_idx" ON "partners" USING btree ("city_id");--> statement-breakpoint
CREATE INDEX "partners_verification_idx" ON "partners" USING btree ("verification");--> statement-breakpoint
CREATE INDEX "partners_score_idx" ON "partners" USING btree ("score");--> statement-breakpoint
CREATE UNIQUE INDEX "partners_user_unique" ON "partners" USING btree ("user_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "availability_days_date_idx" ON "availability_days" USING btree ("date","status");--> statement-breakpoint
CREATE UNIQUE INDEX "properties_slug_unique" ON "properties" USING btree ("slug") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "properties_search_idx" ON "properties" USING btree ("city_id","status","recommendation_score");--> statement-breakpoint
CREATE INDEX "properties_partner_idx" ON "properties" USING btree ("partner_id");--> statement-breakpoint
CREATE INDEX "properties_type_idx" ON "properties" USING btree ("property_type_id");--> statement-breakpoint
CREATE INDEX "property_images_property_idx" ON "property_images" USING btree ("property_id","sort_order");--> statement-breakpoint
CREATE INDEX "unit_amenities_amenity_idx" ON "unit_amenities" USING btree ("amenity_id");--> statement-breakpoint
CREATE INDEX "units_property_idx" ON "units" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "units_room_type_idx" ON "units" USING btree ("property_id","room_type_code");--> statement-breakpoint
CREATE INDEX "bookings_sla_idx" ON "bookings" USING btree ("status","confirmation_deadline_at") WHERE status = 'pending_confirmation';--> statement-breakpoint
CREATE INDEX "bookings_partner_status_idx" ON "bookings" USING btree ("partner_id","status");--> statement-breakpoint
CREATE INDEX "bookings_customer_idx" ON "bookings" USING btree ("customer_profile_id","created_at");--> statement-breakpoint
CREATE INDEX "bookings_city_dates_idx" ON "bookings" USING btree ("city_id","check_in");--> statement-breakpoint
CREATE INDEX "bookings_unit_dates_idx" ON "bookings" USING btree ("unit_id","check_in","check_out");--> statement-breakpoint
CREATE INDEX "bookings_created_idx" ON "bookings" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "timeline_events_subject_idx" ON "timeline_events" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "timeline_events_type_idx" ON "timeline_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "idempotency_keys_expiry_idx" ON "idempotency_keys" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_group_idx" ON "ledger_entries" USING btree ("entry_group_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_booking_idx" ON "ledger_entries" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_partner_idx" ON "ledger_entries" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "ledger_entries_account_date_idx" ON "ledger_entries" USING btree ("account","created_at");--> statement-breakpoint
CREATE INDEX "payments_booking_idx" ON "payments" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_ref_unique" ON "payments" USING btree ("provider","provider_ref") WHERE provider_ref IS NOT NULL;--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "refunds_booking_idx" ON "refunds" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "refunds_status_idx" ON "refunds" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "coupon_redemptions_booking_unique" ON "coupon_redemptions" USING btree ("coupon_id","booking_id");--> statement-breakpoint
CREATE INDEX "coupon_redemptions_customer_idx" ON "coupon_redemptions" USING btree ("coupon_id","customer_profile_id");--> statement-breakpoint
CREATE UNIQUE INDEX "coupons_code_unique" ON "coupons" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "coupons_window_idx" ON "coupons" USING btree ("starts_at","ends_at");--> statement-breakpoint
CREATE INDEX "gift_card_transactions_card_idx" ON "gift_card_transactions" USING btree ("gift_card_id","created_at");--> statement-breakpoint
CREATE INDEX "gift_cards_status_idx" ON "gift_cards" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "gift_cards_purchaser_idx" ON "gift_cards" USING btree ("purchased_by_customer_id");--> statement-breakpoint
CREATE INDEX "wallet_transactions_wallet_idx" ON "wallet_transactions" USING btree ("wallet_id","created_at");--> statement-breakpoint
CREATE INDEX "wallet_transactions_booking_idx" ON "wallet_transactions" USING btree ("booking_id");--> statement-breakpoint
CREATE UNIQUE INDEX "wallets_customer_unique" ON "wallets" USING btree ("customer_profile_id") WHERE deleted_at IS NULL;--> statement-breakpoint
CREATE INDEX "audit_log_subject_idx" ON "audit_log" USING btree ("subject_type","subject_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_actor_idx" ON "audit_log" USING btree ("actor_user_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_action_idx" ON "audit_log" USING btree ("action","created_at");--> statement-breakpoint
CREATE INDEX "audit_log_created_idx" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "emergency_modes_active_idx" ON "emergency_modes" USING btree ("scope","scope_id","deactivated_at");--> statement-breakpoint
CREATE INDEX "settings_lookup_idx" ON "settings" USING btree ("key","scope","scope_id");--> statement-breakpoint
CREATE INDEX "settings_key_idx" ON "settings" USING btree ("key");--> statement-breakpoint
CREATE INDEX "settings_history_setting_idx" ON "settings_history" USING btree ("setting_id","created_at");