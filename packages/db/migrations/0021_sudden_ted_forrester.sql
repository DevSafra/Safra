CREATE TYPE "public"."review_report_status" AS ENUM('none', 'open', 'upheld', 'dismissed');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('published', 'hidden');--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'REV-' || lpad(nextval('review_reference_seq')::text, 6, '0') NOT NULL,
	"booking_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"unit_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"customer_profile_id" uuid NOT NULL,
	"rating" smallint NOT NULL,
	"body" text NOT NULL,
	"status" "review_status" DEFAULT 'published' NOT NULL,
	"partner_reply" text,
	"partner_replied_at" timestamp with time zone,
	"report_status" "review_report_status" DEFAULT 'none' NOT NULL,
	"report_reason" text,
	"reported_at" timestamp with time zone,
	"moderated_by_user_id" uuid,
	"moderated_at" timestamp with time zone,
	"moderation_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "reviews_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_unit_id_units_id_fk" FOREIGN KEY ("unit_id") REFERENCES "public"."units"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_customer_profile_id_customer_profiles_id_fk" FOREIGN KEY ("customer_profile_id") REFERENCES "public"."customer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_moderated_by_user_id_users_id_fk" FOREIGN KEY ("moderated_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_booking_unique" ON "reviews" USING btree ("booking_id");--> statement-breakpoint
CREATE INDEX "reviews_partner_idx" ON "reviews" USING btree ("partner_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_property_idx" ON "reviews" USING btree ("property_id","status");--> statement-breakpoint
CREATE INDEX "reviews_reported_idx" ON "reviews" USING btree ("report_status","reported_at");