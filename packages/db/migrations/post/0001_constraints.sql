-- ============================================================================
-- SAFRA — guarantees that must live in the database, not in application code.
--
-- Runs AFTER the Drizzle-generated table migration. Everything here exists
-- because an application-level promise is not strong enough: these rules must
-- hold even when a future code path forgets them, and across every API node at
-- once. Prerequisites (extensions, sequences) are in migrations/pre/.
--
-- This file is IDEMPOTENT and re-applied on every deploy, so it must stay that
-- way:
--   - constraints go through add_constraint_if_missing()
--   - triggers use DROP TRIGGER IF EXISTS ... then CREATE
--   - indexes use CREATE INDEX IF NOT EXISTS
-- ============================================================================

-- Postgres has no ALTER TABLE ... ADD CONSTRAINT IF NOT EXISTS, so this wraps it.
CREATE OR REPLACE FUNCTION add_constraint_if_missing(
  target_table text,
  constraint_name text,
  definition text
) RETURNS void AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = constraint_name) THEN
    EXECUTE format(
      'ALTER TABLE %I ADD CONSTRAINT %I %s', target_table, constraint_name, definition
    );
  END IF;
END;
$$ LANGUAGE plpgsql;

-- ----------------------------------------------------------------------------
-- 1. EC-005 — the last-room double booking. THE critical constraint.
--
-- Two bookings for the same unit may never hold overlapping date ranges while
-- either is live. The '[)' bound is deliberate: a guest checking out on the 10th
-- and another checking in on the 10th do NOT overlap.
--
-- Cancelled and completed bookings are excluded from the predicate, so a unit
-- freed by a cancellation becomes immediately bookable again.
--
-- With this in place a concurrent double booking is not "unlikely" — it is
-- impossible. The losing transaction fails with SQLSTATE 23P01, which the booking
-- service translates into a 409 and a "just taken" message.
-- ----------------------------------------------------------------------------
-- v1 held only from pending_confirmation onward, which let two customers both
-- reach payment for the same dates. Superseded by v2, which holds from
-- pending_payment. Dropped explicitly because add_constraint_if_missing() only ever
-- adds.
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_no_overlapping_stays;

-- Any data created while v1 was in force may violate v2, and PostgreSQL refuses to
-- create an exclusion constraint that existing rows break. Overlapping
-- `pending_payment` rows are exactly what the v1 gap allowed, and they were never
-- valid reservations — none had been paid. Expiring them is the correct repair, and
-- it keeps this migration applicable to a database that ran the buggy version.
UPDATE bookings b
SET status = 'cancelled',
    cancelled_at = now(),
    cancellation_reason = 'Released: overlapping unpaid hold created before the reservation window was enforced.'
WHERE b.status = 'pending_payment'
  AND EXISTS (
    SELECT 1 FROM bookings other
    WHERE other.id <> b.id
      AND other.unit_id = b.unit_id
      AND other.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in')
      AND daterange(other.check_in, other.check_out, '[)')
          && daterange(b.check_in, b.check_out, '[)')
      -- Keep the earliest hold; release the ones that should never have been taken.
      AND other.created_at < b.created_at
  );

