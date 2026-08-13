-- ============================================================================
-- Partial indexes for the three questions search asks of availability_days.
--
-- Measured against `safra_load` (73M availability rows, 200k units, 50k properties) on
-- 2026-08-13, as part of O-scale-2. Every figure below was taken, not estimated.
--
-- ## Why PARTIAL, and why three
--
-- availability_days is the largest table in the system, and search probes it once per
-- candidate unit for each of three separate predicates: is any night in the range not
-- available, does the arrival night carry a minimum-nights override, and what do the
-- overridden nights cost. All three are looking for the EXCEPTION. An absent row means an
-- available, unpriced, unconstrained night (§8.4 puts the burden on the partner to close
-- dates), so the overwhelming majority of rows answer "no" to all three questions.
--
-- The primary key (unit_id, date) can serve the lookups but cannot answer them: `status`,
-- `min_nights` and `price` are not in it, so each probe fetches the heap row — 150,000
-- random reads into a 9.5 GB table for one unfiltered search. A partial index holds only
-- the exceptional rows and answers from the index:
--
--     availability_days_unit_id_date_pk   4684 MB   all 73,000,000 rows
--     availability_days_blocked_idx        124 MB   3,200,000 blocked days
--     availability_days_min_nights_idx      ~0 MB   overrides are rare
--     availability_days_priced_idx         985 MB   20,800,000 priced days
--
-- The blocked index turned the anti-join from 150,000 per-unit probes into ONE bitmap scan.
-- The priced index carries `price` in its payload, so the price sum is an Index Only Scan
-- and never touches the heap: 0.149 ms per probe became 0.021 ms.
--
-- Effect on the unfiltered search: 3.9 s to 1.5 s. Together with the query rewrite in the
-- same entry, 144 s to 1.5 s.
--
-- ## The cost, stated
--
-- Three more indexes to maintain on the table partners write to when they edit a calendar.
-- The blocked and min_nights indexes are negligible. The priced one is not, and the 985 MB
-- above OVERSTATES it: the load generator prices 2 days in 7, which no real partner does.
-- Accepted because search is 80 % of traffic and a calendar edit is rare by comparison.
--
-- `IF NOT EXISTS` keeps this file idempotent, like its siblings in post/.
-- ============================================================================

-- Nights that are closed, booked or under maintenance.
CREATE INDEX IF NOT EXISTS availability_days_blocked_idx
  ON availability_days (unit_id, date)
  WHERE status <> 'available';

-- Nights carrying a minimum-stay override. Checked against the arrival night only.
CREATE INDEX IF NOT EXISTS availability_days_min_nights_idx
  ON availability_days (unit_id, date)
  WHERE min_nights IS NOT NULL;

-- Nights with a price override. `INCLUDE (price)` is what makes the sum index-only.
CREATE INDEX IF NOT EXISTS availability_days_priced_idx
  ON availability_days (unit_id, date) INCLUDE (price)
  WHERE price IS NOT NULL;
