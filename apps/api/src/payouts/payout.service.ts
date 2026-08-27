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
    const payout = await this.require(payoutId, claims);

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
    const rows = await this.db.execute<PayoutRow & { entry_group_id: string | null }>(sql`
      ${PAYOUT_COLUMNS}, p.entry_group_id
      FROM partner_payouts p
      JOIN currencies cur ON cur.id = p.currency_id
      JOIN partners pa    ON pa.id = p.partner_id
      WHERE p.reference = ${reference} AND p.deleted_at IS NULL
        AND ${scopeFilter(claims, 'pa.city_id')}
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.PAYOUT_NOT_FOUND);

    const items = await this.db.execute<{
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
      bookings: items.rows.map((item) => ({
        bookingReference: item.booking_reference,
        amount: item.amount,
        checkIn: item.check_in,
        checkOut: item.check_out,
        property: item.property,
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
         p.gross_amount::text, p.fine_amount::text, p.net_amount::text,
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
