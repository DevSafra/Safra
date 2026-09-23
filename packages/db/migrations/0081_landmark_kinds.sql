-- Landmark kinds become a TABLE, four days after being an enum.
--
-- The enum's own comment argued that a kind picks an ICON and a sort priority, both of which are
-- code, so a kind staff could add would render as a blank glyph. Bashar overruled that on
-- 2026-09-23 and named the principle: operational data is managed through the platform, not
-- through a deployment. Which means the icon has to become data too — and that is the part the
-- enum argument had wrong. An icon is only code if you decide to draw it in code.
--
-- Same move `city_categories` made in post/0018, and it can be cleaner here: `landmarks` was
-- created the same day, holds only seeded rows, and nothing outside this migration references
-- the enum. So the column is REPLACED rather than kept in step with a join, and the enum type is
-- dropped — no dual-write drift to document and no dead type to puzzle over later.
--
-- `icon_paths` is SVG path data, one `d` attribute per entry, never markup. The contract
-- restricts it to the SVG path alphabet, which has no `<`, quote, ampersand or bracket in it, so
-- the value cannot become an element or a url() even if some future caller interpolated it
-- somewhere careless. An uploaded .svg would be the opposite: an HTML document that can carry
-- script, served from our own origin.
CREATE TABLE "landmark_kinds" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "code" text NOT NULL,
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "name_de" text NOT NULL,
  "icon_paths" text[] DEFAULT '{}' NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint

CREATE UNIQUE INDEX "landmark_kinds_code_unique"
  ON "landmark_kinds" USING btree ("code") WHERE deleted_at IS NULL;--> statement-breakpoint

-- Seeded HERE rather than only in db:seed, because the column below is NOT NULL and the rows
-- that already exist have to land somewhere. The names and the marks are what the enum
-- rendered, so nothing a guest sees changes on the way through.
INSERT INTO "landmark_kinds" (code, name_ar, name_en, name_de, icon_paths, sort_order) VALUES
  ('city_centre', 'وسط المدينة', 'City centre', 'Stadtzentrum',
   ARRAY['M4 9h16M4 15h16M9 4v16M15 4v16','M3 3h18v18H3z'], 1),
  ('airport', 'المطارات', 'Airports', 'Flughäfen',
   ARRAY['M3.5 14.5 21 9l-1 3.5-7 2.5-2.5 5-2-1 .8-3.6-3.3.9z'], 2),
  ('transit', 'المواصلات', 'Getting around', 'Verkehr',
   ARRAY['M7 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
         'M5 10h14M9 20l-2 2M15 20l2 2M9.5 16v4M14.5 16v4'], 3),
  ('attraction', 'معالم وأنشطة', 'Things to see', 'Sehenswürdigkeiten',
   ARRAY['M3 9.5 12 4l9 5.5','M5 9.5V19M12 9.5V19M19 9.5V19M3 19h18'], 4),
  ('beach', 'الشواطئ', 'Beaches', 'Strände',
   ARRAY['M12 3v9','M4 12a8 8 0 0 1 16 0z',
         'M3 19c2 0 2 1.5 4.5 1.5S10 19 12 19s2 1.5 4.5 1.5S19 19 21 19'], 5),
  ('shopping', 'التسوق', 'Shopping', 'Einkaufen',
   ARRAY['M5 8h14l-1 12H6z','M9 8V6a3 3 0 0 1 6 0v2'], 6),
  ('hospital', 'المستشفيات', 'Hospitals', 'Krankenhäuser',
   ARRAY['M4 4h16v16H4z','M12 8.5v7M8.5 12h7'], 7),
  ('university', 'الجامعات', 'Universities', 'Universitäten',
   ARRAY['M2.5 9 12 5l9.5 4L12 13z','M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11'], 8);--> statement-breakpoint

ALTER TABLE "landmarks" ADD COLUMN "kind_id" uuid;--> statement-breakpoint

UPDATE "landmarks" l SET kind_id = k.id
  FROM "landmark_kinds" k WHERE k.code = l.kind::text;--> statement-breakpoint

ALTER TABLE "landmarks" ALTER COLUMN "kind_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "landmarks" ADD CONSTRAINT "landmarks_kind_id_landmark_kinds_id_fk"
  FOREIGN KEY ("kind_id") REFERENCES "public"."landmark_kinds"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "landmarks_kind_idx" ON "landmarks" USING btree ("kind_id");--> statement-breakpoint

ALTER TABLE "landmarks" DROP COLUMN "kind";--> statement-breakpoint

DROP TYPE "public"."landmark_kind";
