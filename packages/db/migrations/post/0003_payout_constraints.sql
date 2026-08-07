-- ============================================================================
-- SAFRA — guarantees for the partner payout ledger (design handoff §7.1).
--
-- A payout is money leaving SAFRA for a partner. Everything a code path could
-- get wrong about one is expensive and slow to discover, so the rules that must
-- always hold live here rather than in a service somebody can bypass.
--
-- Idempotent, like the rest of the post/ stage.
-- ============================================================================

-- ── The money identity ──────────────────────────────────────────────────────
--
-- net = gross - fine, always. A payout whose parts do not add up is a transfer
-- nobody can reconcile against the ledger, and the failure would surface as a
-- partner disputing an amount rather than as a test going red.
SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_net_identity',
  'CHECK (net_amount = gross_amount - fine_amount)');

SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_non_negative',
  'CHECK (gross_amount >= 0 AND fine_amount >= 0 AND net_amount >= 0)');

SELECT add_constraint_if_missing('partner_payout_items', 'partner_payout_items_positive',
  'CHECK (amount > 0)');

-- The period must be a period.
SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_period_ordered',
  'CHECK (period_end >= period_start)');

-- ── State and its evidence must agree ───────────────────────────────────────
--
-- Every one of these is a lie the table could otherwise tell: a payout marked
-- paid with no payment date, a scheduled one with no date, a hold with no
-- reason. Each is checked because each would be read by a person as fact.
SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_paid_evidence', $def$
  CHECK (
    (status = 'paid') = (paid_at IS NOT NULL)
  )
$def$);

SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_released_evidence', $def$
  CHECK (
    -- Released is a precondition of scheduled and paid, and of nothing else.
    (status IN ('scheduled', 'paid')) <= (released_at IS NOT NULL)
  )
$def$);

SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_scheduled_date', $def$
  CHECK (
    status <> 'scheduled' OR scheduled_for IS NOT NULL
  )
$def$);

SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_hold_reason', $def$
  CHECK (
    status <> 'on_hold' OR (hold_reason IS NOT NULL AND length(btrim(hold_reason)) > 0)
  )
$def$);

-- A paid payout carries the ledger movement that discharged it, and only a paid
-- one does. This is what makes the books and this table reconcilable in both
-- directions rather than merely consistent-looking.
SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_entry_group', $def$
  CHECK (
    (status = 'paid') = (entry_group_id IS NOT NULL)
  )
$def$);

-- ── A paid payout is history ────────────────────────────────────────────────
--
-- Not fully append-only: a payout row legitimately moves through its lifecycle,
-- so the immutability trigger used for `ledger_entries` would forbid the normal
-- case. What must never change is a transfer that already happened.
--
-- RAISE rather than silently ignoring the write, for the same reason
-- `deny_mutation` does: a bug that tries to restate a completed payment should
-- fail loudly in CI, not succeed quietly in production.
CREATE OR REPLACE FUNCTION deny_paid_payout_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION
      'Payout % is paid; it cannot be deleted. Post a reversing movement instead.',
      OLD.reference
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- `notes` and `paid_reference` stay writable: a bank reference often arrives
  -- after the transfer, and an operator noting what happened is not a restatement.
  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.net_amount IS DISTINCT FROM OLD.net_amount
     OR NEW.gross_amount IS DISTINCT FROM OLD.gross_amount
     OR NEW.fine_amount IS DISTINCT FROM OLD.fine_amount
     OR NEW.paid_at IS DISTINCT FROM OLD.paid_at
     OR NEW.partner_id IS DISTINCT FROM OLD.partner_id
     OR NEW.entry_group_id IS DISTINCT FROM OLD.entry_group_id
  THEN
    RAISE EXCEPTION
      'Payout % is paid; % may not be changed. Post a reversing movement instead.',
      OLD.reference, TG_OP
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partner_payouts_paid_immutable ON partner_payouts;
CREATE TRIGGER partner_payouts_paid_immutable
  BEFORE UPDATE OR DELETE ON partner_payouts
  FOR EACH ROW WHEN (OLD.status = 'paid')
  EXECUTE FUNCTION deny_paid_payout_mutation();

-- Items of a paid payout are the reconciliation record and are equally final.
CREATE OR REPLACE FUNCTION deny_paid_payout_item_mutation() RETURNS trigger AS $$
DECLARE
  payout_status_now text;
BEGIN
  SELECT status::text INTO payout_status_now
  FROM partner_payouts
  WHERE id = COALESCE(NEW.payout_id, OLD.payout_id);

  IF payout_status_now = 'paid' THEN
    RAISE EXCEPTION
      'This payout is paid; its covered bookings cannot be changed.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS partner_payout_items_paid_immutable ON partner_payout_items;
CREATE TRIGGER partner_payout_items_paid_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON partner_payout_items
  FOR EACH ROW EXECUTE FUNCTION deny_paid_payout_item_mutation();
