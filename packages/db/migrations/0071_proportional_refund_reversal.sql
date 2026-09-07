/*
  Give the partner payable back in proportion to what the customer was refunded — the half of a
  refund reversal that has never been posted.

  Bashar's decision, 2026-09-07: "For a full refund, partner commission must be fully reversed, as
  already implemented. For a partial refund, partner payable should be reduced proportionally to
  the refunded amount unless there is an explicit business rule stating otherwise. SAFRA should not
  silently absorb refund costs while continuing to recognise the full partner earning and full
  commission as if no refund occurred."

  Migration 0066 reversed COMMISSION on fully refunded bookings and left `partner_payable`
  standing, so the books asserted SAFRA still owed partners for stays that had been returned in
  full: 2,880,954.00 across 15,489 bookings, measured before this ran, with the commission dutifully
  reversed beside it on most of them. Reversing one account and not the other is not half right; it
  is a balance sheet that does not describe the world.

  From here on `LedgerService.reverseForRefund` posts both as each refund settles. This is the
  history that predates it.

  ## Why it is a migration rather than a script

  It corrects the books, so it has to happen in every environment exactly once and be part of the
  history that explains the balances. A script run by hand on one database is how two environments
  come to disagree about how much money the company owes.

  ## The arithmetic, and why the payable takes the remainder

  A capture credits `fee + commission + payable`, so the ACCOMMODATION is `commission + payable`.
  A refund returns a slice of that (the SAFRA fee is not refundable — Bashar left that rule
  standing), so it gives back the same proportion of each.

  The commission share is rounded and the payable share takes what is LEFT, rather than being
  rounded independently. Rounding both would leave the pair short or long by a unit and the `refund`
  clearing account would carry a residue for ever; taking the remainder makes the two sum to the
  refund exactly, which is what lets that account net to zero.

  ## Correctness

  - Every figure comes from the LEDGER's own credits, never from `bookings.partner_payable_amount`
    — which this migration then rewrites. Checked first: where capture credits exist they agree
    with the columns on all 15,788 bookings that have them, and `base = commission + payable` is
    NOT a safe substitute (it is broken on 404 bookings, worst gap 813.00).
  - Targets are ABSOLUTE and compared against debits already posted, so re-running changes nothing
    and a booking the service already reversed is skipped. That is also why it agrees with the
    runtime guard rather than merely resembling it.
  - MATERIALIZED so gen_random_uuid() is evaluated ONCE per booking. Inlined, the legs of a group
    would get different ids, every group would be half a group, and the deferred balance trigger
    would reject the lot at COMMIT.
  - The refund is CLAMPED to the accommodation. 9,982 completed refunds exceed `base_amount`
    because they returned the total including the fee; without the clamp each would debit more than
    was ever credited and leave the partner owed a negative amount, which reads on their dashboard
    as a debt to SAFRA.
  - A booking whose capture never reached the ledger is left alone rather than guessed at. Eleven
    exist; ten are cancelled and cannot accrue, and the one that can is recorded in
    `docs/FUTURE-WORK.md` because inventing the credits it never had would be worse than naming it.
*/
CREATE TEMPORARY TABLE refund_reversal_targets ON COMMIT DROP AS
WITH captured AS MATERIALIZED (
  SELECT b.id,
         b.currency_id,
         b.fx_rate_to_syp,
         b.partner_id,
         coalesce((SELECT sum(e.amount) FROM ledger_entries e
                    WHERE e.booking_id = b.id
                      AND e.account = 'safra_commission_partner'
                      AND e.direction = 'credit'), 0) AS commission_credited,
         coalesce((SELECT sum(e.amount) FROM ledger_entries e
                    WHERE e.booking_id = b.id
                      AND e.account = 'safra_commission_partner'
                      AND e.direction = 'debit'), 0) AS commission_reversed,
         coalesce((SELECT sum(e.amount) FROM ledger_entries e
                    WHERE e.booking_id = b.id
                      AND e.account = 'partner_payable'
                      AND e.direction = 'credit'), 0) AS payable_credited,
         coalesce((SELECT sum(e.amount) FROM ledger_entries e
                    WHERE e.booking_id = b.id
                      AND e.account = 'partner_payable'
                      AND e.direction = 'debit'), 0) AS payable_reversed,
         coalesce((SELECT sum(r.amount) FROM refunds r
                    WHERE r.booking_id = b.id
                      AND r.status = 'completed'
                      AND r.deleted_at IS NULL), 0) AS refunded
    FROM bookings b
   WHERE EXISTS (SELECT 1 FROM refunds r
                  WHERE r.booking_id = b.id
                    AND r.status = 'completed'
                    AND r.deleted_at IS NULL)
),
shares AS (
  SELECT c.*,
         c.commission_credited + c.payable_credited AS accommodation,
         least(c.refunded, c.commission_credited + c.payable_credited) AS returned
    FROM captured c
   WHERE c.commission_credited + c.payable_credited > 0
     AND c.refunded > 0
),
targets AS (
  SELECT s.*,
         round(s.commission_credited * s.returned / s.accommodation, 3) AS target_commission,
         s.returned - round(s.commission_credited * s.returned / s.accommodation, 3)
           AS target_payable
    FROM shares s
)
SELECT id, currency_id, fx_rate_to_syp, partner_id,
       payable_credited,
       target_payable,
       returned >= accommodation AS in_full,
       greatest(target_commission - commission_reversed, 0) AS commission_delta,
       greatest(target_payable - payable_reversed, 0) AS payable_delta,
       gen_random_uuid() AS grp
  FROM targets;
