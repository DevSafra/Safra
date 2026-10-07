-- ----------------------------------------------------------------------------
-- A bank-transfer refund returns to the account the money came from
-- (Bashar, 2026-10-02: «build the bank transfer fix»).
--
-- The offline rails cannot report for themselves: finance confirms a transfer
-- arrived, and finance confirms a refund left. So the account is recorded at the
-- first step and enforced at the second:
--
--   - `payments.payer_account_encrypted` is the account the money came FROM. Set
--     once, never changed: changing it is pointing a future refund elsewhere.
--   - A refund on an offline rail becomes `completed` only with a bank reference
--     and a destination IDENTICAL to that ciphertext. The settlement copies the
--     payment's ciphertext rather than encrypting what was typed, so equality of
--     two strings is the proof it is the same account, and any other destination,
--     from any path, is refused here.
--
-- One writer may replace the ciphertext: a FIELD_ENCRYPTION_KEY rotation
-- (`apps/api/src/common/crypto/field-key-rotation.ts`), which sets
-- `safra.field_key_rotation` for its own transaction only. It re-encrypts the
-- SAME account, so the last four (and a refund's bank reference) must not move,
-- and it rewrites a payment and the refunds copied from it together, so the
-- two strings stay identical. Without it the retired key could never be removed:
-- these rows would be readable only under a key that no longer exists.
-- The setting is read through coalesce: in a session that never set it,
-- current_setting(…, true) is NULL, which makes the whole condition NULL, and an
-- IF on NULL does not raise. That is the guard switched off for every fresh
-- connection, which is how it was first written and how a test caught it.
--
-- The offline rails are named by slug. `offline-rails.test.ts` fails if a
-- provider the registry marks `isOffline` is missing from this list, so a new
-- offline rail cannot arrive without the rule.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION payer_account_set_once() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.payer_account_encrypted IS NOT NULL
     AND (NEW.payer_account_encrypted IS DISTINCT FROM OLD.payer_account_encrypted
          OR NEW.payer_account_last4 IS DISTINCT FROM OLD.payer_account_last4)
     AND NOT (coalesce(current_setting('safra.field_key_rotation', true), '') = 'on'
              AND NEW.payer_account_encrypted IS NOT NULL
              AND NEW.payer_account_last4 IS NOT DISTINCT FROM OLD.payer_account_last4) THEN
    RAISE EXCEPTION 'payment %: the account the money came from is recorded and cannot change',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF (NEW.payer_account_encrypted IS NULL) <> (NEW.payer_account_last4 IS NULL) THEN
    RAISE EXCEPTION 'payment %: a sender account needs both its ciphertext and its last four', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

SELECT ensure_trigger('payments', 'payments_payer_account_set_once', $def$
  CREATE TRIGGER payments_payer_account_set_once
    BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION payer_account_set_once()
$def$);

CREATE OR REPLACE FUNCTION bank_transfer_refund_destination() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pay record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.destination_account_encrypted IS NOT NULL
     AND (NEW.destination_account_encrypted IS DISTINCT FROM OLD.destination_account_encrypted
          OR NEW.destination_account_last4 IS DISTINCT FROM OLD.destination_account_last4
          OR NEW.transfer_reference IS DISTINCT FROM OLD.transfer_reference)
     AND NOT (coalesce(current_setting('safra.field_key_rotation', true), '') = 'on'
              AND NEW.destination_account_encrypted IS NOT NULL
              AND NEW.destination_account_last4 IS NOT DISTINCT FROM OLD.destination_account_last4
              AND NEW.transfer_reference IS NOT DISTINCT FROM OLD.transfer_reference) THEN
    RAISE EXCEPTION 'refund %: where it was sent is recorded and cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'completed' OR (TG_OP = 'UPDATE' AND OLD.status = 'completed') THEN
    RETURN NEW;
  END IF;

  SELECT provider, payer_account_encrypted INTO pay FROM payments WHERE id = NEW.payment_id;

  -- Only the offline rails, and only a refund that sends something: a wallet-only share needs no
  -- account, and a gateway refund goes back against the original charge.
  IF pay.provider NOT IN ('manual_transfer', 'internal') OR NEW.amount - NEW.wallet_amount <= 0 THEN
    RETURN NEW;
  END IF;

  IF pay.payer_account_encrypted IS NULL THEN
    RAISE EXCEPTION 'refund %: no account is recorded for the transfer it returns', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.destination_account_encrypted IS DISTINCT FROM pay.payer_account_encrypted THEN
    RAISE EXCEPTION 'refund %: completed to an account the money did not come from', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.transfer_reference IS NULL OR length(trim(NEW.transfer_reference)) < 3 THEN
    RAISE EXCEPTION 'refund %: a bank-transfer refund names the bank reference it left with', NEW.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

SELECT ensure_trigger('refunds', 'refunds_bank_transfer_destination', $def$
  CREATE TRIGGER refunds_bank_transfer_destination
    BEFORE INSERT OR UPDATE ON refunds
    FOR EACH ROW EXECUTE FUNCTION bank_transfer_refund_destination()
$def$);