SELECT add_constraint_if_missing('bookings', 'bookings_no_overlapping_stays_v2', $def$
  EXCLUDE USING gist (
    unit_id WITH =,
    daterange(check_in, check_out, '[)') WITH &&
  )
  WHERE (status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in'))
$def$);

SELECT add_constraint_if_missing('bookings', 'bookings_checkout_after_checkin',
  'CHECK (check_out > check_in)');
SELECT add_constraint_if_missing('bookings', 'bookings_positive_adults',
  'CHECK (guests_adults >= 1)');
SELECT add_constraint_if_missing('bookings', 'bookings_non_negative_amounts', $def$
  CHECK (
    base_amount >= 0 AND customer_fee_amount >= 0 AND partner_commission_amount >= 0
    AND discount_amount >= 0 AND gift_card_amount >= 0 AND wallet_amount >= 0
    AND total_amount >= 0 AND partner_payable_amount >= 0
  )
$def$);

-- ----------------------------------------------------------------------------
-- 2. Money integrity
-- ----------------------------------------------------------------------------

-- SRS §7.4: the refund floor is 50% except where the admin approves an exception.
SELECT add_constraint_if_missing('cancellation_policies',
  'cancellation_policies_refund_floor',
  'CHECK (min_refund_percent BETWEEN 0 AND 100)');

-- A gift card can never be overspent, nor show more than it was issued with.
SELECT add_constraint_if_missing('gift_cards', 'gift_cards_balance_within_original',
  'CHECK (remaining_amount >= 0 AND remaining_amount <= original_amount)');

-- A wallet balance may not go negative: compensation credit is real money.
SELECT add_constraint_if_missing('wallets', 'wallets_non_negative_balance',
  'CHECK (balance >= 0)');

-- Percentage coupons are bounded; fixed-value coupons must name a currency.
SELECT add_constraint_if_missing('coupons', 'coupons_percent_bounded',
  $def$CHECK (value_kind <> 'percent' OR (value > 0 AND value <= 100))$def$);
SELECT add_constraint_if_missing('coupons', 'coupons_fixed_needs_currency',
  $def$CHECK (value_kind <> 'fixed' OR currency_id IS NOT NULL)$def$);
SELECT add_constraint_if_missing('coupons', 'coupons_window_ordered',
  'CHECK (ends_at > starts_at)');

-- Every ledger movement must balance. Checked per group by a DEFERRED constraint
-- trigger, so both legs can be inserted in one transaction before it runs.
CREATE OR REPLACE FUNCTION assert_ledger_group_balanced() RETURNS trigger AS $$
DECLARE
  debit_total  numeric(18,2);
  credit_total numeric(18,2);
BEGIN
  SELECT
    COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'debit'), 0),
    COALESCE(SUM(amount_syp) FILTER (WHERE direction = 'credit'), 0)
  INTO debit_total, credit_total
  FROM ledger_entries
  WHERE entry_group_id = NEW.entry_group_id;

  IF debit_total <> credit_total THEN
    RAISE EXCEPTION
      'Unbalanced ledger group %: debits % <> credits %',
      NEW.entry_group_id, debit_total, credit_total
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS ledger_entries_must_balance ON ledger_entries;
CREATE CONSTRAINT TRIGGER ledger_entries_must_balance
  AFTER INSERT ON ledger_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_ledger_group_balanced();

-- ----------------------------------------------------------------------------
-- 3. Immutability (SRS §13.3, §15, principle P-003)
--
-- Financial and audit records are append-only. A RULE ... DO INSTEAD NOTHING
-- would silently swallow writes, so these RAISE instead: a bug that tries to
-- rewrite history should fail loudly in CI, not succeed quietly in production.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION deny_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'Table % is append-only; % is not permitted. Write a reversing entry instead.',
    TG_TABLE_NAME, TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'ledger_entries', 'audit_log', 'wallet_transactions',
    'gift_card_transactions', 'timeline_events',
    -- settings_history is the record of who changed a commission rate or an SLA
    -- window and what it was before. It is evidence in exactly the same sense as
    -- audit_log, so it gets the same protection rather than relying on the parallel
    -- audit_log row surviving.
    'settings_history'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_immutable', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE OR DELETE ON %I
         FOR EACH ROW EXECUTE FUNCTION deny_mutation()',
      t || '_immutable', t
    );

    -- And the hole the row trigger cannot cover.
    --
    -- PostgreSQL does NOT fire row-level triggers on TRUNCATE, so every one of
    -- these tables could be emptied by anyone with table privileges, with no
    -- error and no trace. `reset-dev.ts` cleared 17,067 audit rows and 8,681
    -- timeline events that way without touching a trigger (2026-08-06) — which
    -- was convenient for a dev reset and is the wrong outcome everywhere else.
    --
    -- A STATEMENT-level trigger closes it. `deny_mutation()` already raises with
    -- TG_OP, so the message reads "TRUNCATE is not permitted on audit_log" and
    -- needs no change.
    --
    -- The cost, accepted deliberately: `db:reset-dev` and the testbed now have to
    -- suspend these explicitly with ALTER TABLE ... DISABLE TRIGGER. That is the
    -- point — clearing history becomes a thing somebody wrote down rather than an
    -- accident of which statement they happened to use.
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_no_truncate', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE TRUNCATE ON %I
         EXECUTE FUNCTION deny_mutation()',
      t || '_no_truncate', t
    );
  END LOOP;
