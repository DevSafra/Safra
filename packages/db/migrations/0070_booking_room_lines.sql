/*
  A booking may hold rooms of DIFFERENT types (Bashar, 2026-09-07).

  «غرفة مزدوجة × 2، جناح تنفيذي × 1، غرفة عائلية × 1» is one family's trip and, until now, three
  separate bookings — because a booking carried one room type and a quantity, and the allocation
  required every room it handed out to match the chosen one on property, type, PRICE and capacity.
  That guard was right for the model it was guarding: the base amount was one nightly rate
  multiplied, so a dearer sibling would have been sold at the cheaper one's price.

  ## What changes

  The multiplication goes. A booking's accommodation is now the SUM of what its rooms cost, and
  each room records its own share — so a suite and a standard room can sit on one booking at their
  own rates, and every figure downstream still adds up.

  `bookings.base_amount` is unchanged in meaning and still the total; what changes is how it is
  reached. `bookings.rooms` is still how many rooms, now across all types.

  ## `bookings.unit_id` keeps its meaning, narrowed

  It is the LEAD line's unit — the first type the guest chose. On a single-type booking that is
  what it has always been. On a mixed one it names one of several, so every surface that renders a
  booking's accommodation must render the LINES, not this column. Those surfaces are listed in
  docs/FUTURE-WORK.md; a screen that prints only `unit_id`'s name on a mixed booking is a defect,
  not a simplification.

  Removing the column instead would touch every booking query in the platform and buy nothing the
  lines do not already give — the same reasoning that kept one booking rather than several.
*/

/*
  What THIS room costs for the whole stay, at the rate that applied when it was booked.

  Snapshotted, not derived: `availability_days` carries per-date overrides a partner may edit
  afterwards, and an invoice that recomputed itself from today's calendar would restate a price the
  guest never agreed to.
*/
ALTER TABLE "booking_units"
  ADD COLUMN IF NOT EXISTS "accommodation_amount" numeric(14, 3);

/*
  Every booking that exists holds one type, so its rooms split its accommodation evenly.

  `base_amount` is the accommodation before the customer fee and before any discount — exactly what
  these rows sum to — so this is exact rather than approximate for all existing data.
*/
UPDATE booking_units bu
   SET accommodation_amount = ROUND(b.base_amount / GREATEST(b.rooms, 1), 3)
  FROM bookings b
 WHERE b.id = bu.booking_id
   AND bu.accommodation_amount IS NULL;

/* Anything the join could not reach — there should be none — records nothing rather than a guess. */
ALTER TABLE "booking_units"
  ADD CONSTRAINT "booking_units_accommodation_non_negative"
  CHECK ("accommodation_amount" IS NULL OR "accommodation_amount" >= 0);
