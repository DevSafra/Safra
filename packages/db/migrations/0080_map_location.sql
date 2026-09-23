-- The map's location model: public coordinates the database computes, and the landmarks
-- distances are measured to.
--
-- ## `public_latitude` / `public_longitude` are GENERATED, and that is the security control
--
-- Rounding to three decimals (~100 m) is the only thing protecting a listing's exact
-- position, and until now it was a function call — `fuzzCoordinate` — applied on the way out
-- of one endpoint. Three new read paths need the public pair (nearby markers, landmark
-- distances, a «within N km» filter), and each would have been a fresh opportunity to select
-- `latitude` by mistake. That mistake is invisible in review: the payload looks the same,
-- only sharper.
--
-- Generated columns make the finer value unreachable instead of merely discouraged — a public
-- query cannot name a column that holds it. `GENERATED ALWAYS` also means no writer can put
-- an unrounded value here, including a future migration that forgets why.
--
-- `nullif(latitude, '')` is not tidying: `Number('')` is 0, and an empty string used to
-- publish a listing at 0,0 in the Gulf of Guinea. The guard now lives in the definition.
ALTER TABLE "properties"
  ADD COLUMN "public_latitude" numeric(6, 3)
  GENERATED ALWAYS AS (round(nullif(latitude, '')::numeric, 3)) STORED;--> statement-breakpoint

ALTER TABLE "properties"
  ADD COLUMN "public_longitude" numeric(7, 3)
  GENERATED ALWAYS AS (round(nullif(longitude, '')::numeric, 3)) STORED;--> statement-breakpoint

-- The two map questions — «which listings are in this box» and «which are within N km of
-- this landmark» — both arrive as a bounding box on the PUBLIC pair. There is deliberately
-- no index on the raw columns: a precise geographic query is meant to be unformulatable,
-- not merely impolite.
--
-- Partial on the same predicate as `properties_star_rating_idx`, for the same reason — an
-- unpublished or deleted listing is never a map candidate.
CREATE INDEX "properties_public_coords_idx"
  ON "properties" USING btree ("public_latitude", "public_longitude")
  WHERE status = 'published' AND deleted_at IS NULL AND public_latitude IS NOT NULL;--> statement-breakpoint

-- What a guest measures a listing against. An airport's position is a published fact and is
-- stored exactly; the asymmetry with `properties` above is the model, not an oversight.
CREATE TYPE "public"."landmark_kind" AS ENUM(
  'city_centre', 'airport', 'transit', 'attraction',
  'beach', 'shopping', 'hospital', 'university'
);--> statement-breakpoint

CREATE TABLE "landmarks" (
  "id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
  "city_id" uuid NOT NULL,
  "slug" text NOT NULL,
  "kind" "landmark_kind" NOT NULL,
  "name_ar" text NOT NULL,
  "name_en" text NOT NULL,
  "name_de" text NOT NULL,
  "latitude" numeric(9, 6) NOT NULL,
  "longitude" numeric(9, 6) NOT NULL,
  "is_active" boolean DEFAULT true NOT NULL,
  "sort_order" integer DEFAULT 0 NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);--> statement-breakpoint

ALTER TABLE "landmarks" ADD CONSTRAINT "landmarks_city_id_cities_id_fk"
  FOREIGN KEY ("city_id") REFERENCES "public"."cities"("id")
  ON DELETE no action ON UPDATE no action;--> statement-breakpoint

CREATE UNIQUE INDEX "landmarks_city_slug_unique"
  ON "landmarks" USING btree ("city_id", "slug") WHERE deleted_at IS NULL;--> statement-breakpoint

CREATE INDEX "landmarks_city_active_idx"
  ON "landmarks" USING btree ("city_id", "is_active", "sort_order");