END $$;

-- Webhook evidence is partially immutable: the received payload and its signature
-- verdict may never change, but processing state must be writable.
--
-- A blanket append-only trigger cannot express that, and leaving the table fully
-- mutable would let a bug — or an attacker with a SQL foothold — rewrite a forged
-- payload as a verified one after the fact, destroying the only record of the
-- forgery. So the trigger allows exactly the two processing columns to move and
-- rejects everything else.
--
-- DELETE is refused for EVIDENCE, and permitted for expired noise.
--
-- The original rule refused every DELETE, which read as the safer choice and was not.
-- The webhook endpoint is necessarily public and answers 200 even for an invalid
-- signature, so anyone can write rows to this table; refusing all deletion made that
-- growth permanent and unbounded — measured at 1,208 rows from routine probing on
-- 2026-08-02, with nothing able to reclaim them. An immutability guarantee that also
-- protects an attacker's junk is protecting the wrong thing.
--
-- So the exemption is drawn as narrowly as the risk allows. A row may be deleted ONLY
-- when all three hold:
--   * its signature never verified — it is not evidence of anything a provider said;
--   * it was never processed — nothing in the system acted on it, so no ledger entry,
--     payment or booking depends on it;
--   * it is older than 30 days — long enough to investigate an incident found late.
-- Anything verified, anything processed, and anything recent stays undeletable, which
-- is the property that actually mattered.
CREATE OR REPLACE FUNCTION deny_payment_event_rewrite() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.signature_verified = false
       AND OLD.processed_at IS NULL
       AND OLD.created_at < now() - interval '30 days' THEN
      RETURN OLD;
    END IF;

    RAISE EXCEPTION
      'payment_provider_events: only unverified, unprocessed payloads older than 30 '
      'days may be deleted. This row is evidence.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  IF NEW.provider           IS DISTINCT FROM OLD.provider
  OR NEW.provider_event_id  IS DISTINCT FROM OLD.provider_event_id
  OR NEW.event_type         IS DISTINCT FROM OLD.event_type
  OR NEW.payload            IS DISTINCT FROM OLD.payload
  OR NEW.signature_verified IS DISTINCT FROM OLD.signature_verified
  OR NEW.created_at         IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION
      'payment_provider_events: only processed_at, processing_error and payment_id may be updated.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS payment_provider_events_immutable ON payment_provider_events;
CREATE TRIGGER payment_provider_events_immutable
  BEFORE UPDATE OR DELETE ON payment_provider_events
  FOR EACH ROW EXECUTE FUNCTION deny_payment_event_rewrite();

-- ----------------------------------------------------------------------------
-- 4. updated_at maintenance — one trigger, not scattered application code.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION touch_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'currencies', 'countries', 'cities', 'users', 'customer_profiles',
    'partner_types', 'partners', 'partner_payout_accounts', 'partner_documents',
    'partner_violations', 'property_types', 'amenities', 'cancellation_policies',
    'properties', 'property_images', 'units', 'bookings', 'payments', 'refunds',
    'wallets', 'gift_cards', 'coupons', 'settings', 'emergency_modes'
  ]
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', t || '_touch_updated_at', t);
    EXECUTE format(
      'CREATE TRIGGER %I BEFORE UPDATE ON %I
         FOR EACH ROW EXECUTE FUNCTION touch_updated_at()',
      t || '_touch_updated_at', t
    );
  END LOOP;
END $$;

-- ----------------------------------------------------------------------------
-- 5. Search support (§14.1: results in under three seconds)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS properties_name_trgm_idx ON properties
  USING gin (name_ar gin_trgm_ops, name_en gin_trgm_ops);

CREATE INDEX IF NOT EXISTS cities_name_trgm_idx ON cities
  USING gin (name_ar gin_trgm_ops, name_en gin_trgm_ops);

