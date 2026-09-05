import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  SAFRA_REVENUE_ACCOUNTS,
  last4,
  type SafraPayoutAccountInput,
  type SafraPayoutAccountUpdateInput,
  type SafraPayoutOpenInput,
  type SafraPayoutPaidInput,
  type SafraPayoutReasonInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { actorName } from '../common/actor-name.sql.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Revenue SAFRA actually EARNED, as opposed to revenue it merely booked.
 *
 * ## The ledger is deliberately gross, and reading it as net is the bug this closes
 *
 * A booking payment credits the three revenue accounts at CAPTURE. A later refund does not debit
 * them: it debits the separate contra account and credits wherever the money went back to. That is
 * a consistent choice and the partner side makes the same one — partner_payable stands at 36.4
 * billion credited against 48 million ever paid, because a partner payout does not read that
 * balance, it selects bookings whose status is completed.
 *
 * So the credits on these accounts are GROSS booking revenue, and the first version of this
 * service read them as earned revenue. On the live data that overstated what SAFRA could withdraw
 * by 1,984,534,890 SYP across 9,547 bookings — fifty-seven per cent of everything accrued — and
 * the figure a finance officer would have acted on is the one that moves money out of a real bank
 * account. A screen that says two point nine billion is collectable when one point nine eight of
 * it went back to customers is worse than a screen with no figure at all.
 *
 * ## Only a refund of the WHOLE total disqualifies a booking
 *
 * The two refund paths differ exactly here, and the difference is deliberate:
 *
 *   - An ordinary cancellation refunds a percentage of base_amount and KEEPS the service fee,
 *     which refund.service.ts describes as earned when the booking is made. The customer got a
 *     booking and gave it up, so the fee stands and this predicate leaves it alone.
 *   - A section 6.4 full refund returns total_amount, fee included, because the partner never
 *     answered and the stay never existed. Its own comment says keeping the fee would mean SAFRA
 *     profits from its own partner failure. Nothing was earned, so nothing is withdrawable.
 *
 * The comparison is therefore against total_amount and not against zero: a half refund must still
 * leave its fee accrued, which is what the test asserts rather than assumes.
 *
 * ## Advertising revenue has no booking, and must survive this
 *
 * ad_revenue entries carry a null booking_id. Without the first branch they would all be filtered
 * out and the ad business would silently vanish from SAFRA's own revenue.
 *
 * What this does NOT decide is the partial case: a booking refunded 50% of base still carries
 * 100% of the partner commission. Whether SAFRA keeps a full commission on half a stay is a
 * business question, not an engineering one, and it is recorded in FUTURE-WORK rather than
 * answered here.
 *
 * ## An anti-join, because the correlated form missed the budget
 *
 * Written first as a correlated NOT EXISTS, it re-ran the refund lookup once per ledger row and
 * measured 566 ms — over the 200 ms a request is allowed. Aggregating the refunds ONCE and
 * hash-joining measures 78 ms on the same data. Both figures were measured, not estimated.
 *
 * The join and the predicate below travel together: the join is pointless without the predicate
 * and the predicate does not compile without the join, so both queries take both.
 */
const REFUNDED_JOIN = sql`
  LEFT JOIN (
    SELECT r.booking_id
      FROM refunds r
      JOIN bookings b ON b.id = r.booking_id
     WHERE r.status = 'completed'
       AND r.deleted_at IS NULL
     GROUP BY r.booking_id, b.total_amount
    HAVING sum(r.amount) >= b.total_amount
  ) refunded ON refunded.booking_id = e.booking_id
`;

/**
 * Keeps only what SAFRA earned — and after 2026-09-05, only for the SERVICE FEE.
 *
 * Bashar decided that a booking whose stay price went back in full gives up its partner
 * commission, and that the fee keeps its existing behaviour. Those are two different thresholds,
 * so they cannot both be a filter here:
 *
 *   - The COMMISSION is now reversed IN THE LEDGER when cumulative refunds reach `base_amount`
 *     (`LedgerService.reverseCommissionIfFullyRefunded`), so its balance is already net and
 *     filtering it here as well would subtract the same money twice.
 *   - The FEE is not reversed anywhere, and is only unearned in the §6.4 case where the whole
 *     `total_amount` went back. That is the case `REFUNDED_JOIN` matches, so the filter stays —
 *     for that one account.
 *
 * A null booking_id is advertising revenue and is always earned.
 */
