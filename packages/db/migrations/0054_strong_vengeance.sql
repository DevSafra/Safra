ALTER TABLE "users" ADD COLUMN "section_seen_at" jsonb DEFAULT '{}'::jsonb NOT NULL;
-- ── The indexes «what is new since I last looked» needs ─────────────────────
--
-- The badge counts rows created since a per-reader mark, and it runs on EVERY
-- authenticated console page view. Rule 2: a query in a request path uses an
-- index. `bookings` already has `bookings_created_idx`; these three tables had
-- nothing on `created_at` at all, so the count would have been a sequential
-- scan over 11k customers and growing, on every page.
--
-- Partial on `deleted_at IS NULL` because that is the only set any of these
-- registries shows, so the index answers the whole predicate.
CREATE INDEX IF NOT EXISTS customer_profiles_created_idx
  ON customer_profiles (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS payments_created_idx
  ON payments (created_at DESC) WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS wallet_transactions_created_idx
  ON wallet_transactions (created_at DESC);
