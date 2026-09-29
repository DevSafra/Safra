-- جروبات gets a photograph.
--
-- Bashar, 2026-09-29: «I do not want Group Trips displayed as text-only content… I consider
-- imagery an important part of travel discovery and marketing.»
--
-- ONE cover per trip, held as columns rather than a `group_trip_images` table. A trip announces
-- itself with a single picture; a table would make «two covers» representable and then need a
-- rule, a uniqueness index and a promotion-on-delete dance to forbid it — all of which
-- `city_images` carries because a city genuinely has a GALLERY. A column cannot hold two.
--
-- The columns mirror `city_images` exactly, because the same `ImageService.process` fills them:
-- `file_key` is the prefix, `variant_widths` is what was actually rendered (never a guess — a URL
-- for an unrendered width 404s), and `width`/`height` let a card reserve the box before the bytes
-- arrive so a trip list does not reflow as it loads.
ALTER TABLE "group_trips"
  ADD COLUMN "cover_file_key" text,
  ADD COLUMN "cover_variant_widths" integer[] NOT NULL DEFAULT '{}',
  ADD COLUMN "cover_width" integer,
  ADD COLUMN "cover_height" integer,
  ADD COLUMN "cover_alt_ar" text,
  ADD COLUMN "cover_alt_en" text,
  ADD COLUMN "cover_alt_de" text;
--> statement-breakpoint
-- The metadata is meaningless without the key, and a row carrying alt text for a picture that is
-- not there is a row that will one day render an empty `<img alt="…">`. Enforced rather than
-- trusted: the upload writes the key and the dimensions together, the delete clears all of them.
ALTER TABLE "group_trips"
  ADD CONSTRAINT "group_trips_cover_needs_key" CHECK (
    "cover_file_key" IS NOT NULL
    OR (
      "cover_width" IS NULL
      AND "cover_height" IS NULL
      AND "cover_variant_widths" = '{}'
      AND "cover_alt_ar" IS NULL
      AND "cover_alt_en" IS NULL
      AND "cover_alt_de" IS NULL
    )
  );
