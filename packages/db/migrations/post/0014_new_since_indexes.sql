-- ============================================================================
-- SAFRA — «what is new since I last looked» needs an index per registry.
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================
--
-- Bashar, 2026-08-27: a badge counting the rows that arrived since a staff
-- member last opened a section. It is computed on EVERY authenticated console
-- page view, so rule 2 applies without argument — a query in a request path
-- uses an index.
--
-- customer_profiles, payments and wallet_transactions were indexed in 0054,
-- with the column that introduced the feature. These two are here because
-- الدفع والفواتير is not one table: its list is a UNION of payments, refunds
-- and fines, and a badge that counted only the first would disagree with the
-- list it points at. Counting all three means all three need the index.
--
-- Partial on deleted_at IS NULL because that is the only set the registry
-- shows, so the index answers the whole predicate rather than most of it.

CREATE INDEX IF NOT EXISTS refunds_created_idx
  ON refunds (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS partner_violations_created_idx
  ON partner_violations (created_at DESC) WHERE deleted_at IS NULL;
