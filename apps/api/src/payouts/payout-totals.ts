import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { fromMinor, MONEY_SCALE, toMinor } from '../common/money.js';

/*
  A partner transfer's totals: gross from its items, less the recoveries and fines it collects.

  Lifted out of `PayoutService` (2026-10-06) because a REFUND changes a transfer's items too, and
  `LedgerService.reverseForRefund` used to retotal with its own one-statement copy that kept the
  fine and recovery already applied. When the refund took the gross below them, the net went
  negative, `partner_payouts_non_negative` refused the statement after the money had moved, and the
  partner stayed on the transfer for the refunded stay. One implementation, called from both
  places, is what keeps the deduction rules in step: a payout's figure is the same question
  whichever event asked it.
*/

/**
 * Recomputes a payout's total from its items, and takes off what the partner owes back.
 *
 * Only ever called while the payout is open — the paid-immutability trigger refuses it
 * afterwards, which is the point: a total is frozen the moment money moves.
 */
export async function retotalPayout(tx: Database, payoutId: string): Promise<void> {
  /*
    Release BOTH, then apply both. The order inside each half matters and so does this one.

    Releasing first makes the whole thing a recomputation: `retotalPayout` runs on every accrual and
    correction, and a deduction that accumulated would take the same balance off one transfer
    repeatedly.

    Releasing both BEFORE applying either is the part that is easy to get wrong. They compete for
    one headroom — `net_amount >= 0` bounds their SUM — so if the fines were still applied while
    the recoveries were being decided, the recoveries would be sized against a figure that was
    about to be released, and would come out short on every re-run.

    Then: recoveries, then fines. A recovery is money that was never owed at all; a fine is a
    charge the partner can appeal and have waived. So the correction is taken first and the
    penalty waits, which is the more forgiving error when only one of them fits this period.
  */
  await releaseRecoveries(tx, payoutId);
  await releaseFines(tx, payoutId);

  /*
    The new gross only once nothing is deducted from it.

    Setting it first, with the old deductions still applied, is safe while the gross can only grow,
    which is all accrual ever does. A refund SHRINKS it, and the gross could then fall below the
    fine already taken: the net went negative and `partner_payouts_non_negative` refused the
    statement before the release below could make room (audit 2026-10-06).
  */
  await tx.execute(sql`
    UPDATE partner_payouts p
    SET gross_amount = coalesce(i.total, 0),
        net_amount = coalesce(i.total, 0) - p.fine_amount - p.recovery_amount,
        updated_at = now()
    FROM (
      SELECT coalesce(sum(amount), 0) AS total
      FROM partner_payout_items WHERE payout_id = ${payoutId}
    ) i
    WHERE p.id = ${payoutId}
  `);

  await applyRecoveries(tx, payoutId);
  await applyFines(tx, payoutId);
}

/**
 * Outstanding fines, collected through the ordinary transfer.
 *
 * ## Bashar's rule (2026-09-07)
 *
 * «Partner fines should be collected automatically through the payout process. The fine amount
 * should be deducted from future partner payouts in the same way recoverable balances are
 * handled. If a payout is smaller than the outstanding fine balance, deduct what is available and
 * carry the remaining amount forward. Do not create negative payouts.»
 *
 * `partner_payouts.fine_amount` has been in the money identity since payouts existed and had no
 * writer at all: the ladder imposed fines, the ledger recorded the partner owing them, and no
 * transfer ever took one back. 6,643 imposed and unwaived fines worth $66,430 across 423 partners
 * on this database, and zero payouts that had ever carried one.
 *
 * ## Only a fine that was actually IMPOSED
 *
 * `stage IN ('fined', 'suspension')`. A violation at `recorded` or `warned` is on the ladder and
 * has not been fined — and 9,369 rows here carry a `fine_amount` at `recorded` anyway, which the
 * console's own note says cannot happen. Collecting those would charge partners for penalties
 * nobody levied, so the stage is part of the predicate rather than a comment about the data.
 *
 * A WAIVED fine is not collected, and a waiver after a partial collection simply stops the rest.
 *
 * ## It shares the headroom with recoveries and can never make a transfer negative
 *
 * `net_amount >= 0` is a CHECK, so the two together cannot exceed what the transfer is worth.
 * `least(outstanding, headroom)` takes what fits and leaves the rest for the next period — which
 * is «carry the remaining amount forward», enforced by the database rather than promised.
 *
 * ## Idempotent, because `retotalPayout` runs often
 *
 * The applications are cleared and re-decided rather than accumulated, so the answer depends only
 * on what is outstanding now. `releaseFines` is the other half, and cancellation uses it too.
 */