--> statement-breakpoint
INSERT INTO ledger_entries
  (entry_group_id, account, direction, amount, currency_id,
   fx_rate_to_syp, amount_syp, booking_id, partner_id, description)
SELECT grp, 'safra_commission_partner'::ledger_account, 'debit'::ledger_direction,
       commission_delta, currency_id, fx_rate_to_syp,
       round(commission_delta * fx_rate_to_syp, 2), id, partner_id,
       CASE WHEN in_full THEN 'Reversed, booking refunded in full'
            ELSE 'Reversed in proportion to the refund' END
  FROM refund_reversal_targets
 WHERE commission_delta > 0
UNION ALL
SELECT grp, 'partner_payable'::ledger_account, 'debit'::ledger_direction,
       payable_delta, currency_id, fx_rate_to_syp,
       round(payable_delta * fx_rate_to_syp, 2), id, partner_id,
       CASE WHEN in_full THEN 'Reversed, booking refunded in full'
            ELSE 'Reversed in proportion to the refund' END
  FROM refund_reversal_targets
 WHERE payable_delta > 0
UNION ALL
SELECT grp, 'refund'::ledger_account, 'credit'::ledger_direction,
       commission_delta + payable_delta, currency_id, fx_rate_to_syp,
       round((commission_delta + payable_delta) * fx_rate_to_syp, 2), id, partner_id,
       CASE WHEN in_full THEN 'Reversed, booking refunded in full'
            ELSE 'Reversed in proportion to the refund' END
  FROM refund_reversal_targets
 WHERE commission_delta + payable_delta > 0;
--> statement-breakpoint
/*
  The snapshot the payout run reads.

  `bookings.partner_payable_amount` is what accrual copies onto a payout item, so a reversal that
  reached only the ledger would still pay the partner in full at the next hourly run — the books
  saying one thing and the transfer doing another. Set from the credits rather than decremented, so
  this cannot drift if it is ever run twice.
*/
UPDATE bookings b
   SET partner_payable_amount = greatest(t.payable_credited - t.target_payable, 0),
       updated_at = now()
  FROM refund_reversal_targets t
 WHERE b.id = t.id
   AND b.partner_payable_amount <> greatest(t.payable_credited - t.target_payable, 0);
--> statement-breakpoint
/*
  Which transfers are about to change — read BEFORE the lines are touched.

  A fully reversed line is DELETED, so a retotal written to find its payout through the item would
  find nothing left to find and leave the transfer standing at its old total. The ids have to be in
  hand first. (This is the same trap the service hit; the fix is the same in both places.)
*/
CREATE TEMPORARY TABLE refund_reversal_payouts ON COMMIT DROP AS
SELECT DISTINCT i.payout_id AS id
  FROM partner_payout_items i
  JOIN refund_reversal_targets t ON t.id = i.booking_id
  JOIN partner_payouts p ON p.id = i.payout_id
 WHERE p.deleted_at IS NULL
   AND p.status NOT IN ('paid', 'cancelled');
--> statement-breakpoint
/*
  Lines on a transfer that has not gone out yet.

  A booking refunded before its payout is released must not still be on it at the old figure. A
  PAID payout is left alone: its total is frozen by trigger the moment money moves, and money
  already sent is a recovery for a person to decide on. None are paid on this database — 128
  bookings sit on accruing payouts worth 23,808.00 — but the guard belongs in the statement rather
  than in the measurement that happened to be true today.

  Deleted rather than zeroed where nothing is left: `partner_payout_items_positive` forbids a zero
  line, and a transfer listing a booking worth nothing raises a question rather than answering one.
  The booking cannot re-accrue, because accrual only attaches a payable above zero.
*/
DELETE FROM partner_payout_items i
 USING refund_reversal_targets t, partner_payouts p
 WHERE i.booking_id = t.id
   AND p.id = i.payout_id
   AND p.deleted_at IS NULL
   AND p.status NOT IN ('paid', 'cancelled')
   AND greatest(t.payable_credited - t.target_payable, 0) <= 0;
--> statement-breakpoint
UPDATE partner_payout_items i
   SET amount = greatest(t.payable_credited - t.target_payable, 0)
  FROM refund_reversal_targets t, partner_payouts p
 WHERE i.booking_id = t.id
   AND p.id = i.payout_id
   AND p.deleted_at IS NULL
   AND p.status NOT IN ('paid', 'cancelled')
   AND i.amount <> greatest(t.payable_credited - t.target_payable, 0);
--> statement-breakpoint
UPDATE partner_payouts p
   SET gross_amount = coalesce(s.total, 0),
       net_amount = coalesce(s.total, 0) - p.fine_amount,
       updated_at = now()
  FROM (
    SELECT a.id,
           (SELECT coalesce(sum(i.amount), 0)
              FROM partner_payout_items i WHERE i.payout_id = a.id) AS total
      FROM refund_reversal_payouts a
  ) s
 WHERE p.id = s.id
   AND p.gross_amount <> coalesce(s.total, 0);
