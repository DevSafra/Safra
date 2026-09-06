-- ----------------------------------------------------------------------------
-- The double-booking guarantee, extended to rooms two through four
-- (Bashar, 2026-09-06)
--
-- `bookings_no_overlapping_stays_v3` protects the room a booking NAMES. A
-- booking that holds four rooms names one of them, so without this the other
-- three are held by nothing but application code — which is exactly what the
-- original constraint exists to avoid.
--
-- Same predicate, one table across. A status outside this list does not hold
-- inventory, which is what makes a cancellation release the nights.
--
-- `bookings_no_overlapping_stays_v3` is deliberately LEFT IN PLACE. It now
-- guards the lead room twice, which costs nothing and means a single-room
-- booking is still protected by the constraint it has always been protected by,
-- even if a caller ever forgets to write `booking_units`.
-- ----------------------------------------------------------------------------
SELECT add_constraint_if_missing('booking_units', 'booking_units_no_overlapping_stays', $def$
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in', 'disputed'))
$def$);

-- ----------------------------------------------------------------------------
-- Keeping the copy honest
--
-- A booking's status changes in a dozen places — cancellation, confirmation,
-- check-in, dispute, payment expiry, the staff console. Asking each of them to
-- remember a second table is how a copy drifts, and a drifted copy releases a
-- room somebody is sleeping in, or holds one nobody is.
--
-- So no caller has to know this table exists. The trigger fires only when one of
-- the three copied columns actually moves, so the ordinary UPDATE that touches
-- `updated_at` costs nothing.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION sync_booking_units() RETURNS trigger AS $$
BEGIN
  UPDATE booking_units
     SET status    = NEW.status,
         check_in  = NEW.check_in,
         check_out = NEW.check_out
   WHERE booking_id = NEW.id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_sync_units ON bookings;

CREATE TRIGGER bookings_sync_units
  AFTER UPDATE ON bookings
  FOR EACH ROW
  WHEN (OLD.status    IS DISTINCT FROM NEW.status
     OR OLD.check_in  IS DISTINCT FROM NEW.check_in
     OR OLD.check_out IS DISTINCT FROM NEW.check_out)
  EXECUTE FUNCTION sync_booking_units();

-- ----------------------------------------------------------------------------
-- Every booking holds its lead room, whoever created it
--
-- `BookingCreationService` writes `booking_units` for all the rooms a booking
-- takes. It is not the only thing that inserts a booking: the staff console
-- captures one on a partner's behalf, the seed and load-data scripts write
-- thousands, and whatever is written next will not know this table exists
-- either.
--
-- That matters because availability is read FROM `booking_units`. A booking with
-- no row here is a room the property page believes is free while somebody is
-- sleeping in it — the exact failure this whole change exists to prevent,
-- arriving through the back door.
--
-- So the lead room is written by the database. `ON CONFLICT DO NOTHING` because
-- the allocation inserts the same row a moment later, on the path that knows to.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION hold_lead_room() RETURNS trigger AS $$
BEGIN
  INSERT INTO booking_units (booking_id, unit_id, check_in, check_out, status)
  VALUES (NEW.id, NEW.unit_id, NEW.check_in, NEW.check_out, NEW.status)
  ON CONFLICT (booking_id, unit_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS bookings_hold_lead_room ON bookings;

CREATE TRIGGER bookings_hold_lead_room
  AFTER INSERT ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION hold_lead_room();
