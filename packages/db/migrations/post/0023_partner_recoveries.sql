/*
  The money identity, widened for a recovery — and the constraints that keep a balance honest.

  `net_amount = gross_amount - fine_amount` has held since payouts existed. `recovery_amount` is a
  third subtraction (Bashar, 2026-09-07: an overpayment «deducted from future payouts»), so the
  identity has to name it or every payout carrying one would violate the CHECK.

  Replaced rather than added beside: two CHECKs both claiming to define `net_amount` is two answers
  to one question, and the one that fires first would decide.
*/
ALTER TABLE partner_payouts DROP CONSTRAINT IF EXISTS partner_payouts_net_identity;
ALTER TABLE partner_payouts DROP CONSTRAINT IF EXISTS partner_payouts_non_negative;
SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_net_identity',
  'CHECK (net_amount = gross_amount - fine_amount - recovery_amount)');
/*
  `net_amount >= 0` is what forces a large recovery to be taken over SEVERAL transfers rather than
  producing a negative one. That is Bashar's rule expressed as a constraint: «Do not automatically
  create negative transfers.» A recovery of $500 against a gross of $200 takes $200 now and leaves
  $300 outstanding, because the database will not accept the alternative.
*/
SELECT add_constraint_if_missing('partner_payouts', 'partner_payouts_non_negative',
  'CHECK (gross_amount >= 0 AND fine_amount >= 0 AND recovery_amount >= 0 AND net_amount >= 0)');
/*
  A recovery is a positive amount, and never more can be recovered than arose.

  The second half is the one that matters: without it a bug in the deduction path would recover
  the same balance twice and take money off a partner for a refund that happened once.
*/
SELECT add_constraint_if_missing('partner_recoveries', 'partner_recoveries_amount_positive',
  'CHECK (amount > 0)');
SELECT add_constraint_if_missing('partner_recoveries', 'partner_recoveries_within_amount',
  'CHECK (recovered_amount >= 0 AND recovered_amount <= amount)');
/*
  `settled_at` and the arithmetic must agree.

  A row marked settled while something is still outstanding hides a debt; one fully recovered and
  not marked keeps appearing in a queue that should have let it go. Either half alone is a screen
  that lies, so the database holds both together.
*/
SELECT add_constraint_if_missing('partner_recoveries', 'partner_recoveries_settled_agrees',
  'CHECK ((settled_at IS NULL) = (recovered_amount < amount))');
SELECT add_constraint_if_missing('partner_recovery_deductions',
  'partner_recovery_deductions_positive', 'CHECK (amount > 0)');