-- Only live listings are ever searched, so the index stays small as archived
-- properties accumulate (and under P-003 they accumulate forever).
CREATE INDEX IF NOT EXISTS properties_published_idx
  ON properties (city_id, recommendation_score DESC)
  WHERE status = 'published' AND deleted_at IS NULL;

-- Expired idempotency keys and refresh tokens are swept by a scheduled job.
CREATE INDEX IF NOT EXISTS refresh_tokens_expiry_idx ON refresh_tokens (expires_at)
  WHERE revoked_at IS NULL;

-- ----------------------------------------------------------------------------
-- 6. One settings row per key and scope (P-005)
-- ----------------------------------------------------------------------------
--
-- Resolution reads a single row per key, so two rows for the same key and scope
-- make every read of that setting a coin toss — and the settings in question are
-- commissions, fines and the confirmation window. That is a silent wrong answer,
-- which is the worst shape a configuration bug can take.
--
-- NULLS NOT DISTINCT is what makes this work at all: `scope_id` is NULL for every
-- global setting, and PostgreSQL's default treats each NULL as unique, so a plain
-- unique index would permit exactly the duplicates being prevented here.
DO $$
DECLARE
  duplicates text;
BEGIN
  SELECT string_agg(DISTINCT key, ', ')
    INTO duplicates
  FROM (
    SELECT key FROM settings
    WHERE deleted_at IS NULL
    GROUP BY key, scope, scope_id
    HAVING COUNT(*) > 1
  ) d;

  IF duplicates IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot enforce one settings row per key and scope: duplicates exist for %. '
      'Remove the extra rows before migrating; which value is authoritative is not '
      'something a migration may decide.',
      duplicates
      USING ERRCODE = 'unique_violation';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS settings_key_scope_unique
  ON settings (key, scope, scope_id) NULLS NOT DISTINCT
  WHERE deleted_at IS NULL;

-- ----------------------------------------------------------------------------
-- 7. Sanctions screening (ADR 0002)
-- ----------------------------------------------------------------------------
--
-- Fuzzy name matching needs a trigram index; a btree cannot serve `similarity()`
-- at all. Without it every partner verification would sequentially scan the whole
-- list — slow enough that someone would eventually be tempted to skip the check,
-- which is the one outcome this feature cannot have.
CREATE INDEX IF NOT EXISTS sanctions_entries_name_trgm_idx
  ON sanctions_entries USING gin (normalised_name gin_trgm_ops);

-- Screening reads the newest COMPLETE snapshot per source on every verification.
CREATE INDEX IF NOT EXISTS sanctions_snapshots_current_idx
  ON sanctions_snapshots (source, completed_at DESC)
  WHERE completed_at IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 8. Disputes, conversations, notifications and advertising (2026-08-04)
-- ----------------------------------------------------------------------------
--
-- Added with the four console sections that read these tables. The enums and the
-- reference sequences already existed — the vocabulary was designed months earlier —
-- but nothing enforced the invariants the screens now depend on.

-- A dispute closed with no stated outcome is unauditable, and this is the record a
-- customer, a partner or an insurer asks to see. `resolved` and `rejected` are the
-- two terminal states, so both require the prose and the timestamp.
SELECT add_constraint_if_missing('disputes', 'disputes_closed_needs_resolution', $def$
  CHECK (
    status NOT IN ('resolved', 'rejected')
    OR (resolution IS NOT NULL AND closed_at IS NOT NULL)
  )
$def$);

-- Compensation is an amount AND a currency or neither. A bare number is not money:
-- 10 in SYP and 10 in USD differ by four orders of magnitude, and the wallet credit
-- that follows would be wrong by that factor.
SELECT add_constraint_if_missing('disputes', 'disputes_compensation_needs_currency', $def$
  CHECK (
    (compensation_amount IS NULL AND compensation_currency_id IS NULL)
    OR (compensation_amount IS NOT NULL AND compensation_currency_id IS NOT NULL)
  )
$def$);

SELECT add_constraint_if_missing('disputes', 'disputes_compensation_non_negative',
  'CHECK (compensation_amount IS NULL OR compensation_amount >= 0)');

