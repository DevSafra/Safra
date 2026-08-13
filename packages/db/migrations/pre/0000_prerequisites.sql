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
-- Added 2026-08-04 with the conversation and advertiser tables. `IF NOT EXISTS` means this
-- file stays idempotent and can be re-applied to an existing database.
CREATE SEQUENCE IF NOT EXISTS conversation_reference_seq START 1;
CREATE SEQUENCE IF NOT EXISTS advertiser_reference_seq   START 1;
-- Partner payouts (§7.1). A payout is a money EVENT and is quoted to a partner
-- when they ask where a transfer went, so it carries a reference like everything
-- else that moves money.
CREATE SEQUENCE IF NOT EXISTS payout_reference_seq       START 1;
CREATE SEQUENCE IF NOT EXISTS review_reference_seq       START 1;
-- Added 2026-08-13 with BullMQ phase 5. An export is a FILE a person asked for and comes
-- back to collect, so it needs a name they can quote to support when it is not there.
CREATE SEQUENCE IF NOT EXISTS export_reference_seq       START 1;

-- ----------------------------------------------------------------------------
-- The reference NUMBER, padded to six digits and never truncated.
--
-- Every reference default used to be lpad(nextval(...)::text, 6, '0') directly, and lpad
-- TRUNCATES when its input is longer than the width, keeping the FIRST six characters:
-- lpad('1000000', 6, '0') is '100000'. So the millionth row of any of the twelve referenced
-- tables was handed the reference the hundred-thousandth row already had — and because the
-- digit that falls off is the LAST one, ten consecutive counter values then collapse onto a
-- single reference. The unique index turned that into a failed INSERT — an outage rather than
-- two bookings quoting one number to two customers, which is the better of the two failures
-- and still a hard ceiling at 999,999 rows.
--
-- It bit at exactly the volumes this platform is designed for: rule 2 targets 1M users, and
-- docs/load-testing.md's data plan calls for 5M bookings. Found by generating that data
-- (2026-08-12) — the insert failed on the row after 999,999.
--
-- Below a million the output is unchanged, so every existing reference keeps its format and
-- no row needs rewriting. Past it, references simply grow a digit: CUS-1000000.
CREATE OR REPLACE FUNCTION reference_number(n bigint) RETURNS text AS $$
  SELECT CASE WHEN length(n::text) >= 6 THEN n::text ELSE lpad(n::text, 6, '0') END;
$$ LANGUAGE sql IMMUTABLE;
COMMENT ON FUNCTION reference_number(bigint) IS
  'Zero-pads a reference counter to six digits WITHOUT truncating past 999999. Never use lpad directly for a reference: it silently truncates and collides.';

-- Booking references are BKG-<year>-NNNNNN, so the counter restarts each January.
CREATE OR REPLACE FUNCTION reset_booking_sequence_yearly() RETURNS void AS $$
BEGIN
  PERFORM setval('booking_reference_seq', 1, false);
END;
$$ LANGUAGE plpgsql;
COMMENT ON FUNCTION reset_booking_sequence_yearly() IS
  'Call from a scheduled job at 00:00 on 1 January for per-year booking numbering (SRS §6.5).';

-- ----------------------------------------------------------------------------
-- UUIDv7 generator, used as the DATABASE-level default for every primary key.
--
-- The application also generates v7 ids client-side (see _shared.ts primaryId),
-- which avoids a round trip on inserts. This function is the safety net for every
-- other writer: data migrations, admin SQL, bulk imports and test fixtures. Without
-- it those all fail with "null value in column id", which is a footgun rather than
-- a guard rail.
--
-- v7 rather than gen_random_uuid()'s v4 so SQL-side inserts keep the same
-- index locality the application relies on. PostgreSQL 18 ships uuidv7()
-- natively; this is the equivalent for 17.
--
-- Ordering is at MILLISECOND granularity, not strictly monotonic: the low 80 bits
-- are random, so two ids minted in the same millisecond may sort either way.
-- Verified: ordering holds across distinct milliseconds, which is all that index
-- locality needs. Do not rely on this for sequencing — use created_at.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid AS $$
DECLARE
  v_time_ms bigint;
  v_bytes   bytea;
BEGIN
  v_time_ms := floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  -- 48-bit big-endian millisecond timestamp, then 80 random bits.
  v_bytes := substring(int8send(v_time_ms) FROM 3 FOR 6) || gen_random_bytes(10);

  -- Version 7 in the high nibble of byte 6 (0x70).
  v_bytes := set_byte(v_bytes, 6, (get_byte(v_bytes, 6) & 15) | 112);
  -- RFC 4122 variant 0b10 in the top two bits of byte 8 (0x80).
  v_bytes := set_byte(v_bytes, 8, (get_byte(v_bytes, 8) & 63) | 128);

  RETURN encode(v_bytes, 'hex')::uuid;
END;
$$ LANGUAGE plpgsql VOLATILE;
