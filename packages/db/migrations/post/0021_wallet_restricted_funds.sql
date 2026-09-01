-- ============================================================================
-- SAFRA — money SAFRA gave you, and money that was yours.
--
-- Bashar, 2026-09-01: compensation credited by SAFRA — an SLA payment, a dispute
-- resolution, a goodwill gesture — stays inside the platform. It buys stays and
-- it does not turn into cash. Money the CUSTOMER funded, and refunds of it, stay
-- theirs to take back.
--
-- One balance, two kinds of money. `wallets.restricted_balance` is the part that
-- may never leave, `balance - restricted_balance` is the part that may, and
-- `wallet_transactions.restricted_amount` records which of the two each movement
-- moved. The columns are Drizzle's (0059); everything that makes them BINDING is
-- here, because a rule enforced only by whichever service you remembered is not
-- a rule — that lesson is written on this very table in 0011.
--
-- Idempotent, like the rest of the post/ stage: the constraints are conditional
-- and the backfill records that it ran.
-- ============================================================================

-- ── 1. The row cannot claim to have moved more restricted money than money ──
--
-- Both directions matter and for different reasons. Above `amount` on a credit
-- would invent restricted money out of nothing; above it on a debit would
-- consume restricted money that was never there, and the wallet's restricted
-- part would fall below what it actually holds — which is the direction that
-- releases compensation as cash.
SELECT add_constraint_if_missing('wallet_transactions',
  'wallet_transactions_restricted_within_amount',
  'CHECK (restricted_amount >= 0 AND restricted_amount <= amount)');

-- ── 2. A withdrawal may not touch it. The rule outlives whoever writes the code ─
--
-- There is no withdrawal endpoint today; `wallet_txn_reason` carries the value
-- so that this constraint can exist before the feature does. Whoever builds the
-- payout rails inherits the rule from the database rather than from a comment
-- they would have to find, and the first test they write against it fails for
-- the right reason.
SELECT add_constraint_if_missing('wallet_transactions',
  'wallet_transactions_withdrawal_is_unrestricted',
  'CHECK (reason <> ''withdrawal'' OR restricted_amount = 0)');

-- ── 3. The restricted part is a PART ────────────────────────────────────────
--
-- Larger than the balance would make the withdrawable remainder negative, and a
-- negative subtracted from a limit is how a limit becomes a licence. Added after
-- the backfill below, which is what has to satisfy it.

