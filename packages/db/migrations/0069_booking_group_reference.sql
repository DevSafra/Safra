/*
  A trip's reference, across the bookings it took (Bashar, 2026-09-06).

  ## What it is for, and what it is NOT for

  It does not group the ROOMS inside one booking — `booking_units` does that, and
  `bookings.reference` already names the stay they belong to. A second name for the same thing
  would be decoration.

  What has no identifier today is a guest who wanted two DIFFERENT room types. Two doubles and a
  suite is two bookings, because a booking carries one room type and a quantity — so a guest rings
  support saying «my booking» and there are two references, two payments and two vouchers with
  nothing recording that they are one trip. Finance sees the same split.

  So: one guest, one property, one set of dates, booked in one sitting = one group.

  ## Why the rule is BOUNDED, and what that cost to learn

  The first version of this grouped on (customer, property, check-in, check-out) alone. Applied to
  this database it produced a single "trip" holding 2,910 bookings — a load generator writing the
  same customer and window over and over. Nothing about that is a trip, and a support agent opening
  it would get an unreadable list.

  Real guests take a second room type within minutes of the first, so the rule carries a WINDOW,
  and a CAP catches whatever the window does not. A group that would exceed either simply starts a
  new one, which is the same thing an operator sees today — two references — rather than a wrong
  answer presented confidently.

  ## Additive, and deliberately not load-bearing

  Nothing reads it to decide anything: not availability, not money, not permissions. It is an
  operator's handle, and the worst outcome of a wrong grouping is a support agent seeing one trip
  as two — which is exactly what they see now. That is what makes a heuristic acceptable here and
  would not make it acceptable anywhere money is decided.
*/
ALTER TABLE "bookings" ADD COLUMN IF NOT EXISTS "booking_group_reference" text;

/* Re-runnable: a corrected rule has to be able to replace a previous run's answer. */
UPDATE "bookings" SET "booking_group_reference" = NULL;

/*
  The backfill applies the same bounded rule to history.

  A (customer, property, stay) set of ten or fewer is a plausible trip and becomes one group.
  Anything larger is machine-written traffic rather than a guest, and each of its bookings gets a
  group of its own — the honest answer, and the one that cannot mislead.
*/
WITH candidates AS MATERIALIZED (
  SELECT customer_profile_id, property_id, check_in, check_out
    FROM bookings
   GROUP BY 1, 2, 3, 4
  HAVING COUNT(*) BETWEEN 2 AND 10
),
groups AS MATERIALIZED (
  SELECT
    c.customer_profile_id,
    c.property_id,
    c.check_in,
    c.check_out,
    'TRP-' || to_char(now(), 'YYYY') || '-'
      || reference_number(nextval('booking_group_reference_seq')) AS reference
  FROM candidates c
)
UPDATE bookings b
   SET booking_group_reference = g.reference
  FROM groups g
 WHERE b.customer_profile_id = g.customer_profile_id
   AND b.property_id        = g.property_id
   AND b.check_in           = g.check_in
   AND b.check_out          = g.check_out;

/* Everything else is a trip of one. Nothing is left without a handle. */
UPDATE bookings
   SET booking_group_reference =
       'TRP-' || to_char(created_at, 'YYYY') || '-'
       || reference_number(nextval('booking_group_reference_seq'))
 WHERE booking_group_reference IS NULL;

/*
  Looked up by an operator with a reference in their hand, so it is indexed. Not unique: sharing it
  is the entire point.
*/
CREATE INDEX IF NOT EXISTS "bookings_group_reference_idx"
  ON "bookings" ("booking_group_reference");
