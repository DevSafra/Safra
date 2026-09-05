/*
  Give back the partner commission on every booking whose stay price already went back in full.

  Bashar's decision, 2026-09-05: "If a booking is fully refunded to the customer, the associated
  partner commission should also be reversed. SAFRA should not continue recognising partner
  commission revenue when the underlying booking value has been fully returned and the partner
  ultimately earned nothing."

  From here on `LedgerService.reverseCommissionIfFullyRefunded` posts this as each refund settles.
  This is the history that predates it: bookings already refunded to at least their base_amount,
  whose commission was still standing as revenue SAFRA could withdraw.

  ## Why it is a migration rather than a script

  It corrects the books, so it has to happen in every environment exactly once and be part of the
  history that explains the balances. A script run by hand on one database is how the two
  environments come to disagree about how much money the company has.

  ## Correctness

  - MATERIALIZED so gen_random_uuid() is evaluated ONCE per booking. Inlined, the two legs of a
    group would get different ids and every group would be half a group — which the deferred
    balance trigger would then reject, taking the whole migration down with it.
  - The NOT EXISTS on an existing debit makes it idempotent and makes it agree with the runtime
    guard, so a booking reversed by the service is never reversed again here.
  - The EXISTS on the credit skips bookings that never accrued commission in the first place;
    debiting one would take the account negative for money it never held.
  - round(amount * fx_rate_to_syp, 2) is the same arithmetic multiplyDecimalStrings performs, and
    was checked against existing rows before this was written.
*/
WITH fully AS MATERIALIZED (
  SELECT b.id,
         b.partner_commission_amount AS amount,
         b.currency_id,
         b.fx_rate_to_syp,
         b.partner_id,
         gen_random_uuid() AS grp
    FROM bookings b
   WHERE b.partner_commission_amount > 0
     AND coalesce((
           SELECT sum(r.amount) FROM refunds r
            WHERE r.booking_id = b.id
              AND r.status = 'completed'
              AND r.deleted_at IS NULL
         ), 0) >= b.base_amount
     AND EXISTS (
           SELECT 1 FROM ledger_entries e
            WHERE e.booking_id = b.id
              AND e.account = 'safra_commission_partner'
              AND e.direction = 'credit'
         )
     AND NOT EXISTS (
           SELECT 1 FROM ledger_entries e
            WHERE e.booking_id = b.id
              AND e.account = 'safra_commission_partner'
              AND e.direction = 'debit'
         )
)
INSERT INTO ledger_entries
  (entry_group_id, account, direction, amount, currency_id,
   fx_rate_to_syp, amount_syp, booking_id, partner_id, description)
SELECT grp, 'safra_commission_partner'::ledger_account, 'debit'::ledger_direction, amount, currency_id,
       fx_rate_to_syp, round(amount * fx_rate_to_syp, 2), id, partner_id,
       'Commission reversed, booking refunded in full'
  FROM fully
UNION ALL
SELECT grp, 'refund'::ledger_account, 'credit'::ledger_direction, amount, currency_id,
       fx_rate_to_syp, round(amount * fx_rate_to_syp, 2), id, partner_id,
       'Commission reversed, booking refunded in full'
  FROM fully;
