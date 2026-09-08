import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  DEFAULT_SANCTIONS_POLICY,
  ERROR,
  PERMISSIONS as P,
  SANCTIONS_POLICY_SETTING,
  isSanctionsPolicy,
  type OffsetPage,
  type PageQuery,
  type SanctionsPolicy,
  offsetPage,
} from '@safra/contracts';

import { fromMinor, MONEY_SCALE, toMinor } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import { actorName } from '../common/actor-name.sql.js';

/**
 * Partner payouts — the record of money SAFRA has actually sent, or committed to send.
 *
 * ## What this is not
 *
 * It is not a view over `bookings.partner_payable_amount`. That column is an obligation per
 * booking and the ledger already tracks the total through its `partner_payable` account. A payout
 * is a distinct event with its own lifecycle, and conflating the two would let the partner
 * dashboard tell somebody a transfer is scheduled when nothing has been decided. See the note on
 * the `partner_payouts` table.
 *
 * ## Which bookings are payable, and when
 *
 * A booking joins the accruing payout when all four hold:
 *
 *  1. it is `completed` — the stay happened, so the partner has earned it;
 *  2. it was paid, so there is money to pass on;
 *  3. it is not already on a payout, enforced by a unique index rather than by this query;
 *  4. it has no dispute that is `open` or `investigating`.
 *
 * The fourth is the handoff's freeze rule and the console states it on every unresolved dispute.
 * It is expressed here as the same DERIVED query `DisputeService` uses — never a flag on the
 * booking, because a flag and the disputes can disagree and then money moves on the stale one.
 *
 * ## Every transition is audited, and only payment touches the ledger
 *
 * Accruing and releasing move no money; posting a ledger movement for them would put an intention
 * in the books. Payment posts one balanced movement — DEBIT `partner_payable`, CREDIT
 * `partner_payout` — and the payout stores its `entry_group_id`, so the two reconcile in both
 * directions.
 */
