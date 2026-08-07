import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, PERMISSIONS as P } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

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
  ) {}

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
   * Recomputes a payout's total from its items.
   *
   * Only ever called while the payout is open — the paid-immutability trigger refuses it
   * afterwards, which is the point: a total is frozen the moment money moves.
   */
  private async retotal(tx: Database, payoutId: string): Promise<void> {
    await tx.execute(sql`
      UPDATE partner_payouts p
      SET gross_amount = coalesce(i.total, 0),
          net_amount = coalesce(i.total, 0) - p.fine_amount,
          updated_at = now()
      FROM (
        SELECT coalesce(sum(amount), 0) AS total
        FROM partner_payout_items WHERE payout_id = ${payoutId}
      ) i
      WHERE p.id = ${payoutId}
    `);
  }

  /** Closes the open period so its total stops moving and a human can look at it. */
  async close(payoutId: string, claims: AccessTokenClaims | undefined): Promise<void> {
    const payout = await this.require(payoutId);

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
    const payout = await this.require(payoutId);

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

    const account = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM partner_payout_accounts
      WHERE partner_id = ${payout.partner_id} AND deleted_at IS NULL
      ORDER BY is_primary DESC, created_at ASC
      LIMIT 1
    `);

    await this.db.execute(sql`
      UPDATE partner_payouts
      SET status = 'scheduled',
          scheduled_for = ${input.scheduledFor}::date,
          released_at = now(),
          released_by_user_id = ${claims?.sub ?? null},
          payout_account_id = ${account.rows[0]?.id ?? null},
          notes = ${input.notes ?? null},
          updated_at = now()
      WHERE id = ${payoutId}
    `);

    await this.record(claims, 'partner_payout.released', payoutId, {
      reference: payout.reference,
      net: payout.net_amount,
      scheduledFor: input.scheduledFor,
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
    const payout = await this.require(payoutId);

    if (payout.status !== 'scheduled') {
      throw conflict(ERROR.PAYOUT_NOT_SCHEDULED);
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
    const payout = await this.require(payoutId);

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
    const payout = await this.require(payoutId);

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
    const payout = await this.require(payoutId);

    if (payout.status === 'paid') throw conflict(ERROR.PAYOUT_ALREADY_PAID);
    if (payout.status === 'cancelled') throw conflict(ERROR.PAYOUT_ALREADY_FINAL);

    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`DELETE FROM partner_payout_items WHERE payout_id = ${payoutId}`,
      );
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

  /** One payout's covered bookings, for the partner who owns it. */
  async itemsForPartner(reference: string, claims: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(claims, P.PAYOUT_READ_OWN);

    const rows = await this.db.execute<{
      booking_reference: string;
      amount: string;
      check_in: string;
      check_out: string;
      property: string;
    }>(sql`
      SELECT b.reference AS booking_reference, i.amount::text AS amount,
             b.check_in::text, b.check_out::text,
             coalesce(pr.name_ar, pr.name_en) AS property
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
      checkIn: row.check_in,
      checkOut: row.check_out,
      property: row.property,
    }));
  }

  private async require(payoutId: string): Promise<PayoutRow> {
    const rows = await this.db.execute<PayoutRow>(sql`
      ${PAYOUT_SELECT}
      WHERE p.id = ${payoutId} AND p.deleted_at IS NULL
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_NOT_FOUND);

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
  reference: string;
  partner_id: string;
  currency_id: string;
  currency_code: string;
  fx_rate_to_syp: string;
  period_start: string;
  period_end: string;
  gross_amount: string;
  fine_amount: string;
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
const PAYOUT_SELECT = sql`
  SELECT p.id, p.reference, p.partner_id, p.currency_id, cur.code AS currency_code,
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
         p.gross_amount::text, p.fine_amount::text, p.net_amount::text,
         p.status::text AS status,
         p.scheduled_for::text, p.released_at::text, p.paid_at::text,
         p.paid_reference, p.hold_reason,
         (SELECT count(*)::int FROM partner_payout_items i WHERE i.payout_id = p.id) AS item_count,
         pa.display_name AS partner_name
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
