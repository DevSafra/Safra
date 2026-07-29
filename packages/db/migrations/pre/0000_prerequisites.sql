-- ============================================================================
-- Runs BEFORE the Drizzle-generated table migration.
--
-- Extensions and sequences must exist first: table DEFAULTs call nextval() on the
-- reference sequences (SRS §13.2), so creating them afterwards would fail.
-- ============================================================================

-- btree_gist lets one gist index mix equality (unit_id) with range overlap
-- (dates) — the precondition for the booking exclusion constraint.
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- fuzzy property/city name search
CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid, digest

-- Human-readable reference sequences (SRS §13.2).
CREATE SEQUENCE IF NOT EXISTS customer_reference_seq  START 1;
CREATE SEQUENCE IF NOT EXISTS partner_reference_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS property_reference_seq  START 101;
CREATE SEQUENCE IF NOT EXISTS booking_reference_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS payment_reference_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS gift_card_reference_seq START 1;
CREATE SEQUENCE IF NOT EXISTS dispute_reference_seq   START 1;
CREATE SEQUENCE IF NOT EXISTS ad_reference_seq        START 1;

-- Booking references are BKG-<year>-NNNNNN, so the counter restarts each January.
CREATE OR REPLACE FUNCTION reset_booking_sequence_yearly() RETURNS void AS $$
BEGIN
  PERFORM setval('booking_reference_seq', 1, false);
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION reset_booking_sequence_yearly() IS
  'Call from a scheduled job at 00:00 on 1 January for per-year booking numbering (SRS §6.5).';
