/*
  What keeps a fine's balance honest.

  The mirror of post/0023's recovery constraints, and the differences are the ones that matter:
  `fine_amount` is NULLABLE — most violations never reach a fine — so every check has to hold for a
  violation that has none, rather than forbidding it.
*/

-- Never more collected than was imposed, and never a negative collection.
SELECT add_constraint_if_missing('partner_violations', 'partner_violations_fine_collected_bounds',
  'CHECK (fine_collected_amount >= 0
          AND (fine_amount IS NULL OR fine_collected_amount <= fine_amount))');

/*
  A violation with NO fine has nothing to collect and nothing to settle.

  Without this, `fine_collected_amount` could be written on a `recorded` violation that was never
  fined — which is exactly the shape of the 9,369 rows already carrying a `fine_amount` at a stage
  where no fine was imposed. The constraint refuses the collection rather than trusting the query.
*/
SELECT add_constraint_if_missing('partner_violations', 'partner_violations_fine_collection_needs_fine',
  'CHECK (fine_amount IS NOT NULL OR (fine_collected_amount = 0 AND collected_at IS NULL))');

/*
  `collected_at` and the arithmetic agree.

  A fine marked settled with something outstanding hides a debt; one fully collected and unmarked
  never leaves the queue. Both are screens that lie, in opposite directions — the same reasoning
  post/0023 gives for a recovery, and it has to be stated separately because these are separate
  balances by Bashar's instruction.
*/
SELECT add_constraint_if_missing('partner_violations', 'partner_violations_fine_settled_agrees',
  'CHECK (fine_amount IS NULL
          OR ((collected_at IS NULL) = (fine_collected_amount < fine_amount)))');

SELECT add_constraint_if_missing('partner_fine_deductions', 'partner_fine_deductions_positive',
  'CHECK (amount > 0)');
