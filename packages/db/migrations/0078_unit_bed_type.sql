-- What KIND of bed a unit has, beside how many it has.
--
-- «سرير فردي» or «سرير مزدوج» (Bashar, 2026-09-16). The listing said «سرير واحد» and never what it
-- was, which leaves somebody booking a room for two on a hope.
--
-- An ENUM rather than free text, because this value is READ by three apps and printed as a word in
-- three languages: a typed 'Double' would be a word with no translation and no way to find it.
--
-- NULLABLE, no default, no backfill. Every existing unit legitimately says nothing — a partner has
-- never been asked, and a DEFAULT 'single' would state a fact nobody entered on every three-bed
-- family room in the catalogue. A listing with no kind reads exactly as it read yesterday.
CREATE TYPE "bed_type" AS ENUM ('single', 'double');--> statement-breakpoint
ALTER TABLE "units" ADD COLUMN "bed_type" "bed_type";
