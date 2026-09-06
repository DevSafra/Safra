/*
  Room-type inventory: one booking may hold SEVERAL identical rooms (Bashar, 2026-09-06).

  A hotel sells «جناح تنفيذي» four times over. Until now a guest who wanted two of them had to make
  two bookings, because `bookings.unit_id` is one column — and two bookings means two payments, two
  vouchers, two invoices and two confirmation emails for one arrival.

  ## Why rooms stay individual rows

  The obvious alternative is to stop modelling rooms one by one and count them instead: a room TYPE
  with `quantity = 4` and a tally of how many are sold on each date. That is how the requirement
  reads, and it is the wrong shape for this database, because the double-booking guarantee here is
  not code — it is an EXCLUDE constraint the server enforces under concurrency with no cooperation
  from the application. A counter has no such guarantee: two transactions read 3, both write 2, and
  the hotel is oversold with every check passing.

  So a room stays a row, and the QUANTITY becomes an authoring convenience — the partner states
  «four of these» and the platform keeps four rows in step. The guarantee is untouched; only who
  types the rows changes.

  The exclusion constraint and the trigger that feeds it live in post/0022_room_inventory.sql,
  where every other constraint lives and where add_constraint_if_missing() is defined.
*/

-- How many identical rooms this booking holds. Every booking that exists holds one.
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "rooms" smallint DEFAULT 1 NOT NULL;

/*
  Which physical rooms, one row each.

  `check_in`, `check_out` and `status` are copied from the booking because an exclusion constraint
  may only read columns of its own table, and the predicate deciding whether a stay holds inventory
  is the booking's STATUS. The trigger in post/ keeps the copy honest.
*/
CREATE TABLE IF NOT EXISTS "booking_units" (
  "booking_id" uuid NOT NULL REFERENCES "bookings"("id"),
  "unit_id"    uuid NOT NULL REFERENCES "units"("id"),
  "check_in"   date NOT NULL,
  "check_out"  date NOT NULL,
  "status"     "booking_status" NOT NULL,
  "created_at" timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT "booking_units_booking_id_unit_id_pk" PRIMARY KEY ("booking_id", "unit_id")
);

CREATE INDEX IF NOT EXISTS "booking_units_unit_dates_idx"
  ON "booking_units" ("unit_id", "check_in", "check_out");

-- Every booking that exists today holds exactly the room it names.
INSERT INTO "booking_units" ("booking_id", "unit_id", "check_in", "check_out", "status")
SELECT "id", "unit_id", "check_in", "check_out", "status" FROM "bookings"
ON CONFLICT ("booking_id", "unit_id") DO NOTHING;
