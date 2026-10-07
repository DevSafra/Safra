-- migrate: no-transaction, concurrent indexes only
--
-- Indexes for queries that run on a request path and had none to use (go-live audit, 2026-10-06).
--
-- CONCURRENTLY because every one of these tables is live when a deploy runs: a plain build refuses
-- writes to the table until it has read all of it, and `notifications` is written on every booking,
-- message and payout. The first line above is what tells `migrate.ts` to run this file outside a
-- transaction, one statement at a time; `concurrent-index-file.ts` refuses anything in it that is
-- not a concurrent index build, and drops an index a failed build left invalid before retrying.
--
-- Only `--` comments here, and each statement ends with a `;` at the end of its line.

-- The partner dashboard's notices: `WHERE partner_id = $1 ... ORDER BY created_at DESC LIMIT 10`
-- (`partner/dashboard.service.ts`), read on every visit to لوحة الشريك, plus the console's delivery
-- log, which joins the partner. Partial, because most notifications are addressed to a customer and
-- would only make the index larger.
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_partner_idx
  ON notifications (partner_id, created_at DESC)
  WHERE partner_id IS NOT NULL;

-- The customer record's recent notifications: `WHERE customer_profile_id = $1 ORDER BY created_at
-- DESC` (`admin/registry.service.ts`). One composite serves both the filter and the order, which is
-- why it replaces the plain `customer_profile_id` index the query-cost review also asked for.
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_customer_idx
  ON notifications (customer_profile_id, created_at DESC)
  WHERE customer_profile_id IS NOT NULL;

-- The console's delivery log, filtered by channel and status over live rows, newest first.
-- Measured on the 1M-customer load database by the query-cost review of 2026-10-06.
CREATE INDEX CONCURRENTLY IF NOT EXISTS notifications_channel_status_created_idx
  ON notifications (channel, status, created_at)
  WHERE deleted_at IS NULL;

-- Refunds by payment: the webhook matches a provider's refund to its payment and counts the
-- payment's open refunds (`payments/payment-webhook.service.ts`), and `refund.service.ts` sums a
-- payment's refunds to settle its status. Every one of those read the whole table.
CREATE INDEX CONCURRENTLY IF NOT EXISTS refunds_payment_idx
  ON refunds (payment_id);

-- The customer registry's order, measured by the same review. `customer_profiles_created_idx`
-- covers `created_at` alone, and the registry pages by `created_at DESC, id DESC`, so a tie on the
-- timestamp sent it back to a sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_profiles_created_id_idx
  ON customer_profiles (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- The customer registry's search box, which matches part of a name or a reference. A btree cannot
-- serve a substring match at all; a trigram index can, the same way properties and cities are
-- searched (post/0001, section 5).
CREATE INDEX CONCURRENTLY IF NOT EXISTS customer_profiles_search_trgm_idx
  ON customer_profiles USING gin (full_name gin_trgm_ops, reference gin_trgm_ops);

-- The support inbox's order, newest first with the id as the tie-breaker.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_created_id_idx
  ON conversations (created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

-- A customer's own support threads, and the customer record's count of them.
CREATE INDEX CONCURRENTLY IF NOT EXISTS conversations_customer_idx
  ON conversations (customer_profile_id);
