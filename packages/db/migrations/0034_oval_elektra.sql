CREATE TABLE "partner_application_contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"application_id" uuid NOT NULL,
	"contacted_by_user_id" uuid,
	"notes" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "partner_applications" DROP CONSTRAINT "partner_applications_contacted_by_user_id_users_id_fk";
--> statement-breakpoint
ALTER TABLE "partner_application_contacts" ADD CONSTRAINT "partner_application_contacts_application_id_partner_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."partner_applications"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "partner_application_contacts" ADD CONSTRAINT "partner_application_contacts_contacted_by_user_id_users_id_fk" FOREIGN KEY ("contacted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "partner_application_contacts_application_idx" ON "partner_application_contacts" USING btree ("application_id","created_at");--> statement-breakpoint
--
-- HAND-WRITTEN, and it must stay between the CREATE above and the DROPs below.
--
-- The three columns being dropped held the MOST RECENT call and nothing else, because every call
-- overwrote them. That single surviving call is real data an operator wrote, so it is carried into
-- the new table before the columns go; without this the drop discards it.
--
-- `created_at` is supplied rather than defaulted, so a backfilled call keeps the time it happened
-- instead of the time this migration ran.
--
-- `COALESCE(contact_notes, '')` covers a row contacted with no note recorded. The endpoint has
-- always required one, so this can only come from generated data — an empty note is therefore a
-- fact about the backfill, and the screen renders it as a call with nothing written, which is what
-- it was.
--
INSERT INTO "partner_application_contacts"
  ("application_id", "contacted_by_user_id", "notes", "created_at")
SELECT a."id",
       a."contacted_by_user_id",
       COALESCE(a."contact_notes", ''),
       COALESCE(a."contacted_at", a."updated_at")
FROM "partner_applications" a
WHERE a."contacted_at" IS NOT NULL OR a."contact_notes" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "partner_applications" DROP COLUMN "contacted_at";--> statement-breakpoint
ALTER TABLE "partner_applications" DROP COLUMN "contacted_by_user_id";--> statement-breakpoint
ALTER TABLE "partner_applications" DROP COLUMN "contact_notes";