async function applyFines(tx: Database, payoutId: string): Promise<void> {
  const payout = await tx.execute<{
    partner_id: string;
    currency_id: string;
    gross_amount: string;
    recovery_amount: string;
    status: string;
  }>(sql`
    SELECT partner_id::text, currency_id::text, gross_amount::text,
           recovery_amount::text, status::text
      FROM partner_payouts
     WHERE id = ${payoutId} AND deleted_at IS NULL
  `);

  const row = payout.rows[0];

  if (!row || row.status === 'paid' || row.status === 'cancelled') return;

  /* Already released by `retotalPayout`, along with the recoveries — see the note there. */
  const outstanding = await tx.execute<{ id: string; left: string }>(sql`
    SELECT id::text, (fine_amount - fine_collected_amount)::text AS left
      FROM partner_violations
     WHERE partner_id = ${row.partner_id}
       AND fine_currency_id = ${row.currency_id}
       AND deleted_at IS NULL
       AND waived_at IS NULL
       AND collected_at IS NULL
       AND stage IN ('fined', 'suspension')
       AND fine_amount IS NOT NULL
       AND fine_amount > fine_collected_amount
     ORDER BY created_at
  `);

  if (outstanding.rows.length === 0) return;

  /*
    What is left AFTER the recoveries have taken their share. Read from the row rather than
    recomputed, because `applyRecoveries` has already written it.
  */
  let headroom =
    toMinor(row.gross_amount, MONEY_SCALE) - toMinor(row.recovery_amount, MONEY_SCALE);

  if (headroom <= 0n) return;

  let taken = 0n;

  for (const fine of outstanding.rows) {
    if (headroom <= 0n) break;

    const left = toMinor(fine.left, MONEY_SCALE);
    const take = left > headroom ? headroom : left;

    if (take <= 0n) continue;

    const amount = fromMinor(take, MONEY_SCALE);

    await tx.execute(sql`
      INSERT INTO partner_fine_deductions (violation_id, payout_id, amount)
      VALUES (${fine.id}, ${payoutId}, ${amount})
    `);
    await tx.execute(sql`
      UPDATE partner_violations
         SET fine_collected_amount = fine_collected_amount + ${amount}::numeric,
             collected_at = CASE
               WHEN fine_collected_amount + ${amount}::numeric >= fine_amount THEN now()
               ELSE NULL
             END,
             updated_at = now()
       WHERE id = ${fine.id}
    `);

    headroom -= take;
    taken += take;
  }

  if (taken <= 0n) return;

  await tx.execute(sql`
    UPDATE partner_payouts
       SET fine_amount = ${fromMinor(taken, MONEY_SCALE)},
           net_amount = gross_amount - ${fromMinor(taken, MONEY_SCALE)}::numeric
                        - recovery_amount,
           updated_at = now()
     WHERE id = ${payoutId}
  `);
}

/**
 * Puts back every fine this transfer had collected, so it is outstanding again.
 *
 * The mirror of `releaseRecoveries`, and needed for the same two reasons: it makes `applyFines` a
 * recomputation rather than an accumulation, and CANCELLING a transfer has to give the money
 * back. A fine left marked collected against a transfer that never happened is a penalty the
 * partner paid without paying it.
 *
 * Both columns in one statement, because `net = gross - fine - recovery` is enforced per
 * statement.
 */