-- ── 4. Fifty thousand movements that predate the distinction ────────────────
--
-- Every wallet in production was built by rules that did not have this one, so
-- the opening restricted balance has to be RECONSTRUCTED — a balance that says
-- nothing about where it came from is a balance nobody can safely pay out.
--
-- The reconstruction is a replay, in the order the movements happened, applying
-- the rules the service now applies:
--
--   compensation, gift card    → restricted in full (SAFRA's money, or a bearer
--                                 instrument that must not become cash)
--   refund against a booking   → restricted up to what that booking's own debits
--                                 consumed, the remainder customer money
--   manual adjustment CREDIT   → restricted (see below)
--   profile claim              → whatever the matching debit took across
--   any debit                  → restricted part first
--
-- **Historical manual credits are treated as compensation.** 1,695 rows say
-- «finance credited this balance» and cannot say whether it was goodwill or the
-- correction of an overcharge; the distinction is what the new `fund` field
-- exists to capture and it did not exist when they were written. Restricting
-- them keeps compensation from becoming cash, which is the failure that matters,
-- and it costs a customer nothing today: the money still buys stays, and there
-- is no payout to be refused from. A row that was genuinely the customer's can
-- be freed the way everything else on an append-only table is — a debit and a
-- credit that state what they are.
--
-- **A card purchase consumes nothing restricted**, in history as in the code.
-- The rule when those rows were written was «not gift money»; the rule now is
-- «withdrawable money only». Replaying the older, looser rule would release
-- restricted money that today's rule would have held, so the replay applies the
-- stricter one and the clamp in step 5 absorbs the difference.
CREATE TABLE IF NOT EXISTS wallet_restriction_backfill (
  id            boolean PRIMARY KEY DEFAULT true CHECK (id),
  cutoff        timestamptz NOT NULL,
  rows_classified bigint NOT NULL,
  wallets_clamped bigint NOT NULL,
  completed_at  timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE wallet_restriction_backfill IS
  'One row: the moment the restricted/withdrawable split was reconstructed over wallet history, and what it touched. Its presence is what stops the replay running twice.';

DO $$
DECLARE
  moment      timestamptz := now();
  txn         record;
  held        numeric;
  owed        numeric;
  part        numeric;
  carried     numeric := 0;
  classified  bigint := 0;
  clamped     bigint := 0;
BEGIN
  IF EXISTS (SELECT 1 FROM wallet_restriction_backfill) THEN
    RAISE NOTICE 'wallet restriction backfill: already done, skipping';
    RETURN;
  END IF;

  CREATE TEMP TABLE replay_wallet (
    wallet_id  uuid PRIMARY KEY,
    restricted numeric NOT NULL DEFAULT 0
  ) ON COMMIT DROP;

  CREATE TEMP TABLE replay_booking (
    wallet_id   uuid NOT NULL,
    booking_id  uuid NOT NULL,
    outstanding numeric NOT NULL DEFAULT 0,
    PRIMARY KEY (wallet_id, booking_id)
  ) ON COMMIT DROP;

  -- The trail is immutable by trigger, which is what protects it from being
  -- rewritten. This adds a reading of rows that already exist rather than
  -- changing what any of them says, and it happens once, here, in a transaction
  -- that either finishes or leaves nothing behind.
  ALTER TABLE wallet_transactions DISABLE TRIGGER wallet_transactions_immutable;

  -- Ordered globally rather than per wallet, so a profile claim's credit is
  -- reached immediately after the debit that funded it and can carry across what
  -- that debit actually took. Both are written in one transaction, so they share
  -- a `created_at` and the uuidv7 tiebreaker keeps the debit first.
  FOR txn IN
    SELECT id, wallet_id, direction, reason::text AS reason, amount, booking_id
    FROM wallet_transactions
    WHERE created_at < moment
    ORDER BY created_at, id
  LOOP
    SELECT restricted INTO held FROM replay_wallet WHERE wallet_id = txn.wallet_id;
    held := COALESCE(held, 0);

    IF txn.direction = 'credit' THEN
      IF txn.reason IN ('sla_compensation', 'gift_card_transfer', 'admin_adjustment') THEN
        part := txn.amount;
      ELSIF txn.reason = 'refund' AND txn.booking_id IS NOT NULL THEN
        SELECT outstanding INTO owed
        FROM replay_booking
        WHERE wallet_id = txn.wallet_id AND booking_id = txn.booking_id;

        part := LEAST(txn.amount, COALESCE(owed, 0));

        UPDATE replay_booking SET outstanding = outstanding - part
        WHERE wallet_id = txn.wallet_id AND booking_id = txn.booking_id;
      ELSIF txn.reason = 'profile_claim' THEN
        part := LEAST(txn.amount, carried);
        carried := 0;
      ELSE
        part := 0;
      END IF;

      held := held + part;
    ELSE
      -- A card purchase reaches none of it; everything else spends the
      -- restricted part first.
      part := CASE WHEN txn.reason = 'gift_card_transfer'
                   THEN 0
                   ELSE LEAST(held, txn.amount) END;

      held := held - part;

      IF txn.booking_id IS NOT NULL THEN
        INSERT INTO replay_booking (wallet_id, booking_id, outstanding)
        VALUES (txn.wallet_id, txn.booking_id, part)
        ON CONFLICT (wallet_id, booking_id)
        DO UPDATE SET outstanding = replay_booking.outstanding + EXCLUDED.outstanding;
      END IF;

      IF txn.reason = 'profile_claim' THEN
        carried := part;
      END IF;
    END IF;

    IF part <> 0 THEN
      UPDATE wallet_transactions SET restricted_amount = part WHERE id = txn.id;
      classified := classified + 1;
    END IF;

    INSERT INTO replay_wallet (wallet_id, restricted)
    VALUES (txn.wallet_id, held)
    ON CONFLICT (wallet_id) DO UPDATE SET restricted = EXCLUDED.restricted;
  END LOOP;

  ALTER TABLE wallet_transactions ENABLE TRIGGER wallet_transactions_immutable;

  -- ── 5. The wallets, clamped to what they actually hold ────────────────────
  --
  -- `LEAST(…, balance)` is not decoration, and the reason is worth writing down:
  -- **`created_at` is the transaction's START time, so it does not order two
  -- movements that ran at once.** The service serialises them properly — one
  -- row lock, one at a time — but the row that COMMITTED second can carry the
  -- earlier timestamp, and the replay has nothing else to sort by. On one wallet
  -- in this database, a load test that hammered a single balance produced a
  -- credit whose `balance_after` is LOWER than the credit before it; replayed in
  -- timestamp order those rows imply a restricted part 50.00 larger than the
  -- balance it belongs to.
  --
  -- Clamping resolves it in the direction that cannot leak: restricted becomes
  -- the whole balance, so the withdrawable part is zero. The customer can still
  -- spend every unit of it on a stay — which is what the money was always for —
  -- and SAFRA cannot be asked to pay out a figure reconstructed from an order
  -- nobody can prove. `wallets_clamped` records how often it was needed, because
  -- a number that turns out to be large is a different conversation.
  WITH replayed AS (
    SELECT w.id,
           LEAST(COALESCE(r.restricted, 0), w.balance) AS restricted,
           COALESCE(r.restricted, 0) > w.balance       AS over
    FROM wallets w
    LEFT JOIN replay_wallet r ON r.wallet_id = w.id
  ), applied AS (
    UPDATE wallets w
    SET restricted_balance = replayed.restricted
    FROM replayed
    WHERE w.id = replayed.id
      AND w.restricted_balance = 0
      AND replayed.restricted <> 0
    RETURNING replayed.over
  )
  SELECT count(*) FILTER (WHERE over) INTO clamped FROM applied;

  INSERT INTO wallet_restriction_backfill (cutoff, rows_classified, wallets_clamped)
  VALUES (moment, classified, clamped);

  RAISE NOTICE 'wallet restriction backfill: % movements classified, % wallets clamped',
    classified, clamped;
END $$;

SELECT add_constraint_if_missing('wallets',
  'wallets_restricted_within_balance',
  'CHECK (restricted_balance >= 0 AND restricted_balance <= balance)');
