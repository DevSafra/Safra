-- ----------------------------------------------------------------------------
-- A refund returns through the payment it refunds, and nothing can point it
-- anywhere else (Bashar, 2026-10-02: «A customer refund must always be returned
-- to the exact same payment method that was originally used for the payment»).
--
-- The service already routes a refund back through `payments.provider` with the
-- original `provider_ref`, and nothing in any request names a destination. These
-- rules make the same guarantees the database's, so no future code path, script
-- or console query can break them without an error:
--
--   1. A refund refunds a CAPTURED payment of ITS OWN booking, in that payment's
--      currency. Pointing a refund at another booking's payment is pointing a
--      customer's money at somebody else's card.
--   2. The gateway share of every refund on a payment never exceeds what that
--      payment took, and the wallet share on a booking never exceeds what the
--      wallet funded. Anything past either is money returned through a rail it
--      never came in on.
--   3. A refund's payment and booking never change after it is written.
--   4. A captured payment's method, provider and provider reference never change:
--      rewriting them is the other way to send a refund somewhere new.
--
-- Plus one capture per booking, so "the original payment" always names one row.
-- Every rule RAISES rather than correcting the write, so a bug fails loudly.
-- ----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION refund_destination_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  pay record;
  gateway_total numeric;
  wallet_total numeric;
  wallet_funded numeric;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (NEW.payment_id IS DISTINCT FROM OLD.payment_id
          OR NEW.booking_id IS DISTINCT FROM OLD.booking_id) THEN
    RAISE EXCEPTION 'refund %: its payment and booking cannot change', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  -- Locked, so two refunds written at once cannot both fit under the same total.
  SELECT id, booking_id, currency_id, status, amount
    INTO pay
    FROM payments
   WHERE id = NEW.payment_id
     FOR UPDATE;

  IF pay.booking_id IS DISTINCT FROM NEW.booking_id THEN
    RAISE EXCEPTION 'refund on booking % names a payment of another booking', NEW.booking_id
      USING ERRCODE = 'check_violation';
  END IF;

  IF pay.currency_id IS DISTINCT FROM NEW.currency_id THEN
    RAISE EXCEPTION 'refund currency differs from the payment it refunds'
      USING ERRCODE = 'check_violation';
  END IF;

  IF pay.status NOT IN ('captured', 'partially_refunded', 'refunded') THEN
    RAISE EXCEPTION 'refund names payment % which took no money (status %)', pay.id, pay.status
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.wallet_amount < 0 OR NEW.wallet_amount > NEW.amount THEN
    RAISE EXCEPTION 'refund wallet share must lie between zero and the refund amount'
      USING ERRCODE = 'check_violation';
  END IF;

  IF NEW.status <> 'failed' THEN
    SELECT COALESCE(SUM(amount - wallet_amount), 0)
      INTO gateway_total
      FROM refunds
     WHERE payment_id = NEW.payment_id
       AND id <> NEW.id
       AND status <> 'failed'
       AND deleted_at IS NULL;

    IF gateway_total + (NEW.amount - NEW.wallet_amount) > pay.amount THEN
      RAISE EXCEPTION 'refunds through payment % would exceed the % it took', pay.id, pay.amount
        USING ERRCODE = 'check_violation';
    END IF;

    SELECT COALESCE(SUM(wallet_amount), 0)
      INTO wallet_total
      FROM refunds
     WHERE booking_id = NEW.booking_id
       AND id <> NEW.id
       AND status <> 'failed'
       AND deleted_at IS NULL;

    SELECT wallet_amount INTO wallet_funded FROM bookings WHERE id = NEW.booking_id;

    IF NEW.wallet_amount > 0 AND wallet_total + NEW.wallet_amount > wallet_funded THEN
      RAISE EXCEPTION 'wallet refunds on booking % would exceed the % the wallet paid',
        NEW.booking_id, wallet_funded
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS refunds_destination_guard ON refunds;

CREATE TRIGGER refunds_destination_guard
  BEFORE INSERT OR UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION refund_destination_guard();

CREATE OR REPLACE FUNCTION payment_method_frozen_after_capture() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('captured', 'partially_refunded', 'refunded')
     AND (NEW.method IS DISTINCT FROM OLD.method
          OR NEW.provider IS DISTINCT FROM OLD.provider
          OR NEW.provider_ref IS DISTINCT FROM OLD.provider_ref
          OR NEW.booking_id IS DISTINCT FROM OLD.booking_id) THEN
    RAISE EXCEPTION 'payment %: method, provider and reference are fixed once it has taken money',
      OLD.id
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS payments_method_frozen ON payments;

CREATE TRIGGER payments_method_frozen
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION payment_method_frozen_after_capture();

CREATE UNIQUE INDEX IF NOT EXISTS payments_one_capture_per_booking
  ON payments (booking_id)
  WHERE status IN ('captured', 'partially_refunded', 'refunded') AND deleted_at IS NULL;