export async function releaseFines(tx: Database, payoutId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE partner_violations v
       SET fine_collected_amount = v.fine_collected_amount - d.amount,
           collected_at = NULL,
           updated_at = now()
      FROM partner_fine_deductions d
     WHERE d.violation_id = v.id AND d.payout_id = ${payoutId}
  `);
  await tx.execute(sql`
    DELETE FROM partner_fine_deductions WHERE payout_id = ${payoutId}
  `);
  await tx.execute(sql`
    UPDATE partner_payouts
       SET fine_amount = 0,
           net_amount = gross_amount - recovery_amount
     WHERE id = ${payoutId}
  `);
}

/**
 * Puts back every balance this transfer had taken, so it is outstanding again.
 *
 * Called by `retotalPayout` before anything is applied, which is what makes the whole thing a
 * recomputation rather than an accumulation — and on CANCELLATION, which is where its absence was
 * a real defect.
 *
 * ## The cancellation case
 *
 * `cancel` deletes a payout's items and marks it final. Without this it left `recovery_amount`
 * standing and the deduction rows in place, so a balance stayed marked as collected while no
 * money had ever moved: the partner's debt silently disappeared and SAFRA absorbed it. Exactly
 * the shape of the defect Bashar's 2026-09-07 decisions exist to remove, reintroduced by the
 * mechanism built to satisfy them.
 *
 * ## Both columns in one statement
 *
 * `net = gross - fine - recovery` is enforced per STATEMENT, so clearing `recovery_amount` alone
 * fails the CHECK before the reapplication that would make it true again.
 */
export async function releaseRecoveries(tx: Database, payoutId: string): Promise<void> {
  await tx.execute(sql`
    UPDATE partner_recoveries r
       SET recovered_amount = r.recovered_amount - d.amount,
           settled_at = NULL,
           updated_at = now()
      FROM partner_recovery_deductions d
     WHERE d.recovery_id = r.id AND d.payout_id = ${payoutId}
  `);
  await tx.execute(sql`
    DELETE FROM partner_recovery_deductions WHERE payout_id = ${payoutId}
  `);
  await tx.execute(sql`
    UPDATE partner_payouts
       SET recovery_amount = 0,
           net_amount = gross_amount - fine_amount
     WHERE id = ${payoutId}
  `);
}

/**
 * Outstanding overpayments, taken off this transfer through the ordinary process.
 *
 * ## Bashar's rule (2026-09-07)
 *
 * «If a payout has already been paid and a refund later creates an overpayment, I want the
 * difference recorded as a recoverable balance that is deducted from future payouts. Do not
 * automatically create negative transfers or attempt to claw money back outside the normal
 * payout process.»
 *
 * `LedgerService.recordOverpayment` writes the balance when the refund settles. This is the
 * collecting half, and it happens here — where a transfer's figure is computed — so the deduction
 * is part of the ordinary total rather than a separate movement anybody has to chase.
 *
 * ## It never produces a negative transfer
 *
 * `net_amount >= 0` is a CHECK, so a balance larger than the transfer cannot be taken in one
 * go. `least(outstanding, headroom)` takes what fits and leaves the rest outstanding for the
 * next period — which is «deducted from future payouts» in the plural, as asked.
 *
 * ## Applied per recovery, oldest first
 *
 * So a partner reading «$150 recovered» can be shown WHICH overpayments it settled, and the
 * oldest debt clears first rather than an arbitrary one. `partner_recovery_deductions` is the
 * record, unique on (recovery, payout) — a second bite at the same balance on the same transfer
 * is a bug, not a top-up, and the database says so.
 *
 * ## Idempotent, because `retotalPayout` runs often
 *
 * Every accrual, close and correction lands here. A deduction already recorded against this
 * payout is skipped by the unique index, and the amounts are recomputed from the balances rather
 * than accumulated — so running it twice leaves the same figure.
 */
async function applyRecoveries(tx: Database, payoutId: string): Promise<void> {
  const payout = await tx.execute<{
    partner_id: string;
    currency_id: string;
    gross_amount: string;
    fine_amount: string;
    status: string;
  }>(sql`
    SELECT partner_id::text, currency_id::text,
           gross_amount::text, fine_amount::text, status::text
      FROM partner_payouts
     WHERE id = ${payoutId} AND deleted_at IS NULL
  `);

  const row = payout.rows[0];

  /* Paid or cancelled: frozen by trigger, and money already sent is not ours to restate. */
  if (!row || row.status === 'paid' || row.status === 'cancelled') return;

  /* Already released by `retotalPayout`, along with the fines — see the note there. */
  const outstanding = await tx.execute<{ id: string; left: string }>(sql`
    SELECT id::text, (amount - recovered_amount)::text AS left
      FROM partner_recoveries
     WHERE partner_id = ${row.partner_id}
       AND currency_id = ${row.currency_id}
       AND settled_at IS NULL
       AND amount > recovered_amount
     ORDER BY created_at
  `);

  if (outstanding.rows.length === 0) return;

  let headroom =
    toMinor(row.gross_amount, MONEY_SCALE) - toMinor(row.fine_amount, MONEY_SCALE);

  if (headroom <= 0n) return;

  let taken = 0n;

  for (const recovery of outstanding.rows) {
    if (headroom <= 0n) break;

    const left = toMinor(recovery.left, MONEY_SCALE);
    const take = left > headroom ? headroom : left;

    if (take <= 0n) continue;

    const amount = fromMinor(take, MONEY_SCALE);

    await tx.execute(sql`
      INSERT INTO partner_recovery_deductions (recovery_id, payout_id, amount)
      VALUES (${recovery.id}, ${payoutId}, ${amount})
    `);
    await tx.execute(sql`
      UPDATE partner_recoveries
         SET recovered_amount = recovered_amount + ${amount}::numeric,
             settled_at = CASE
               WHEN recovered_amount + ${amount}::numeric >= amount THEN now()
               ELSE NULL
             END,
             updated_at = now()
       WHERE id = ${recovery.id}
    `);

    headroom -= take;
    taken += take;
  }

  if (taken <= 0n) return;

  await tx.execute(sql`
    UPDATE partner_payouts
       SET recovery_amount = ${fromMinor(taken, MONEY_SCALE)},
           net_amount = gross_amount - fine_amount - ${fromMinor(taken, MONEY_SCALE)}::numeric,
           updated_at = now()
     WHERE id = ${payoutId}
  `);
}
