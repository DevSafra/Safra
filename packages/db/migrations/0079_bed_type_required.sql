-- No bed on this platform is untyped.
--
-- Bashar, 2026-09-16: «We should be not allowed on the entire system to define only "سرير" — every
-- bed should be defined as سرير مزدوج or سرير فردي, also on multiple beds.» 0078 made the kind
-- optional; this makes it a fact every unit carries.
--
-- The backfill is an INFERENCE and is written here as one, because nobody was asked. One bed for
-- two or more guests is a double — that is what a room for two with a single bed in it would have
-- to be — and everything else takes the conservative answer. Partners correct their own rooms from
-- the portal; what this refuses to do is leave 59,537 rooms in a state the product no longer has.
UPDATE "units"
SET "bed_type" = CASE
  WHEN "beds" = 1 AND "max_guests" >= 2 THEN 'double'::"bed_type"
  ELSE 'single'::"bed_type"
END
WHERE "bed_type" IS NULL;--> statement-breakpoint
-- The default is for writers with no opinion — fixtures, the load generator, a migration adding a
-- column somewhere else. `unitCreateSchema` requires the kind, so no partner ever reaches it.
ALTER TABLE "units" ALTER COLUMN "bed_type" SET DEFAULT 'single';--> statement-breakpoint
ALTER TABLE "units" ALTER COLUMN "bed_type" SET NOT NULL;
