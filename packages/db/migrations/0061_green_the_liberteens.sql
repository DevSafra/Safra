ALTER TABLE "properties" ADD COLUMN "star_rating" smallint;--> statement-breakpoint
-- The RANGE, enforced by the database rather than only by the schema that writes it.
--
-- `propertyCreateSchema` bounds it to 1-5 at the boundary, and that is the check a person meets.
-- This is the one a repair script, an import or a future endpoint meets, and it is the reason a
-- star rating cannot become 0, 9 or -1 by any route at all. NOT VALID is deliberately NOT used:
-- every existing row is NULL, so there is nothing to validate and the constraint is trustworthy
-- from the moment it exists.
ALTER TABLE "properties" ADD CONSTRAINT "properties_star_rating_range"
  CHECK ("star_rating" IS NULL OR ("star_rating" BETWEEN 1 AND 5));