const EARNED = sql`
  AND (e.account::text <> 'safra_commission_customer' OR refunded.booking_id IS NULL)
`;

/**
 * Which debits are a TRANSFER, as opposed to revenue given back.
 *
 * Before the commission reversal existed, every debit on a revenue account was a payout, so
 * "transferred" could simply sum them. It cannot any more: a reversal debits the same account, and
 * counting it as transferred would report money SAFRA had taken out when the truth is the exact
 * opposite — money it stopped being owed.
 *
 * ## The mark is in the LEDGER, not in the payouts table
 *
 * The first version joined `safra_payouts` on `entry_group_id` and asked whether a row was there.
 * That made the classification depend on a row OUTSIDE the ledger: deleting a payout would leave
 * its debits behind and silently reclassify them as reversals, turning transfers into revenue
 * write-offs. The test suite proved it by clearing the table in a fixture, and accrued went
 * negative for a reason that had nothing to do with any refund.
 *
 * A transfer group always credits `safra_payout`; a reversal group credits `refund`. That fact is
 * intrinsic to the entry group and survives anything happening to other tables, so it is what the
 * question is asked of. The subquery is a small distinct set — `safra_payout` has one row per
 * transfer — so it hashes once rather than probing per row.
 */
const PAYOUT_JOIN = sql`
  LEFT JOIN (
    SELECT DISTINCT entry_group_id
      FROM ledger_entries
     WHERE account = 'safra_payout'
  ) xfer ON xfer.entry_group_id = e.entry_group_id
`;

/** A transfer out. Everything else debited from a revenue account is revenue given back. */
const IS_TRANSFER = sql`xfer.entry_group_id IS NOT NULL`;

export interface SafraPayoutAccountRow {
  readonly id: string;
  readonly label: string;
  readonly method: string;
  readonly accountHolder: string;
  readonly last4: string;
  readonly bankName: string | null;
  readonly swiftCode: string | null;
  readonly currency: string;
  readonly isDefault: boolean;
  readonly isActive: boolean;
  readonly status: 'pending' | 'verified' | 'rejected';
  readonly createdBy: string | null;
  readonly verifiedAt: string | null;
  readonly verifiedBy: string | null;
  readonly rejectedAt: string | null;
  readonly rejectionReason: string | null;
  /** Transfers already sent to it — what makes deactivating a visible decision. */
  readonly payouts: number;
}

export interface SafraRevenueSummary {
  /** Everything the three revenue accounts have ever been credited, in SYP. */
  readonly accrued: string;
  /** Everything a paid SAFRA payout has debited from them, in SYP. */
  readonly transferred: string;
  /** The difference — money SAFRA has earned and not yet collected. */
  readonly outstanding: string;
  readonly byAccount: readonly {
    account: string;
    accrued: string;
    transferred: string;
  }[];
}

/**
 * SAFRA's own treasury: where its revenue is collected, and the transfers that collect it.
 *
 * ## What was missing
 *
 * `safra_commission_partner`, `safra_commission_customer` and `ad_revenue` accrue as CREDITS and
 * **nothing ever debited them**. The books recorded what SAFRA had earned and had no concept of
 * what it had taken out, and no configuration named the account its money should reach. Partners
 * have had both since 2026-09-04. Bashar, 2026-09-05: *"I want the Super Admin to be able to fully
 * manage where SAFRA's own earnings are collected, just as partners can manage where their
 * earnings are paid."*
 *
 * ## Outstanding is DERIVED, never stored
 *
 * `accrued − transferred`, both read from the ledger. A stored balance would be a second source of
 * truth about money, and the two would eventually disagree — at which point neither could be
 * trusted. This way the summary is a question the books answer, and a payout that was reversed
 * shows up in it automatically.
 *
 * ## Only payment writes the ledger
 *
 * Opening and releasing are INTENT. Posting a movement for them would record money leaving that has
 * not left — the same rule `PayoutService` follows for partners, and for the same reason. Marking
 * paid debits each revenue account for its share and credits `safra_payout` for the total, in one
 * balanced group the payout row points at.
 *
 * ## The two flows cannot be confused
 *
 * Separate tables, separate permissions, separate error codes, separate references (`SPY-` against
 * `PYT-`). A partner payout cannot reference a SAFRA destination and a SAFRA payout cannot
 * reference a partner's — not by convention, by type.
 */