@Injectable()
export class PayoutService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly ledger: LedgerService,
    private readonly settings: SettingsService,
  ) {}

  /** How hard sanctions screening bites. Same reader and same fallback as `ReviewService`. */
  private async sanctionsPolicy(): Promise<SanctionsPolicy> {
    const raw = await this.settings.get<unknown>(
      SANCTIONS_POLICY_SETTING,
      DEFAULT_SANCTIONS_POLICY,
    );

    return isSanctionsPolicy(raw) ? raw : DEFAULT_SANCTIONS_POLICY;
  }

  /**
   * Attaches every newly-payable booking to its partner's open period, creating one if needed.
   *
   * Idempotent by construction: the unique index on `partner_payout_items.booking_id` means a
   * booking already attached cannot be attached twice, whatever this query returns. Running it
   * twice in a row is a no-op rather than a double payment.
   *
   * Returns what it did, so a scheduled job can log something meaningful.
   */
  async accrue(): Promise<{ attached: number; payouts: number }> {
    return this.db.transaction(async (tx) => {
      /*
        One statement for the whole platform rather than a loop per partner. `ON CONFLICT DO
        NOTHING` against the partial unique index is what makes concurrent runs safe: two workers
        both trying to open a period for one partner leaves exactly one.
      */
      await tx.execute(sql`
        INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end)
        SELECT DISTINCT b.partner_id, b.currency_id,
               date_trunc('month', now())::date,
               (date_trunc('month', now()) + interval '1 month - 1 day')::date
        FROM bookings b
        WHERE b.status = 'completed'
          AND b.paid_at IS NOT NULL
          AND b.deleted_at IS NULL
          AND b.partner_payable_amount > 0
          AND NOT EXISTS (SELECT 1 FROM partner_payout_items i WHERE i.booking_id = b.id)
          AND NOT EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.booking_id = b.id
              AND d.status IN ('open', 'investigating')
              AND d.deleted_at IS NULL
          )
          AND NOT EXISTS (
            SELECT 1 FROM partner_payouts p
            WHERE p.partner_id = b.partner_id AND p.currency_id = b.currency_id
              AND p.status = 'accruing' AND p.deleted_at IS NULL
          )
        ON CONFLICT DO NOTHING
      `);

      const attached = await tx.execute<{ payout_id: string }>(sql`
        INSERT INTO partner_payout_items (payout_id, booking_id, amount)
        SELECT p.id, b.id, b.partner_payable_amount
        FROM bookings b
        JOIN partner_payouts p
          ON p.partner_id = b.partner_id
         AND p.currency_id = b.currency_id
         AND p.status = 'accruing'
         AND p.deleted_at IS NULL
        WHERE b.status = 'completed'
          AND b.paid_at IS NOT NULL
          AND b.deleted_at IS NULL
          AND b.partner_payable_amount > 0
          AND NOT EXISTS (SELECT 1 FROM partner_payout_items i WHERE i.booking_id = b.id)
          AND NOT EXISTS (
            SELECT 1 FROM disputes d
            WHERE d.booking_id = b.id
              AND d.status IN ('open', 'investigating')
              AND d.deleted_at IS NULL
          )
        ON CONFLICT (booking_id) DO NOTHING
        RETURNING payout_id
      `);

      const touched = new Set(attached.rows.map((row) => row.payout_id));

      // The same cast `SlaService` uses for `wallet.credit` — a drizzle transaction is a
      // `Database` for every purpose these helpers use, but the two types are not assignable.
      for (const payoutId of touched) {
        await this.retotal(tx as unknown as Database, payoutId);
      }

      return { attached: attached.rows.length, payouts: touched.size };
    });
  }

  /**
   * Recomputes a payout's total from its items, and takes off what the partner owes back.
   *
   * Only ever called while the payout is open — the paid-immutability trigger refuses it
   * afterwards, which is the point: a total is frozen the moment money moves.
   */
  private async retotal(tx: Database, payoutId: string): Promise<void> {
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

    /*
      Release BOTH, then apply both. The order inside each half matters and so does this one.

      Releasing first makes the whole thing a recomputation: `retotal` runs on every accrual and
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
    await this.releaseRecoveries(tx, payoutId);
    await this.releaseFines(tx, payoutId);

    await this.applyRecoveries(tx, payoutId);
    await this.applyFines(tx, payoutId);
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
   * ## Idempotent, because `retotal` runs often
   *
   * The applications are cleared and re-decided rather than accumulated, so the answer depends only
   * on what is outstanding now. `releaseFines` is the other half, and cancellation uses it too.
   */
  private async applyFines(tx: Database, payoutId: string): Promise<void> {
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

    /* Already released by `retotal`, along with the recoveries — see the note there. */
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
  private async releaseFines(tx: Database, payoutId: string): Promise<void> {
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
   * Called by `retotal` before anything is applied, which is what makes the whole thing a
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
  private async releaseRecoveries(tx: Database, payoutId: string): Promise<void> {
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
   * ## Idempotent, because `retotal` runs often
   *
   * Every accrual, close and correction lands here. A deduction already recorded against this
   * payout is skipped by the unique index, and the amounts are recomputed from the balances rather
   * than accumulated — so running it twice leaves the same figure.
   */
  private async applyRecoveries(tx: Database, payoutId: string): Promise<void> {
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

    /* Already released by `retotal`, along with the fines — see the note there. */
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

  /** Closes the open period so its total stops moving and a human can look at it. */
  async close(payoutId: string, claims: AccessTokenClaims | undefined): Promise<void> {
    const payout = await this.require(payoutId, claims);

    if (payout.status !== 'accruing') {
      throw conflict(ERROR.PAYOUT_NOT_ACCRUING);
    }

    await this.db.execute(sql`
      UPDATE partner_payouts SET status = 'pending_release', updated_at = now()
      WHERE id = ${payoutId}
    `);

    await this.record(claims, 'partner_payout.closed', payoutId, {
      reference: payout.reference,
      net: payout.net_amount,
    });
  }

  /**
   * Releases a payout for transfer on a date — the handoff's "مجدول يوم الخميس".
   *
   * The payout account is PINNED here rather than read at payment time: a partner who changes
   * their bank details afterwards must not make the record say the money went somewhere it did
   * not.
   */
  async release(
    payoutId: string,
    input: { scheduledFor: string; notes?: string | undefined },
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const payout = await this.require(payoutId, claims);

    if (payout.status !== 'pending_release') {
      throw conflict(ERROR.PAYOUT_NOT_RELEASABLE);
    }

    if (Number(payout.net_amount) <= 0) {
      throw badRequest(ERROR.PAYOUT_NOTHING_TO_PAY);
    }

    /*
      Re-checked at release, not only at accrual. A dispute opened between the two would otherwise
      release money the freeze rule says is frozen — and release is the last moment anybody looks.
    */
    const frozen = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM partner_payout_items i
      JOIN disputes d ON d.booking_id = i.booking_id
      WHERE i.payout_id = ${payoutId}
        AND d.status IN ('open', 'investigating')
        AND d.deleted_at IS NULL
    `);

    if ((frozen.rows[0]?.n ?? 0) > 0) {
      throw conflict(ERROR.PAYOUT_FROZEN_BY_DISPUTE);
    }

    /*
      A SUSPENDED partner's payouts are frozen (Bashar, 2026-08-24), and checked HERE for the same
      reason the dispute freeze is: release is the last moment anybody looks.

      Suspension can land between accrual and release — that is the ordinary case, not the edge one,
      since a payout accrues over a period and a suspension happens on a day. Checking only at
      accrual would release money the policy freezes, for the partner who was suspended most
      recently.

      A CONFLICT rather than a refusal to exist: the money is still owed and the period is still
      correct. It is held, and it releases when the suspension is lifted — which is what the
      portal's «مجمّدة» tells the partner, in those terms.
    */
    const suspended = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n
      FROM partner_payouts po
      JOIN partners pa ON pa.id = po.partner_id
      WHERE po.id = ${payoutId} AND pa.suspended_at IS NOT NULL
    `);

    if ((suspended.rows[0]?.n ?? 0) > 0) {
      throw conflict(ERROR.PAYOUT_FROZEN_BY_SUSPENSION);
    }

    /*
      Sanctions screening, checked HERE and not only at partner approval (Bashar, 2026-08-21).

      This is where the EU asset-freeze prohibition actually applies: it forbids making funds or
      economic resources available to a designated person, and approval makes nothing available —
      release does. A partner approved in January and designated in June passed the only check the
      platform had, and passed it months before the designation existed.

      So the control moved to the point where money moves, and it is re-read on every release for
      the same reason the dispute freeze above is: release is the last moment anybody looks.

      Under `advisory` and `off` this refuses nothing. It exists so that turning the policy to
      `required` protects the payment, rather than only the paperwork.
    */
    if ((await this.sanctionsPolicy()) === 'required') {
      const screened = await this.db.execute<{ screened: boolean }>(sql`
        SELECT sanctions_screened_at IS NOT NULL AS screened
        FROM partners WHERE id = ${payout.partner_id} AND deleted_at IS NULL
      `);

      if (screened.rows[0]?.screened !== true) {
        throw conflict(ERROR.PAYOUT_PARTNER_NOT_SCREENED);
      }
    }

    /*
      WHERE the money is going, and a refusal when the platform cannot say (Bashar, 2026-09-04):
      «A payout must never be released or marked as paid unless it is linked to an active,
      verified payout account.»

      This was `?? null` against a query with no status filter, over a table that had never been
      written to — so every release recorded a transfer with no destination, and on 2026-09-04
      seventy-six of them had one. `?? null` is the shape the rule exists to forbid: it reads as
      handled and it releases money into a field nobody filled in.

      `status = 'verified'` and `deleted_at IS NULL` together are the "active, verified" of the
      instruction. `is_primary DESC` still decides between two verified accounts, but it is now a
      preference among valid answers rather than the only thing standing between a release and an
      arbitrary row.
    */
    const account = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payout_accounts
      WHERE partner_id = ${payout.partner_id}
        AND deleted_at IS NULL
        AND status = 'verified'
      ORDER BY is_primary DESC, verified_at DESC, created_at ASC
      LIMIT 1
    `);

    const accountId = account.rows[0]?.id;

    if (!accountId) throw conflict(ERROR.PAYOUT_NO_VERIFIED_ACCOUNT);

    await this.db.execute(sql`
      UPDATE partner_payouts
      SET status = 'scheduled',
          scheduled_for = ${input.scheduledFor}::date,
          released_at = now(),
          released_by_user_id = ${claims?.sub ?? null},
          payout_account_id = ${accountId},
          notes = ${input.notes ?? null},
          updated_at = now()
      WHERE id = ${payoutId}
    `);

    await this.record(claims, 'partner_payout.released', payoutId, {
      reference: payout.reference,
      net: payout.net_amount,
      scheduledFor: input.scheduledFor,
      /* The trail says where, not only how much — an id, never the account's own details. */
      payoutAccountId: accountId,
    });
  }

  /**
   * Records that the transfer happened, and posts the movement that discharges the payable.
   *
   * This is the only method that writes the ledger. Everything before it is intent.
   */
  async markPaid(
    payoutId: string,
    input: { paidReference: string },
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const payout = await this.require(payoutId, claims);

    if (payout.status !== 'scheduled') {
      throw conflict(ERROR.PAYOUT_NOT_SCHEDULED);
    }

    /*
      The destination is re-checked HERE, and not taken on trust from the release.

      Bashar's rule names both verbs — released OR marked as paid — and the second is not implied
      by the first. Release and payment are separated by days: in that gap the partner can edit
      their details, which returns the account to `pending`, or staff can remove it. A payout
      scheduled against an account that has since changed is exactly the case somebody would
      engineer, and re-reading costs one indexed lookup on a path that already writes the ledger.

      It reads the payout's OWN `payout_account_id` rather than looking the partner's accounts up
      again. Any other row would be a different destination from the one that was released, and
      silently paying into it is the failure, not the fix.
    */
    const destination = await this.db.execute<{ ok: boolean }>(sql`
      SELECT (a.status = 'verified' AND a.deleted_at IS NULL) AS ok
      FROM partner_payouts po
      JOIN partner_payout_accounts a ON a.id = po.payout_account_id
      WHERE po.id = ${payoutId}
    `);

    if (destination.rows[0]?.ok !== true) {
      throw conflict(ERROR.PAYOUT_ACCOUNT_UNVERIFIED_AT_PAYMENT);
    }

    await this.db.transaction(async (tx) => {
      const { entryGroupId } = await this.ledger.post(
        tx as unknown as Database,
        [
          {
            account: 'partner_payable',
            direction: 'debit',
            amount: payout.net_amount,
            description: `Payout ${payout.reference}`,
          },
          {
            account: 'partner_payout',
            direction: 'credit',
            amount: payout.net_amount,
            description: `Payout ${payout.reference}`,
          },
        ],
        {
          currencyId: payout.currency_id,
          fxRateToSyp: payout.fx_rate_to_syp,
          partnerId: payout.partner_id,
          createdByUserId: claims?.sub,
        },
      );

      await tx.execute(sql`
        UPDATE partner_payouts
        SET status = 'paid',
            paid_at = now(),
            paid_by_user_id = ${claims?.sub ?? null},
            paid_reference = ${input.paidReference},
            entry_group_id = ${entryGroupId},
            updated_at = now()
        WHERE id = ${payoutId}
      `);
    });

    await this.record(claims, 'partner_payout.paid', payoutId, {
      reference: payout.reference,
      net: payout.net_amount,
      paidReference: input.paidReference,
    });
  }

  /** Freezes a payout, with a reason the partner and the next operator can both read. */
  async hold(
    payoutId: string,
    input: { reason: string },
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const payout = await this.require(payoutId, claims);

    if (payout.status === 'paid' || payout.status === 'cancelled') {
      throw conflict(ERROR.PAYOUT_ALREADY_FINAL);
    }

    await this.db.execute(sql`
      UPDATE partner_payouts
      SET status = 'on_hold', hold_reason = ${input.reason},
          scheduled_for = NULL, updated_at = now()
      WHERE id = ${payoutId}
    `);

    await this.record(claims, 'partner_payout.held', payoutId, {
      reference: payout.reference,
      reason: input.reason,
    });
  }

  /** Lifts a hold, returning the payout to the queue rather than straight to scheduled. */
  async release_hold(
    payoutId: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const payout = await this.require(payoutId, claims);

    if (payout.status !== 'on_hold') throw conflict(ERROR.PAYOUT_NOT_HELD);

    await this.db.execute(sql`
      UPDATE partner_payouts
      SET status = 'pending_release', hold_reason = NULL, updated_at = now()
      WHERE id = ${payoutId}
    `);

    await this.record(claims, 'partner_payout.hold_lifted', payoutId, {
      reference: payout.reference,
    });
  }

  /**
   * Abandons a payout before payment. Its bookings return to accrual.
   *
   * The items are deleted and the payout row survives with its amounts, so the decision stays on
   * record while the bookings become payable again — the unique index on `booking_id` is what
   * required this shape, and it is the right one: a booking is covered by at most one LIVE payout.
   */
  async cancel(
    payoutId: string,
    input: { reason: string },
    claims: AccessTokenClaims | undefined,
  ): Promise<void> {
    const payout = await this.require(payoutId, claims);

    if (payout.status === 'paid') throw conflict(ERROR.PAYOUT_ALREADY_PAID);
    if (payout.status === 'cancelled') throw conflict(ERROR.PAYOUT_ALREADY_FINAL);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM partner_payout_items WHERE payout_id = ${payoutId}`,
      );

      /*
        And put back any balance this transfer was going to collect.

        Cancelling returns the bookings to accrual, so it has to return the RECOVERIES too — a
        balance left marked as collected against a transfer that never happened is a partner's debt
        disappearing and SAFRA absorbing it. Before the items are gone and before the status is
        final, because `applyRecoveries` refuses to touch a cancelled payout.
      */
      await this.releaseRecoveries(tx as unknown as Database, payoutId);
      await this.releaseFines(tx as unknown as Database, payoutId);

      await tx.execute(sql`
        UPDATE partner_payouts
        SET status = 'cancelled', notes = ${input.reason}, scheduled_for = NULL,
            updated_at = now()
        WHERE id = ${payoutId}
      `);
    });

    await this.record(claims, 'partner_payout.cancelled', payoutId, {
      reference: payout.reference,
      reason: input.reason,
    });
  }

  /**
   * The signed-in partner's own payouts.
   *
   * Scoped to the token's `partnerId`. There is no overload that takes one, so a partner cannot
   * ask about another's transfers.
   */
  async listForPartner(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<PayoutRow>(sql`
      ${PAYOUT_SELECT}
      WHERE p.partner_id = ${partnerId} AND p.deleted_at IS NULL
      ORDER BY p.created_at DESC
      LIMIT 50
    `);

    return rows.rows.map(toView);
  }

  /**
   * What this partner still owes back, and which stay each balance came from.
   *
   * ## Why the partner sees it at all
   *
   * Bashar, 2026-09-07: «The outstanding recovery amount should be visible to finance, operations
   * and the partner.» A deduction they cannot see is the defect this platform keeps finding on the
   * other side of every money question — the console knew a figure and the business whose money it
   * was did not.
   *
   * So the balance is theirs to read BEFORE it is taken, not explained afterwards by a smaller
   * transfer. The booking reference is included because a debt with no cause cannot be disputed,
   * and the guest is not named: the partner is a party to the money, not to the refund.
   *
   * ## Settled ones are left out
   *
   * A recovery that has been collected in full is history and belongs with the transfer that took
   * it — which is where `recoveryAmount` on each payout says so. Listing them here would put a
   * permanent list of past debts on the screen a partner opens to see what they are owed.
   */
  async recoveriesForPartner(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<{
      booking_reference: string;
      amount: string;
      recovered: string;
      outstanding: string;
      currency_code: string;
      created_at: string;
    }>(sql`
      SELECT b.reference AS booking_reference,
             r.amount::text AS amount,
             r.recovered_amount::text AS recovered,
             (r.amount - r.recovered_amount)::text AS outstanding,
             cur.code AS currency_code,
             r.created_at::text AS created_at
        FROM partner_recoveries r
        JOIN bookings b ON b.id = r.booking_id
        JOIN currencies cur ON cur.id = r.currency_id
       WHERE r.partner_id = ${partnerId}
         AND r.settled_at IS NULL
         AND r.amount > r.recovered_amount
       ORDER BY r.created_at
       LIMIT 100
    `);

    return rows.rows.map((row) => ({
      bookingReference: row.booking_reference,
      amount: row.amount,
      recovered: row.recovered,
      outstanding: row.outstanding,
      currencyCode: row.currency_code,
      createdAt: row.created_at,
    }));
  }

  /**
   * Fines this partner still owes, and how much of each has been taken.
   *
   * ## Why the partner sees it
   *
   * Bashar, 2026-09-07: «Finance, operations and the partner should be able to see the outstanding
   * fine balance and how deductions are applied over time.» A deduction met only as a smaller
   * transfer is the asymmetry this review keeps finding.
   *
   * ## Separate from the recoveries endpoint, by instruction
   *
   * «Keep fines and recoveries as separate concepts and separate balances.» Two calls and two
   * panels, because a partner reading «$40 taken» is entitled to know whether they were penalised
   * or corrected — and a fine, unlike a recovery, can be appealed and waived.
   *
   * ## Only what was actually imposed
   *
   * `stage IN ('fined', 'suspension')` and not waived, the same predicate the collection uses. A
   * violation still at `recorded` has not been fined, and showing it as an outstanding balance
   * would tell a partner they owe a penalty nobody has levied.
   */
  async finesForPartner(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<{
      kind: string;
      booking_reference: string | null;
      amount: string;
      collected: string;
      outstanding: string;
      currency_code: string;
      created_at: string;
      reason: string | null;
    }>(sql`
      SELECT v.kind::text AS kind,
             b.reference AS booking_reference,
             v.fine_amount::text AS amount,
             v.fine_collected_amount::text AS collected,
             (v.fine_amount - v.fine_collected_amount)::text AS outstanding,
             cur.code AS currency_code,
             v.created_at::text AS created_at,
             v.fine_reason AS reason
        FROM partner_violations v
        JOIN currencies cur ON cur.id = v.fine_currency_id
        LEFT JOIN bookings b ON b.id = v.booking_id
       WHERE v.partner_id = ${partnerId}
         AND v.deleted_at IS NULL
         AND v.waived_at IS NULL
         AND v.collected_at IS NULL
         AND v.stage IN ('fined', 'suspension')
         AND v.fine_amount IS NOT NULL
         AND v.fine_amount > v.fine_collected_amount
       ORDER BY v.created_at
       LIMIT 100
    `);

    return rows.rows.map((row) => ({
      kind: row.kind,
      bookingReference: row.booking_reference,
      amount: row.amount,
      collected: row.collected,
      outstanding: row.outstanding,
      currencyCode: row.currency_code,
      createdAt: row.created_at,
      reason: row.reason,
    }));
  }

  /**
   * The partner's own money that a dispute is holding back.
   *
   * ## Why this exists
   *
   * A booking under an open dispute is silently excluded from accrual: the partner's payable
   * simply does not appear, with no figure and no list. The payouts page states the RULE — «أي حجز
   * عليه نزاع مفتوح يبقى مجمّدًا» — and could not say how much or on which stays. Meanwhile the
   * console shows SAFRA «مستحقات مجمّدة: 19». One side of a money question could see the answer
   * and the side whose money it is could not.
   *
   * ## What it deliberately does NOT return
   *
   * Not the customer's name and not what they wrote. The partner is a party to the money and is
   * owed an account of it; whether they should also read the complaint and answer it is a product
   * decision about partner participation in disputes, and inventing one here would be answering a
   * question nobody asked. The dispute REFERENCE is included so support can be given a handle.
   */
  async withheldForPartner(claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<{
      reference: string;
      check_in: string;
      check_out: string;
      amount: string;
      currency_code: string;
      dispute_reference: string;
      dispute_kind: string;
      dispute_status: string;
      responses: number;
      opened_at: string;
      payout_reference: string | null;
    }>(sql`
      SELECT b.reference,
             b.check_in::text  AS check_in,
             b.check_out::text AS check_out,
             b.partner_payable_amount::text AS amount,
             cur.code AS currency_code,
             d.reference AS dispute_reference,
             /*
               WHY the money is held, and WHAT has to happen before it moves (Bashar, 2026-09-08:
               «I want the partner to be able to understand … why the money is frozen. What event
               must occur before the funds are released.»).

               The reference alone was a lookup task: a partner read «DSP-034388» and had to go and
               find out what it alleged and how far along it was. The kind says what the complaint
               is, the status says whether anybody has picked it up, and the response COUNT says
               whether the release is waiting on THEM — which is the one part of this they can act
               on. (No backticks in this comment: they would end the sql template.)
             */
             d.kind::text   AS dispute_kind,
             d.status::text AS dispute_status,
             (SELECT count(*)::int FROM dispute_responses r WHERE r.dispute_id = d.id) AS responses,
             d.created_at::text AS opened_at,
             /*
               The payout this booking is BLOCKING, where there is one. That is the fact the
               partner most needs: one disputed stay refuses the whole transfer, not just its own
               share, and a list of amounts without it would understate what is actually held.
             */
             (SELECT po.reference
                FROM partner_payout_items i
                JOIN partner_payouts po ON po.id = i.payout_id
               WHERE i.booking_id = b.id
                 AND po.deleted_at IS NULL
                 AND po.status NOT IN ('paid', 'cancelled')
               LIMIT 1) AS payout_reference
      FROM bookings b
      JOIN currencies cur ON cur.id = b.currency_id
      JOIN disputes d
        ON d.booking_id = b.id
       AND d.status IN ('open', 'investigating')
       AND d.deleted_at IS NULL
      WHERE b.partner_id = ${partnerId}
        AND ${HELD_BY_DISPUTE}
      ORDER BY d.created_at
      LIMIT 100
    `);

    return rows.rows.map((row) => ({
      reference: row.reference,
      disputeKind: row.dispute_kind,
      disputeStatus: row.dispute_status,
      responseCount: row.responses,
      checkIn: row.check_in,
      checkOut: row.check_out,
      amount: row.amount,
      currencyCode: row.currency_code,
      disputeReference: row.dispute_reference,
      openedAt: row.opened_at,
      payoutReference: row.payout_reference,
    }));
  }

  /**
   * What the last accrual reported, so the endpoint can answer with it.
   *
   * Read back from `scheduled_job_runs` rather than returned by `accrue`, because the caller may
   * have SKIPPED — another replica or a concurrent manual run held the lock — and in that case the
   * honest answer is what the run that did happen achieved, not a zero from the one that did not.
   */
  async latestAccrual(): Promise<{ attached: number; payouts: number }> {
    const row = await this.db.execute<{
      detail: { attached?: number; payouts?: number } | null;
    }>(sql`
      SELECT detail FROM scheduled_job_runs
      WHERE job = 'payout-accrual' AND status = 'completed'
      ORDER BY started_at DESC LIMIT 1
    `);

    return {
      attached: row.rows[0]?.detail?.attached ?? 0,
      payouts: row.rows[0]?.detail?.payouts ?? 0,
    };
  }

  /**
   * The staff registry of payouts (§9.3).
   *
   * Paginated with `OFFSET` and a capped count, like every other console registry — the standing
   * "Tables and pagination" rule, including the part that matters most here: the count and the list
   * share ONE `FROM … WHERE` fragment. A total that disagrees with the table it sits under is bad
   * anywhere; over a list of transfers it is somebody reconciling against a figure that was never
   * true.
   *
   * `PAYOUT_READ`, not `PAYOUT_EXECUTE`. Looking at what SAFRA owes and has sent is finance's daily
   * work; moving the money is a separate decision with a separate permission.
   */
  async listForStaff(
    query: PageQuery & { status?: string | undefined; q?: string | undefined },
    claims: AccessTokenClaims | undefined,
  ): Promise<OffsetPage<ReturnType<typeof toView>>> {
    /* Scoped by the PARTNER's city — see `require`. A read, so the predicate is the whole guard. */
    const conditions = [sql`p.deleted_at IS NULL`, scopeFilter(claims, 'pa.city_id')];

    if (query.status) {
      conditions.push(sql`p.status = ${query.status}::payout_status`);
    }

    if (query.q) {
      const term = `%${query.q}%`;

      conditions.push(
        sql`(p.reference ILIKE ${query.q + '%'}
             OR pa.display_name ILIKE ${term}
             OR pa.legal_name ILIKE ${term}
             OR p.paid_reference ILIKE ${term})`,
      );
    }

    // One fragment, shared by the list and the count. See the note above.
    const fromWhere = sql`
      FROM partner_payouts p
      JOIN currencies cur ON cur.id = p.currency_id
      JOIN partners pa    ON pa.id = p.partner_id
      WHERE ${sql.join(conditions, sql` AND `)}`;

    const [rows, counted] = await Promise.all([
      this.db.execute<PayoutRow>(sql`
        ${PAYOUT_COLUMNS}
        ${fromWhere}
        ORDER BY p.created_at DESC, p.id DESC
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(rows.rows.map(toView), counted, query);
  }

  /**
   * One payout, everything a person needs to answer for it (§9.3).
   *
   * Four things travel together on purpose, because each is useless without the others when
   * somebody asks "why was this partner sent this amount":
   *
   * - the payout itself;
   * - the BOOKINGS it covers, which is what the amount is made of;
   * - the AUDIT trail — who released it, who marked it paid, and when;
   * - the LEDGER movement it discharged, which is what makes the books and this table reconcilable
   *   in both directions rather than merely consistent-looking.
   *
   * The ledger entries are read through the payout's own `entry_group_id`, so a payout that claims
   * to be paid and has no movement behind it shows an empty list rather than a plausible one. That
   * is the reconciliation failure worth surfacing, and a check constraint already makes it
   * impossible to create — this is what proves the constraint is still doing its job.
   */
  async detailForStaff(reference: string, claims: AccessTokenClaims | undefined) {
    const rows = await this.db.execute<
      PayoutRow & { entry_group_id: string | null; payout_account_id: string | null }
    >(sql`
      ${PAYOUT_COLUMNS}, p.entry_group_id, p.payout_account_id
      FROM partner_payouts p
      JOIN currencies cur ON cur.id = p.currency_id
      JOIN partners pa    ON pa.id = p.partner_id
      WHERE p.reference = ${reference} AND p.deleted_at IS NULL
        AND ${scopeFilter(claims, 'pa.city_id')}
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_NOT_FOUND);

    /*
      WHERE this payout is going, masked (Bashar, 2026-09-04).

      Added when a browser run reached a scheduled payout and found that no screen said where the
      money was headed. The whole feature exists so that a transfer HAS a recorded destination, and
      a destination nobody can read is barely better than none — an operator reconciling a bank
      statement against «مجدول» had nothing on this screen to reconcile it with.

      Masked, like every other surface: the holder, the bank and the last four. The ciphertext is
      not selected here for the same reason it is not selected anywhere else.
    */
    const destination = await this.db.execute<{
      method: string;
      account_holder: string;
      account_number_last4: string;
      bank_name: string | null;
      status: string;
    }>(sql`
      SELECT a.method, a.account_holder, a.account_number_last4, a.bank_name, a.status::text
      FROM partner_payout_accounts a
      WHERE a.id = ${row.payout_account_id}
    `);

    const items = await this.db.execute<{
      booking_reference: string;
      amount: string;
      check_in: string;
      check_out: string;
      property: string;
      refunded: string;
      booking_total: string;
    }>(sql`
      SELECT b.reference AS booking_reference, i.amount::text AS amount,
             b.check_in::text, b.check_out::text,
             coalesce(pr.name_ar, pr.name_en) AS property,
             /*
               WHAT THE GUEST GOT BACK on this booking.

               A payout line said «$613.80 owed» on a booking whose guest had been refunded $330,
               and no screen said so. The partner's payable is snapshotted when the booking is made
               and is never adjusted for a refund, so SAFRA absorbs the difference — which may be
               the intended commercial rule, but nobody at SAFRA could SEE it happening. This makes
               the margin question visible; it does not change who is paid.
             */
             coalesce((
               SELECT sum(r.amount) FROM refunds r
               WHERE r.booking_id = b.id
                 AND r.status = 'completed'
                 AND r.deleted_at IS NULL
             ), 0)::text AS refunded,
             b.total_amount::text AS booking_total
      FROM partner_payout_items i
      JOIN bookings b    ON b.id = i.booking_id
      JOIN properties pr ON pr.id = b.property_id
      WHERE i.payout_id = ${row.id}
      ORDER BY b.check_out DESC
    `);

    /*
      The audit trail, filtered to this payout's own subject id.

      `audit_log` is append-only by trigger, so this is the record of what happened rather than a
      summary somebody maintained alongside it. Read here rather than left to the audit screen
      because "who released this" is the first question asked about a transfer, and sending an
      operator to a different section with a search box is how it goes unasked.
    */
    const trail = await this.db.execute<{
      action: string;
      actor_email: string | null;
      actor_role: string | null;
      after: unknown;
      created_at: string;
    }>(sql`
      SELECT a.action, ${actorName(sql`u.email`, sql`u.role`)} AS actor_email,
             a.actor_role::text AS actor_role,
             a.after, a.created_at::text
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      WHERE a.subject_type = 'partner_payout' AND a.subject_id = ${row.id}
      ORDER BY a.created_at
    `);

    /* The movement the payment posted, or nothing — see the note on reconciliation above. */
    const ledger = row.entry_group_id
      ? await this.db.execute<{
          account: string;
          direction: string;
          amount: string;
          created_at: string;
        }>(sql`
          SELECT e.account::text, e.direction::text, e.amount::text, e.created_at::text
          FROM ledger_entries e
          WHERE e.entry_group_id = ${row.entry_group_id}
          ORDER BY e.direction DESC
        `)
      : { rows: [] };

    return {
      ...toView(row),
      /*
        The id, on the DETAIL response only.

        The action routes are keyed on it, so a screen that can only see the reference can display
        a payout and not act on it. It is deliberately absent from the list: a registry is a read,
        and handing every row an actionable identifier invites a client to build actions the
        detail screen is responsible for gating.
      */
      id: row.id,
      entryGroupId: row.entry_group_id,
      /* Null until the payout is released — before that there is no destination to name. */
      destination: destination.rows[0]
        ? {
            method: destination.rows[0].method,
            accountHolder: destination.rows[0].account_holder,
            last4: destination.rows[0].account_number_last4,
            bankName: destination.rows[0].bank_name,
            status: destination.rows[0].status,
          }
        : null,
      bookings: items.rows.map((item) => ({
        bookingReference: item.booking_reference,
        amount: item.amount,
        checkIn: item.check_in,
        checkOut: item.check_out,
        property: item.property,
        /* Zero on the ordinary line, so a reader can tell «nothing refunded» from «not known». */
        refunded: item.refunded,
        bookingTotal: item.booking_total,
      })),
      trail: trail.rows.map((entry) => ({
        action: entry.action,
        actorEmail: entry.actor_email,
        actorRole: entry.actor_role,
        after: entry.after,
        createdAt: entry.created_at,
      })),
      ledger: ledger.rows.map((entry) => ({
        account: entry.account,
        direction: entry.direction,
        amount: entry.amount,
        createdAt: entry.created_at,
      })),
    };
  }

  /**
   * The count for a page, over the SAME fragment the list uses.
   *
   * Capped at `COUNT_CAP` over a LIMIT-ed subquery so the database stops reading — an uncapped
   * `count(*)` is unbounded work on every page view of a table that only grows, which rule 2
   * forbids.
   */
  private async countOf(fromWhere: ReturnType<typeof sql>): Promise<number> {
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  /** One payout's covered bookings, for the partner who owns it. */
  async itemsForPartner(reference: string, claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<{
      booking_reference: string;
      amount: string;
      refunded: string;
      check_in: string;
      check_out: string;
      property: string;
    }>(sql`
      SELECT b.reference AS booking_reference, i.amount::text AS amount,
             b.check_in::text, b.check_out::text,
             coalesce(pr.name_ar, pr.name_en) AS property,
             /*
               What the GUEST got back, so the partner can account for a line worth less than the
               stay was. Since Bashar's 2026-09-07 rule the payable comes down in proportion to a
               refund, and a figure that moves without a reason beside it is what a partner rings
               support about. Completed refunds only: one still at the provider has returned
               nothing yet and has not moved this line.
             */
             coalesce((
               SELECT sum(r.amount) FROM refunds r
                WHERE r.booking_id = b.id
                  AND r.status = 'completed'
                  AND r.deleted_at IS NULL
             ), 0)::text AS refunded
      FROM partner_payout_items i
      JOIN partner_payouts p ON p.id = i.payout_id
      JOIN bookings b        ON b.id = i.booking_id
      JOIN properties pr     ON pr.id = b.property_id
      WHERE p.reference = ${reference} AND p.partner_id = ${partnerId} AND p.deleted_at IS NULL
      ORDER BY b.check_out DESC
    `);

    return rows.rows.map((row) => ({
      bookingReference: row.booking_reference,
      amount: row.amount,
      refunded: row.refunded,
      checkIn: row.check_in,
      checkOut: row.check_out,
      property: row.property,
    }));
  }

  /**
   * The payout an action names, IF this caller is scoped to reach it.
   *
   * ## The gap this closes (`O-sec-13`, 2026-08-27)
   *
   * Six `PAYOUT_EXECUTE` actions arrive here by id — close, release, mark paid, hold, lift the
   * hold, cancel — and this resolved the row for `p.id = $1` and nothing else. `markPaid` records
   * that money LEFT THE COMPANY, and `finance` has been in `SCOPED_RESOURCES` since scope was
   * built. A payout has no city of its own; it inherits one from its partner, which is the shape
   * `O-sec-13` names as «the easiest to miss» and the same one `liveViolation` had.
   *
   * `accrue` is deliberately not guarded: it is the scheduled sweep, it names no partner, and it
   * takes no actor.
   */
  private async require(
    payoutId: string,
    claims: AccessTokenClaims | undefined,
  ): Promise<PayoutRow> {
    const rows = await this.db.execute<PayoutRow>(sql`
      ${PAYOUT_SELECT}
      WHERE p.id = ${payoutId} AND p.deleted_at IS NULL
        AND ${scopeFilter(claims, 'pa.city_id')}
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_NOT_FOUND);

    /* `read_only` passes the predicate — it may look — and is refused here. */
    assertCanWrite(claims, row.city_id);

    return row;
  }

  /** One audit row per transition. Money moving without a record of who decided is the thing §15 forbids. */
  private async record(
    claims: AccessTokenClaims | undefined,
    action: string,
    payoutId: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action,
      subjectType: 'partner_payout',
      subjectId: payoutId,
      after: payload,
    });
  }
}

type PayoutRow = {
  id: string;
  /** The PARTNER's city — a payout has no city of its own. For the scope guard in `require`. */
  city_id: string | null;
  reference: string;
  partner_id: string;
  currency_id: string;
  currency_code: string;
  fx_rate_to_syp: string;
  period_start: string;
  period_end: string;
  gross_amount: string;
  fine_amount: string;
  recovery_amount: string;
  net_amount: string;
  status: string;
  scheduled_for: string | null;
  released_at: string | null;
  paid_at: string | null;
  paid_reference: string | null;
  hold_reason: string | null;
  item_count: number;
  partner_name: string | null;
};

/**
 * One projection, used by every read.
 *
 * `fx_rate_to_syp` comes from the CURRENT rate rather than the payout, because a payout has no
 * rate of its own until it is paid — and the ledger needs one to post the movement in SYP.
 */
const PAYOUT_COLUMNS = sql`
  SELECT p.id, p.reference, p.partner_id, pa.city_id::text AS city_id,
         p.currency_id, cur.code AS currency_code,
         -- The live rate for this currency against SYP. fx_rates is a PAIR table (base and
         -- quote), so the lookup names both; an earlier version read a currency_id column that
         -- does not exist, and every partner read failed on it.
         coalesce(
           (SELECT fx.rate::text FROM fx_rates fx
            JOIN currencies q ON q.id = fx.quote_currency_id
            WHERE fx.base_currency_id = p.currency_id AND q.code = 'SYP'
              AND fx.effective_from <= now()
            ORDER BY fx.effective_from DESC LIMIT 1),
           '1'
         ) AS fx_rate_to_syp,
         p.period_start::text, p.period_end::text,
         p.gross_amount::text, p.fine_amount::text, p.recovery_amount::text,
         p.net_amount::text,
         p.status::text AS status,
         p.scheduled_for::text, p.released_at::text, p.paid_at::text,
         p.paid_reference, p.hold_reason,
         (SELECT count(*)::int FROM partner_payout_items i WHERE i.payout_id = p.id) AS item_count,
         pa.display_name AS partner_name
`;

/**
 * The same projection with its `FROM` attached, for the reads that need no extra predicate.
 *
 * Split from the columns because a paginated read has to share ONE `FROM … WHERE` fragment between
 * its list and its count — see `listForStaff`. Keeping both shapes here means the column list is
 * still written once; a second copy is how a registry comes to disagree with its own detail screen.
 */
/**
 * A booking whose payable a dispute is holding — by EITHER of the two mechanisms.
 *
 * The freeze bites twice, and the first version of this only modelled the first:
 *
 *  1. **At accrual.** A completed booking with an open dispute is excluded, so its payable never
 *     joins a payout at all.
 *  2. **At release.** A booking already ON a payout when the dispute opens is caught by the
 *     re-check in `release`, which refuses the WHOLE payout with `PAYOUT_FROZEN_BY_DISPUTE`.
 *
 * The second is the one that matters more and the one nobody could see: on this database it is a
 * payout of $5,031.30 across seventeen bookings, six disputed, sitting «قيد التجميع» with nothing
 * on the partner's screen saying it cannot move or why.
 */
const HELD_BY_DISPUTE = sql`
  b.deleted_at IS NULL
  AND b.partner_payable_amount > 0
  AND EXISTS (
    SELECT 1 FROM disputes d
    WHERE d.booking_id = b.id
      AND d.status IN ('open', 'investigating')
      AND d.deleted_at IS NULL
  )
  AND (
    /*
      (1) Would have accrued, and did not.
      
      Keyed on completed_at, NOT on status = 'completed' — and that difference was a live defect.
      
      Opening a dispute sets bookings.status to 'disputed' (SS6.2 gives SAFRA that transition), so a
      completed stay that gets disputed stops matching status = 'completed' — which is the exact
      case this list exists for. The money is held, the accrual has correctly refused it, and the
      panel that explains the hold cannot see it.

      Found while building finding 209 on 2026-09-08. Proved by the test rather than by a row: the
      development database's two live disputes are both on stays that have not finished, so nothing
      was being hidden there and the panel was right to be empty — an earlier note in this comment
      claimed $130.20 was invisible and that was a misreading of the same query. What demonstrates
      it is partner-disputes.integration.test.ts, whose fixture is a stay that finished and was then
      disputed: with status = 'completed' here it vanishes from the list, with completed_at it does
      not.
      
      completed_at is the column the dispute's own close path trusts to put the booking back
      (restoreBookingStatus: completed_at IS NOT NULL then 'completed'), so it is the platform's
      existing answer to "had this stay finished" rather than a new one. It also cannot over-report:
      a booking disputed mid-stay has no completed_at, and its payable is not yet earned.
      
      The ACCRUAL above still keys on status = 'completed', which is correct there: a disputed
      booking must not accrue, and it excludes live disputes separately anyway.
    */
    (
      b.completed_at IS NOT NULL
      AND b.paid_at IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM partner_payout_items i WHERE i.booking_id = b.id)
    )
    /* (2) Already on a payout that has not been paid — it will refuse to release. */
    OR EXISTS (
      SELECT 1
      FROM partner_payout_items i
      JOIN partner_payouts po ON po.id = i.payout_id
      WHERE i.booking_id = b.id
        AND po.deleted_at IS NULL
        AND po.status NOT IN ('paid', 'cancelled')
    )
  )`;

const PAYOUT_SELECT = sql`
  ${PAYOUT_COLUMNS}
  FROM partner_payouts p
  JOIN currencies cur ON cur.id = p.currency_id
  JOIN partners pa    ON pa.id = p.partner_id
`;

function toView(row: PayoutRow) {
  return {
    reference: row.reference,
    partnerName: row.partner_name,
    currencyCode: row.currency_code,
    periodStart: row.period_start,
    periodEnd: row.period_end,
    grossAmount: row.gross_amount,
    fineAmount: row.fine_amount,
    /*
      An earlier overpayment being taken back (Bashar, 2026-09-07). Carried alongside the fine
      rather than added to it: finance reading «الغرامات: $186» about money that is not a penalty
      would be reading something untrue, and so would the partner.
    */
    recoveryAmount: row.recovery_amount,
    netAmount: row.net_amount,
    status: row.status,
    scheduledFor: row.scheduled_for,
    releasedAt: row.released_at,
    paidAt: row.paid_at,
    paidReference: row.paid_reference,
    holdReason: row.hold_reason,
    bookingCount: row.item_count,
  };
}
