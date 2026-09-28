-- جروبات — trips SAFRA puts together and announces (Bashar, 2026-09-27; built 2026-09-28).
--
-- «only the admin can create a group trip for this» is the whole shape. There is no partner column
-- and no customer one, so «who may write this» is answered by the table having no room for anyone
-- else rather than by a check somebody could forget — the same argument `property_faq_questions`
-- makes one migration earlier.
--
-- This version ANNOUNCES a trip; it does not sell one. No seats sold, no payment, no cancellation
-- ladder, because the booking engine books a UNIT with a quantity and a group trip is a different
-- object. `seats` and `price_from` are things a reader is told, not things the platform reconciles.
-- When it becomes bookable this table gains that side and nothing here is undone.
--
-- `price_from` and `currency_id` are nullable AS A PAIR. A trip may honestly say «السعر عند الطلب»,
-- and a price with no currency is the shape the money rule forbids outright: SYP and USD differ by
-- four orders of magnitude, so a bare number is not a smaller version of the right answer. The
-- check constraint below makes the pair unrepresentable in halves rather than merely discouraged.
--
-- No cover image in this version: a photograph here needs the variant pipeline property_images
-- runs, because mediaUrl builds a URL from the widths actually RENDERED and a bare key asks for a
-- variant nobody made. A column nothing can fill reads as coverage; it arrives with the pipeline.
--
-- Arabic is NOT NULL and the other two are nullable, the pattern `general_faq_entries` follows for
-- SAFRA's own content: `localisedText` falls back to Arabic, so a trip announced before its German
-- copy exists still reads in three languages instead of rendering an empty card to two of them.

CREATE TYPE "public"."group_trip_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint

CREATE TABLE "group_trips" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "slug" text NOT NULL,
  "city_id" uuid NOT NULL,
  "title_ar" text NOT NULL,
  "title_en" text,
  "title_de" text,
  "summary_ar" text NOT NULL,
  "summary_en" text,
  "summary_de" text,
  "description_ar" text NOT NULL,
  "description_en" text,
  "description_de" text,
  "starts_on" date NOT NULL,
  "ends_on" date NOT NULL,
  "price_from" numeric(15, 3),
  "currency_id" uuid,
  "seats" integer,
  "status" "group_trip_status" DEFAULT 'draft' NOT NULL,
  "published_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "group_trips" ADD CONSTRAINT "group_trips_city_id_cities_id_fk"
  FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "group_trips" ADD CONSTRAINT "group_trips_currency_id_currencies_id_fk"
  FOREIGN KEY ("currency_id") REFERENCES "public"."currencies"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

-- A price and its currency arrive together or not at all. Enforced here rather than trusted to the
-- contract, because the contract guards one door and this guards the table.
ALTER TABLE "group_trips" ADD CONSTRAINT "group_trips_price_needs_currency"
  CHECK (("price_from" IS NULL) = ("currency_id" IS NULL));--> statement-breakpoint

-- A trip ends on or after it starts. A single-day trip is legitimate, so this is not strict.
ALTER TABLE "group_trips" ADD CONSTRAINT "group_trips_dates_in_order"
  CHECK ("ends_on" >= "starts_on");--> statement-breakpoint

-- Partial on deleted_at for the reason _shared.ts gives: P-003 forbids hard deletes, so an
-- archived-then-deleted trip holding its slug would reserve that URL for ever.
CREATE UNIQUE INDEX "group_trips_slug_unique"
  ON "group_trips" USING btree ("slug") WHERE deleted_at IS NULL;--> statement-breakpoint

-- The public read: published trips, soonest first.
CREATE INDEX "group_trips_public_idx" ON "group_trips" USING btree ("status", "starts_on");--> statement-breakpoint

CREATE INDEX "group_trips_city_idx" ON "group_trips" USING btree ("city_id");