-- A conversation must be ABOUT exactly one thing, or it cannot be routed to anybody.
-- The booking, dispute and partner columns are mutually exclusive rather than merely
-- "at least one": a thread attached to both a booking and an unrelated partner would
-- appear in two inboxes with two different sets of participants.
SELECT add_constraint_if_missing('conversations', 'conversations_exactly_one_subject', $def$
  CHECK (
    (booking_id IS NOT NULL)::int
    + (dispute_id IS NOT NULL)::int
    + (partner_id IS NOT NULL)::int = 1
  )
$def$);

SELECT add_constraint_if_missing('conversations', 'conversations_unread_non_negative',
  'CHECK (unread_for_staff >= 0)');

-- Messages are append-only.
--
-- A thread is consulted precisely when a dispute turns on what somebody promised, so a
-- message that can be edited afterwards makes the whole record worthless. This is also
-- what makes the contact-detail redaction meaningful: the redacted body cannot later be
-- rewritten to restore the phone number that was removed on the way in.
DROP TRIGGER IF EXISTS messages_immutable ON messages;
CREATE TRIGGER messages_immutable BEFORE UPDATE OR DELETE ON messages
  FOR EACH ROW EXECUTE FUNCTION deny_mutation();

-- The TRUNCATE half, matching the six tables in the loop above.
--
-- `messages` gets its trigger here rather than from that loop because it arrived
-- with the messaging tables in a later pass — which is exactly why the first
-- version of this fix left it as the ONE table still truncatable. Probed live
-- afterwards, which is how that was caught rather than shipped.
DROP TRIGGER IF EXISTS messages_no_truncate ON messages;
CREATE TRIGGER messages_no_truncate BEFORE TRUNCATE ON messages
  EXECUTE FUNCTION deny_mutation();

SELECT add_constraint_if_missing('messages', 'messages_redacted_count_non_negative',
  'CHECK (redacted_count >= 0)');

-- Notification counters and window.
SELECT add_constraint_if_missing('notifications', 'notifications_attempts_non_negative',
  'CHECK (attempts >= 0)');
SELECT add_constraint_if_missing('notifications', 'notifications_locale_supported',
  $def$CHECK (locale IN ('ar', 'en', 'de'))$def$);

-- A campaign that ends before it starts would be billed for negative time.
SELECT add_constraint_if_missing('ad_campaigns', 'ad_campaigns_window_ordered',
  'CHECK (ends_at > starts_at)');
SELECT add_constraint_if_missing('ad_campaigns', 'ad_campaigns_counters_non_negative',
  'CHECK (impressions >= 0 AND clicks >= 0)');
-- Clicks cannot exceed impressions: a click without a view means the counters are
-- being written from two places that disagree, which is worth failing on.
SELECT add_constraint_if_missing('ad_campaigns', 'ad_campaigns_clicks_within_impressions',
  'CHECK (clicks <= impressions)');
SELECT add_constraint_if_missing('ad_campaigns', 'ad_campaigns_price_needs_currency', $def$
  CHECK (
    (price_amount IS NULL AND price_currency_id IS NULL)
    OR (price_amount IS NOT NULL AND price_currency_id IS NOT NULL)
  )
$def$);

-- A contract file must have a size, and PDF only — the handoff says PDF ≤ 10MB. The
-- ceiling is enforced at the upload boundary too; this is the backstop for every other
-- writer, and 10MB is 10 * 1024 * 1024.
SELECT add_constraint_if_missing('partner_contracts', 'partner_contracts_pdf_within_limit', $def$
  CHECK (content_type = 'application/pdf' AND size_bytes > 0 AND size_bytes <= 10485760)
$def$);

-- Only one ACTIVE contract of a given kind per partner. Replacing supersedes rather
-- than overwrites, so without this a botched replacement leaves two live contracts and
-- no way to say which commission applies.
CREATE UNIQUE INDEX IF NOT EXISTS partner_contracts_one_active_per_kind
  ON partner_contracts (partner_id, kind)
  WHERE status = 'active' AND deleted_at IS NULL;