@Injectable()
export class SafraPayoutService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly crypto: FieldEncryptionService,
    private readonly ledger: LedgerService,
  ) {}

  // ── Destinations ──────────────────────────────────────────────────────────

  /**
   * Every destination, masked.
   *
   * The ciphertext is NOT selected — not "not returned", not selected. A projection that reads a
   * column it does not need is one refactor away from returning it, and this is the column whose
   * exposure would be worst.
   */
  async accounts(): Promise<SafraPayoutAccountRow[]> {
    const rows = await this.db.execute<{
      id: string;
      label: string;
      method: string;
      account_holder: string;
      account_number_last4: string;
      bank_name: string | null;
      swift_code: string | null;
      currency: string;
      is_default: boolean;
      is_active: boolean;
      status: 'pending' | 'verified' | 'rejected';
      created_by: string | null;
      verified_at: string | null;
      verified_by: string | null;
      rejected_at: string | null;
      rejection_reason: string | null;
      payouts: number;
    }>(sql`
      SELECT a.id::text, a.label, a.method, a.account_holder, a.account_number_last4,
             a.bank_name, a.swift_code, cur.code AS currency,
             a.is_default, a.is_active, a.status::text,
             ${actorName(sql`cu.email`, sql`cu.role`)} AS created_by,
             a.verified_at::text,
             ${actorName(sql`vu.email`, sql`vu.role`)} AS verified_by,
             a.rejected_at::text, a.rejection_reason,
             (SELECT count(*)::int FROM safra_payouts p
               WHERE p.payout_account_id = a.id AND p.deleted_at IS NULL) AS payouts
      FROM safra_payout_accounts a
      JOIN currencies cur ON cur.id = a.currency_id
      LEFT JOIN users cu ON cu.id = a.created_by_user_id
      LEFT JOIN users vu ON vu.id = a.verified_by_user_id
      WHERE a.deleted_at IS NULL
      ORDER BY a.is_default DESC, a.created_at DESC
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      label: row.label,
      method: row.method,
      accountHolder: row.account_holder,
      last4: row.account_number_last4,
      bankName: row.bank_name,
      swiftCode: row.swift_code,
      currency: row.currency,
      isDefault: row.is_default,
      isActive: row.is_active,
      status: row.status,
      createdBy: row.created_by,
      verifiedAt: row.verified_at,
      verifiedBy: row.verified_by,
      rejectedAt: row.rejected_at,
      rejectionReason: row.rejection_reason,
      payouts: row.payouts,
    }));
  }

  async createAccount(
    claims: AccessTokenClaims | undefined,
    input: SafraPayoutAccountInput,
  ): Promise<{ id: string }> {
    const currency = await this.currencyId(input.currency);

    const id = await this.db.transaction(async (tx) => {
      const created = await tx.execute<{ id: string }>(sql`
        INSERT INTO safra_payout_accounts
          (label, method, account_holder, account_number_encrypted, account_number_last4,
           bank_name, swift_code, currency_id, created_by_user_id)
        VALUES (${input.label}, ${input.method}, ${input.accountHolder},
                ${this.crypto.encrypt(input.accountNumber)}, ${last4(input.accountNumber)},
                ${input.bankName ?? null}, ${input.swiftCode || null},
                ${currency}, ${claims?.sub ?? null})
        RETURNING id::text
      `);

      const row = created.rows[0];

      if (!row) throw new Error('SAFRA payout account insert returned no row.');

      /*
        The masked form only. An audit trail that carried the number would be the one place the
        ciphertext protects nothing — `payout-account.service.ts` learned that on 2026-09-04.
      */
      await this.record(tx, claims, 'safra_payout_account.created', row.id, undefined, {
        label: input.label,
        method: input.method,
        accountHolder: input.accountHolder,
        last4: last4(input.accountNumber),
        bankName: input.bankName ?? null,
      });

      return row.id;
    });

    return { id };
  }

  async updateAccount(
    claims: AccessTokenClaims | undefined,
    id: string,
    input: SafraPayoutAccountUpdateInput,
  ): Promise<void> {
    const before = await this.requireAccount(id);

    await this.db.transaction(async (tx) => {
      /*
        Making THIS one the default clears the others first.

        The partial unique index would otherwise reject the update — correctly — and the operator
        would meet a constraint violation instead of a screen that did what they asked. Clearing
        inside the same transaction is what makes «set as default» a single atomic act.
      */
      if (input.isDefault === true) {
        await tx.execute(sql`
          UPDATE safra_payout_accounts SET is_default = false, updated_at = now()
          WHERE is_default AND deleted_at IS NULL AND id <> ${id}::uuid
        `);
      }

      await tx.execute(sql`
        UPDATE safra_payout_accounts SET
          label          = coalesce(${input.label ?? null}, label),
          account_holder = coalesce(${input.accountHolder ?? null}, account_holder),
          bank_name      = coalesce(${input.bankName ?? null}, bank_name),
          is_default     = coalesce(${input.isDefault ?? null}, is_default),
          is_active      = coalesce(${input.isActive ?? null}, is_active),
          updated_at     = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout_account.updated',
        id,
        {
          label: before.label,
          isDefault: before.is_default,
          isActive: before.is_active,
          last4: before.account_number_last4,
        },
        { ...input, last4: before.account_number_last4 },
      );
    });
  }

  /** Verification is what makes an account eligible to receive anything. */
  async verifyAccount(claims: AccessTokenClaims | undefined, id: string): Promise<void> {
    const before = await this.requireAccount(id);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE safra_payout_accounts
        SET status = 'verified', verified_at = now(), verified_by_user_id = ${claims?.sub ?? null},
            rejected_at = NULL, rejected_by_user_id = NULL, rejection_reason = NULL,
            updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout_account.verified',
        id,
        { status: before.status },
        { status: 'verified', label: before.label, last4: before.account_number_last4 },
      );
    });
  }

  async rejectAccount(
    claims: AccessTokenClaims | undefined,
    id: string,
    input: SafraPayoutReasonInput,
  ): Promise<void> {
    const before = await this.requireAccount(id);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE safra_payout_accounts
        SET status = 'rejected', rejected_at = now(), rejected_by_user_id = ${claims?.sub ?? null},
            rejection_reason = ${input.reason},
            verified_at = NULL, verified_by_user_id = NULL,
            /* A rejected destination stops being the default: nothing may fall back to it. */
            is_default = false,
            updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout_account.rejected',
        id,
        { status: before.status },
        { status: 'rejected', reason: input.reason, last4: before.account_number_last4 },
      );
    });
  }

  /**
   * Removes a destination nothing has been sent to.
   *
   * Soft, and refused once a payout points at it: the transfer's own record names the account it
   * went to, and removing that row would leave a paid transfer pointing at nothing. Deactivating
   * is the answer for one that has been used, which is why `isActive` exists separately.
   */
  async removeAccount(claims: AccessTokenClaims | undefined, id: string): Promise<void> {
    const before = await this.requireAccount(id);

    const used = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM safra_payouts WHERE payout_account_id = ${id}::uuid
    `);

    if ((used.rows[0]?.n ?? 0) > 0) {
      throw conflict(ERROR.CATALOGUE_IN_USE, { count: used.rows[0]?.n ?? 0 });
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE safra_payout_accounts
        SET deleted_at = now(), is_default = false, updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(tx, claims, 'safra_payout_account.deleted', id, {
        label: before.label,
        last4: before.account_number_last4,
      });
    });
  }

  // ── Revenue ───────────────────────────────────────────────────────────────

  /**
   * What SAFRA has earned, taken out, and is still owed to itself.
   *
   * Read from the ledger in one pass. `accrued` is the credits on the three revenue accounts and
   * `transferred` is the debits — and because ONLY a paid SAFRA payout debits them, the difference
   * is exactly the money the platform has earned and not yet collected.
   *
   * In SYP, because `amount_syp` is what every entry carries whatever currency it arrived in, and
   * because a total across five currencies is not a number anybody can bank.
   */
  async revenueSummary(): Promise<SafraRevenueSummary> {
    const rows = await this.db.execute<{
      account: string;
      accrued: string;
      transferred: string;
    }>(sql`
      SELECT e.account::text AS account,
             (coalesce(sum(e.amount_syp) FILTER (WHERE e.direction = 'credit'), 0)
              - coalesce(sum(e.amount_syp)
                  FILTER (WHERE e.direction = 'debit' AND NOT ${IS_TRANSFER}), 0))::text AS accrued,
             coalesce(sum(e.amount_syp)
               FILTER (WHERE e.direction = 'debit' AND ${IS_TRANSFER}), 0)::text AS transferred
      FROM ledger_entries e
      ${REFUNDED_JOIN}
      ${PAYOUT_JOIN}
      WHERE e.account::text IN ${SAFRA_REVENUE_ACCOUNTS}
        ${EARNED}
      GROUP BY e.account
      ORDER BY e.account
    `);

    const total = (pick: (row: { accrued: string; transferred: string }) => string) =>
      rows.rows.reduce((sum, row) => sum + Number(pick(row)), 0).toFixed(2);

    const accrued = total((row) => row.accrued);
    const transferred = total((row) => row.transferred);

    return {
      accrued,
      transferred,
      outstanding: (Number(accrued) - Number(transferred)).toFixed(2),
      byAccount: rows.rows.map((row) => ({
        account: row.account,
        accrued: Number(row.accrued).toFixed(2),
        transferred: Number(row.transferred).toFixed(2),
      })),
    };
  }

  // ── Transfers ─────────────────────────────────────────────────────────────

  async payouts() {
    const rows = await this.db.execute<{
      id: string;
      reference: string;
      period_start: string;
      period_end: string;
      commission_partner_amount: string;
      commission_customer_amount: string;
      ad_revenue_amount: string;
      net_amount: string;
      status: string;
      account_label: string | null;
      account_last4: string | null;
      scheduled_for: string | null;
      paid_at: string | null;
      paid_reference: string | null;
      hold_reason: string | null;
      entry_group_id: string | null;
      notes: string | null;
    }>(sql`
      SELECT p.id::text, p.reference, p.period_start::text, p.period_end::text,
             p.commission_partner_amount::text, p.commission_customer_amount::text,
             p.ad_revenue_amount::text, p.net_amount::text, p.status::text,
             a.label AS account_label, a.account_number_last4 AS account_last4,
             p.scheduled_for::text, p.paid_at::text, p.paid_reference, p.hold_reason,
             p.entry_group_id::text, p.notes
      FROM safra_payouts p
      LEFT JOIN safra_payout_accounts a ON a.id = p.payout_account_id
      WHERE p.deleted_at IS NULL
      ORDER BY p.period_end DESC, p.created_at DESC
    `);

    return rows.rows.map((row) => ({
      id: row.id,
      reference: row.reference,
      periodStart: row.period_start,
      periodEnd: row.period_end,
      commissionPartner: row.commission_partner_amount,
      commissionCustomer: row.commission_customer_amount,
      adRevenue: row.ad_revenue_amount,
      netAmount: row.net_amount,
      status: row.status,
      accountLabel: row.account_label,
      accountLast4: row.account_last4,
      scheduledFor: row.scheduled_for,
      paidAt: row.paid_at,
      paidReference: row.paid_reference,
      holdReason: row.hold_reason,
      entryGroupId: row.entry_group_id,
      notes: row.notes,
    }));
  }

  /**
   * Opens a transfer for a period, computing what it settles from the ledger.
   *
   * Two refusals, and both are about the same thing. **Overlapping periods** would settle the same
   * revenue twice — the books would balance and the money would leave twice. **Nothing accrued**
   * would open a transfer of zero, which is a row that looks like a payment and is not one.
   */
  async open(claims: AccessTokenClaims | undefined, input: SafraPayoutOpenInput) {
    const clash = await this.db.execute<{ reference: string }>(sql`
      SELECT reference FROM safra_payouts
      WHERE deleted_at IS NULL AND status <> 'cancelled'
        AND period_start <= ${input.periodEnd}::date
        AND period_end   >= ${input.periodStart}::date
      LIMIT 1
    `);

    if (clash.rows[0]) {
      throw conflict(ERROR.SAFRA_PAYOUT_PERIOD_OVERLAP, {
        reference: clash.rows[0].reference,
      });
    }

    const accrued = await this.accruedIn(input.periodStart, input.periodEnd);

    if (Number(accrued.net) <= 0) throw badRequest(ERROR.SAFRA_PAYOUT_NOTHING_ACCRUED);

    const id = await this.db.transaction(async (tx) => {
      const created = await tx.execute<{ id: string; reference: string }>(sql`
        INSERT INTO safra_payouts
          (period_start, period_end, commission_partner_amount, commission_customer_amount,
           ad_revenue_amount, net_amount, notes,
           /* The default destination at the moment of opening — changeable until it is paid. */
           payout_account_id)
        VALUES (${input.periodStart}::date, ${input.periodEnd}::date,
                ${accrued.commissionPartner}, ${accrued.commissionCustomer},
                ${accrued.adRevenue}, ${accrued.net}, ${input.notes ?? null},
                (SELECT id FROM safra_payout_accounts
                  WHERE is_default AND is_active AND status = 'verified' AND deleted_at IS NULL
                  LIMIT 1))
        RETURNING id::text, reference
      `);

      const row = created.rows[0];

      if (!row) throw new Error('SAFRA payout insert returned no row.');

      await this.record(tx, claims, 'safra_payout.opened', row.id, undefined, {
        reference: row.reference,
        periodStart: input.periodStart,
        periodEnd: input.periodEnd,
        net: accrued.net,
      });

      return row.id;
    });

    return { id };
  }

  /** Approves it for transfer. Moves no money — that is what `markPaid` is for. */
  async release(claims: AccessTokenClaims | undefined, id: string): Promise<void> {
    const payout = await this.requirePayout(id);

    if (payout.status !== 'pending_release' && payout.status !== 'on_hold') {
      throw conflict(ERROR.SAFRA_PAYOUT_NOT_RELEASABLE);
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE safra_payouts
        SET status = 'scheduled', released_at = now(),
            released_by_user_id = ${claims?.sub ?? null}, hold_reason = NULL, updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout.released',
        id,
        { status: payout.status },
        { status: 'scheduled', reference: payout.reference, net: payout.net_amount },
      );
    });
  }

  /**
   * The transfer happened. **The only method here that writes the ledger.**
   *
   * ## The destination is re-read and re-checked
   *
   * Not trusted from the row that opened the payout. Opening and paying are days apart and an
   * account can be rejected, deactivated or removed in between — the same reasoning that made
   * `PayoutService` re-check a partner's at payment on 2026-09-04, and the reason Bashar's rule
   * names BOTH verbs: *"a payout must never be released or marked as paid without an active
   * verified payout account."*
   *
   * ## The entry group
   *
   * One debit per revenue stream that contributed, and one credit to `safra_payout` for the total.
   * Zero streams are omitted rather than posted as zero — an entry of nothing is noise in a ledger
   * somebody reads. The group balances by construction: the credit is the sum of the debits.
   */
  async markPaid(
    claims: AccessTokenClaims | undefined,
    id: string,
    input: SafraPayoutPaidInput,
  ): Promise<void> {
    const payout = await this.requirePayout(id);

    if (payout.status !== 'scheduled') throw conflict(ERROR.SAFRA_PAYOUT_NOT_PAYABLE);

    const destination = await this.db.execute<{
      id: string;
      label: string;
      last4: string;
    }>(sql`
      SELECT a.id::text, a.label, a.account_number_last4 AS last4
      FROM safra_payout_accounts a
      JOIN safra_payouts p ON p.payout_account_id = a.id
      WHERE p.id = ${id}::uuid
        AND a.is_active AND a.status = 'verified' AND a.deleted_at IS NULL
      LIMIT 1
    `);

    const account = destination.rows[0];

    if (!account) throw conflict(ERROR.SAFRA_PAYOUT_NO_DESTINATION);

    /*
      One SYP leg per stream that contributed anything — in EITHER direction.

      A stream can now come out negative over a period: the commission reversals booked in it can
      exceed the commission earned in it, which is what happens in a month with more refunds than
      new bookings. Such a stream is a CREDIT of its absolute value rather than a dropped row, and
      the difference is not cosmetic — dropping it left the debits short of the `net_amount`
      credited to `safra_payout`, and the deferred balance trigger would have rejected the whole
      transfer at COMMIT with a database error instead of a refusal anybody could read.

      Debits minus credits across the streams equals the net, which the single `safra_payout` leg
      then credits, so the group balances whichever way a stream went.
    */
    const legs = (
      [
        ['safra_commission_partner', payout.commission_partner_amount],
        ['safra_commission_customer', payout.commission_customer_amount],
        ['ad_revenue', payout.ad_revenue_amount],
      ] as const
    )
      .filter(([, amount]) => Number(amount) !== 0)
      .map(([account_, amount]) => ({
        account: account_,
        direction: Number(amount) > 0 ? ('debit' as const) : ('credit' as const),
        amount: Number(amount) > 0 ? amount : String(Math.abs(Number(amount)).toFixed(2)),
        description: `SAFRA payout ${payout.reference}`,
      }));

    const syp = await this.sypCurrencyId();

    await this.db.transaction(async (tx) => {
      const { entryGroupId } = await this.ledger.post(
        tx as unknown as Database,
        [
          ...legs,
          {
            account: 'safra_payout',
            direction: 'credit',
            amount: payout.net_amount,
            description: `SAFRA payout ${payout.reference}`,
          },
        ],
        {
          currencyId: syp,
          /* Already SYP: the ledger multiplies by this to fill `amount_syp`. */
          fxRateToSyp: '1',
          createdByUserId: claims?.sub,
        },
      );

      await tx.execute(sql`
        UPDATE safra_payouts
        SET status = 'paid', paid_at = now(), paid_by_user_id = ${claims?.sub ?? null},
            paid_reference = ${input.paidReference}, entry_group_id = ${entryGroupId},
            updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout.paid',
        id,
        { status: payout.status },
        {
          status: 'paid',
          reference: payout.reference,
          net: payout.net_amount,
          paidReference: input.paidReference,
          /* WHERE it went, masked — the question an auditor asks first. */
          destination: `${account.label} ····${account.last4}`,
          entryGroupId,
        },
      );
    });
  }

  async hold(
    claims: AccessTokenClaims | undefined,
    id: string,
    input: SafraPayoutReasonInput,
  ): Promise<void> {
    const payout = await this.requirePayout(id);

    if (payout.status === 'paid' || payout.status === 'cancelled') {
      throw conflict(ERROR.SAFRA_PAYOUT_ALREADY_FINAL);
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE safra_payouts
        SET status = 'on_hold', hold_reason = ${input.reason}, updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout.held',
        id,
        { status: payout.status },
        { status: 'on_hold', reason: input.reason, reference: payout.reference },
      );
    });
  }

  /** Cancels one. A paid transfer cannot be cancelled — that would be a reversal, not a decision. */
  async cancel(
    claims: AccessTokenClaims | undefined,
    id: string,
    input: SafraPayoutReasonInput,
  ): Promise<void> {
    const payout = await this.requirePayout(id);

    if (payout.status === 'paid' || payout.status === 'cancelled') {
      throw conflict(ERROR.SAFRA_PAYOUT_ALREADY_FINAL);
    }

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE safra_payouts
        SET status = 'cancelled', hold_reason = ${input.reason}, updated_at = now()
        WHERE id = ${id}::uuid
      `);

      await this.record(
        tx,
        claims,
        'safra_payout.cancelled',
        id,
        { status: payout.status },
        { status: 'cancelled', reason: input.reason, reference: payout.reference },
      );
    });
  }

  // ── Shared ────────────────────────────────────────────────────────────────

  /**
   * What the three revenue accounts were CREDITED inside a period.
   *
   * Credits only. A debit inside the window is a previous payout's own settlement, and counting it
   * would net a transfer against the revenue it collected — so a second payout over an overlapping
   * period would compute a smaller figure and look plausible. The overlap refusal is what actually
   * prevents that; this filter is what stops the number lying if it ever fails.
   */
  private async accruedIn(from: string, to: string) {
    const rows = await this.db.execute<{ account: string; total: string }>(sql`
      SELECT e.account::text AS account,
             (coalesce(sum(e.amount_syp) FILTER (WHERE e.direction = 'credit'), 0)
              - coalesce(sum(e.amount_syp)
                  FILTER (WHERE e.direction = 'debit' AND NOT ${IS_TRANSFER}), 0))::text AS total
      FROM ledger_entries e
      ${REFUNDED_JOIN}
      ${PAYOUT_JOIN}
      WHERE e.account::text IN ${SAFRA_REVENUE_ACCOUNTS}
        ${EARNED}
        AND e.created_at >= ${from}::date
        AND e.created_at < (${to}::date + INTERVAL '1 day')
      GROUP BY e.account
    `);

    const of = (account: string) =>
      Number(rows.rows.find((row) => row.account === account)?.total ?? 0).toFixed(2);

    const commissionPartner = of('safra_commission_partner');
    const commissionCustomer = of('safra_commission_customer');
    const adRevenue = of('ad_revenue');

    return {
      commissionPartner,
      commissionCustomer,
      adRevenue,
      net: (
        Number(commissionPartner) +
        Number(commissionCustomer) +
        Number(adRevenue)
      ).toFixed(2),
    };
  }

  private async requireAccount(id: string) {
    const rows = await this.db.execute<{
      id: string;
      label: string;
      status: string;
      is_default: boolean;
      is_active: boolean;
      account_number_last4: string;
    }>(sql`
      SELECT id::text, label, status::text, is_default, is_active, account_number_last4
      FROM safra_payout_accounts WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.SAFRA_PAYOUT_ACCOUNT_NOT_FOUND);

    return row;
  }

  private async requirePayout(id: string) {
    const rows = await this.db.execute<{
      id: string;
      reference: string;
      status: string;
      net_amount: string;
      commission_partner_amount: string;
      commission_customer_amount: string;
      ad_revenue_amount: string;
    }>(sql`
      SELECT id::text, reference, status::text, net_amount::text,
             commission_partner_amount::text, commission_customer_amount::text,
             ad_revenue_amount::text
      FROM safra_payouts WHERE id = ${id}::uuid AND deleted_at IS NULL LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.SAFRA_PAYOUT_NOT_FOUND);

    return row;
  }

  /** SYP is the ledger's denomination — `geo.currency_accounting` forbids removing it. */
  private async sypCurrencyId(): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM currencies WHERE code = 'SYP' LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row)
      throw new Error('SYP currency row is missing; the ledger cannot be posted.');

    return row.id;
  }

  private async currencyId(code: string): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id::text FROM currencies WHERE code = ${code} AND deleted_at IS NULL LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw badRequest(ERROR.GEO_CURRENCY_UNKNOWN);

    return row.id;
  }

  /** One audit call, so all ten writes record the same way and none can forget. */
  private async record(
    tx: unknown,
    claims: AccessTokenClaims | undefined,
    action: string,
    subjectId: string,
    before?: Record<string, unknown>,
    after?: Record<string, unknown>,
  ): Promise<void> {
    await this.audit.record(
      {
        actorUserId: claims?.sub,
        actorRole: claims?.role,
        action,
        subjectType: action.startsWith('safra_payout_account')
          ? 'safra_payout_account'
          : 'safra_payout',
        subjectId,
        ...(before ? { before } : {}),
        ...(after ? { after } : {}),
      },
      tx as Database,
    );
  }
}
