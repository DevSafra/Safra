/*
  Amenities that belong to the building rather than to a room (Bashar, 2026-09-06).

  Same shape as unit_amenities and against the same catalogue: two foreign keys, a composite
  primary key that makes a duplicate link impossible, and an index on the amenity so "which
  properties have a pool" is not a scan.
*/
CREATE TABLE IF NOT EXISTS "property_amenities" (
  "property_id" uuid NOT NULL REFERENCES "properties"("id"),
  "amenity_id"  uuid NOT NULL REFERENCES "amenities"("id"),
  CONSTRAINT "property_amenities_property_id_amenity_id_pk"
    PRIMARY KEY ("property_id", "amenity_id")
);

CREATE INDEX IF NOT EXISTS "property_amenities_amenity_idx"
  ON "property_amenities" ("amenity_id");
