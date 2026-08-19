CREATE TYPE "public"."partner_application_status" AS ENUM('submitted', 'contacted', 'accepted', 'rejected');--> statement-breakpoint
ALTER TYPE "public"."auth_token_purpose" ADD VALUE 'partner_invitation';--> statement-breakpoint
CREATE TABLE "partner_applications" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"reference" text DEFAULT 'PRQ-' || reference_number(nextval('partner_application_reference_seq')) NOT NULL,
	"status" "partner_application_status" DEFAULT 'submitted' NOT NULL,
	"submitted_by_user_id" uuid,
	"contact_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL,
	"legal_name" text NOT NULL,
	"display_name" text NOT NULL,
	"partner_type_id" uuid NOT NULL,
	"city_id" uuid NOT NULL,
	"address" text NOT NULL,
	"property_count" integer,
	"website" text,
	"message" text,
	"preferred_locale" text DEFAULT 'ar' NOT NULL,
	"contacted_at" timestamp with time zone,
	"contacted_by_user_id" uuid,
	"contact_notes" text,
	"decided_at" timestamp with time zone,
	"decided_by_user_id" uuid,
	"decision_notes" text,
	"partner_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone,
	CONSTRAINT "partner_applications_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_submitted_by_user_id_users_id_fk" FOREIGN KEY ("submitted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_partner_type_id_partner_types_id_fk" FOREIGN KEY ("partner_type_id") REFERENCES "public"."partner_types"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_city_id_cities_id_fk" FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_contacted_by_user_id_users_id_fk" FOREIGN KEY ("contacted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_applications" ADD CONSTRAINT "partner_applications_partner_id_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."partners"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_applications_status_idx" ON "partner_applications" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "partner_applications_open_email_unique" ON "partner_applications" USING btree (lower("email")) WHERE status IN ('submitted', 'contacted') AND deleted_at IS NULL;