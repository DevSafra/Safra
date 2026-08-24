import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  decodeCursor,
  encodeCursor,
  type CursorQuery,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export type Violation = {
  id: string;
  kind: string;
  occurrenceNumber: number;
  bookingReference: string | null;
  scorePenalty: number;
  /** Null for a reader without `payout.read_own` — see `list`. */
  fineAmount: string | null;
  fineCurrency: string | null;
  customerCompensationAmount: string | null;
  waived: boolean;
  waivedReason: string | null;
  collectedAt: string | null;
  createdAt: string;
  /**
   * How far this violation was taken, and what the partner was TOLD.
   *
   * All three were missing from the SELECT while the portal's schema defaulted them — so every
   * violation a partner opened reported the `recorded` stage whatever had really happened to it,
   * and the warning somebody wrote for them to read was never sent.
   */
  stage: string;
  warnedAt: string | null;
  warningNote: string | null;
  /** What happened, in the words of whoever recorded it. Null on rows predating 2026-08-24. */
  description: string | null;
  /** Why the fine was imposed. Withheld with the figures from a reader without `payout.read_own`. */
  fineReason: string | null;
};

export type ViolationPage = {
  items: Violation[];
  nextCursor: string | null;
  /** True when the money columns were withheld, so the screen says so rather than showing «—». */
  moneyHidden: boolean;
};

/**
 * المخالفات — what the partner has been penalised for, and why (SRS §6.4, §8.5).
 *
 * ## The capability existed and the screen did not
 *
 * `violation.read` was grantable and guarded nothing: a partner could hand a manager "see our
 * violations" and there was nowhere to see them. The record was written by the SLA sweep, read by
 * the console, and invisible to the business it was about — which is the wrong way round for a
 * penalty. Somebody being fined should not learn it from their payout being short.
 *
 * ## Money is withheld from a reader without `payout.read_own`
 *
 * A violation carries a FINE, and a fine is a figure about the business's money. `violation.read`
 * and `payout.read_own` are separate capabilities a partner grants separately, and the dashboard
 * already draws that line — `earnings` and the payout line are null without it. A violations screen
 * that printed the fine would be a way around that decision through a different door.
 *
 * What an employee without it still gets is everything the screen is FOR: what happened, when, how
 * many times, and what it cost in score. A manager can fix the operational problem without being
 * shown the invoice.
 *
 * `moneyHidden` rides on the page so the screen can say «الغرامات مخفية» rather than render three
 * «—» that read as "no fine". Absent money and zero money are different facts, and a column that
 * conflates them tells the reader the opposite of the truth.
 */
@Injectable()
export class ViolationsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * ONE violation, scoped to the partner in the verified token.
   *
   * ## The scope is the WHERE clause, and that is the whole security of this endpoint
   *
   * `id` comes from the URL. Checked afterwards, a partner could read any violation on the platform
   * by trying uuids — the record of another business's enforcement, including its fine. In the
   * predicate, the row is unreachable rather than merely unreturned, and a violation belonging to
   * somebody else answers exactly as a violation that does not exist: `VIOLATION_NOT_FOUND`. The
   * partner id is never a parameter; there is nowhere to pass one.
   *
   * ## Money obeys the same rule as the list
   *
   * `moneyHidden` withholds every figure, and now the fine's REASON with them, from a reader without
   * `payout.read_own` — an employee holds `violation.read` and not that. A detail screen is where a
   * narrower guard would be easiest to forget, so it reuses the list's own selector rather than
   * writing a second one.
   */
  async one(
    claims: AccessTokenClaims | undefined,
    partnerId: string,
    id: string,
  ): Promise<{ violation: Violation; moneyHidden: boolean }> {
    const money = (claims?.permissions ?? []).includes(P.PAYOUT_READ_OWN);

    const amounts = money
      ? sql`v.fine_amount::text, cur.code AS fine_currency,
            v.customer_compensation_amount::text`
      : sql`NULL::text AS fine_amount, NULL::text AS fine_currency,
            NULL::text AS customer_compensation_amount`;

    const rows = await this.db.execute<{
      id: string;
      kind: string;
      occurrence_number: number;
      booking_reference: string | null;
      score_penalty: number;
      fine_amount: string | null;
      fine_currency: string | null;
      customer_compensation_amount: string | null;
      waived_at: string | null;
      waived_reason: string | null;
      collected_at: string | null;
      created_at: string;
      stage: string;
      warned_at: string | null;
      warning_note: string | null;
      description: string | null;
      fine_reason: string | null;
    }>(sql`
      SELECT v.id, v.kind::text AS kind, v.occurrence_number,
             b.reference AS booking_reference, v.score_penalty, ${amounts},
             v.waived_at::text, v.waived_reason, v.collected_at::text,
             to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at,
             v.stage::text AS stage,
             to_char(v.warned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS warned_at,
             v.warning_note, v.description, v.fine_reason
      FROM partner_violations v
      LEFT JOIN bookings b ON b.id = v.booking_id
      LEFT JOIN currencies cur ON cur.id = v.fine_currency_id
      WHERE v.id = ${id}::uuid
        AND v.partner_id = ${partnerId}::uuid
        AND v.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.VIOLATION_NOT_FOUND);

    return {
      moneyHidden: !money,
      violation: {
        id: row.id,
        kind: row.kind,
        occurrenceNumber: row.occurrence_number,
        bookingReference: row.booking_reference,
        scorePenalty: row.score_penalty,
        fineAmount: row.fine_amount,
        fineCurrency: row.fine_currency,
        customerCompensationAmount: row.customer_compensation_amount,
        waived: row.waived_at !== null,
        waivedReason: row.waived_reason,
        collectedAt: row.collected_at,
        createdAt: row.created_at,
        stage: row.stage,
        warnedAt: row.warned_at,
        warningNote: row.warning_note,
        description: row.description,
        fineReason: money ? row.fine_reason : null,
      },
    };
  }

  async list(
    claims: AccessTokenClaims | undefined,
    partnerId: string,
    query: CursorQuery = { limit: 20 },
  ): Promise<ViolationPage> {
    const money = (claims?.permissions ?? []).includes(P.PAYOUT_READ_OWN);

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      /* A forged cursor shifts the window and never widens it — the partner id is not in it. */
      if (!decoded) throw badRequest(ERROR.REQUEST_CURSOR_INVALID);

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    const keyset = after
      ? sql`AND (v.created_at, v.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    /*
      The money columns are left OUT OF THE SELECT rather than nulled afterwards.

      Withholding by deleting fields from an object that already holds them is one forgotten spread
      away from leaking — and the leak is silent, because the shape still validates. If the value is
      never read from the database it cannot be returned by accident.
    */
    const amounts = money
      ? sql`v.fine_amount::text, cur.code AS fine_currency,
            v.customer_compensation_amount::text`
      : sql`NULL::text AS fine_amount, NULL::text AS fine_currency,
            NULL::text AS customer_compensation_amount`;

    const rows = await this.db.execute<{
      id: string;
      sort_key: string;
      kind: string;
      occurrence_number: number;
      booking_reference: string | null;
      score_penalty: number;
      fine_amount: string | null;
      fine_currency: string | null;
      customer_compensation_amount: string | null;
      waived_at: string | null;
      waived_reason: string | null;
      collected_at: string | null;
      created_at: string;
      stage: string;
      warned_at: string | null;
      warning_note: string | null;
      description: string | null;
      fine_reason: string | null;
    }>(sql`
      SELECT v.id, v.created_at::text AS sort_key, v.kind::text AS kind,
             v.occurrence_number, b.reference AS booking_reference,
             v.score_penalty, ${amounts},
             v.waived_at::text, v.waived_reason, v.collected_at::text,
             to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at,
             -- The ladder and the warning, which this SELECT did not carry (Bashar, 2026-08-24).
             --
             -- The portal's schema declared all three and DEFAULTED them, so nothing failed: every
             -- violation a partner read said «سُجّلت» whatever had really happened to it, and the
             -- warning somebody wrote FOR the partner reached nobody. A fined violation, an
             -- escalated one, a suspension-causing one -- all displayed as merely recorded.
             --
             -- warning_note is partner-facing by definition ("What the partner is told" in the
             -- schema), so it belongs here. The staff-only field on a suspension is
             -- partners.suspended_notes, which this endpoint does not touch.
             v.stage::text AS stage,
             to_char(v.warned_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS warned_at,
             v.warning_note,
             -- WHAT HAPPENED, and why the fine. Both are written for this reader.
             --
             -- The console labels both fields «الوصف (يقرأه الشريك)» and both were audited and never
             -- stored, so this screen could show the kind, a stage, an occurrence number and a
             -- figure -- and no words at all. A business was accused of something and never told
             -- what. Null on the 7,679 rows that predate the columns, and the screen says nothing
             -- rather than showing an empty line.
             v.description,
             v.fine_reason
      FROM partner_violations v
      LEFT JOIN bookings b ON b.id = v.booking_id
      LEFT JOIN currencies cur ON cur.id = v.fine_currency_id
      WHERE v.partner_id = ${partnerId}::uuid AND v.deleted_at IS NULL
        ${keyset}
      ORDER BY v.created_at DESC, v.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        kind: row.kind,
        occurrenceNumber: row.occurrence_number,
        bookingReference: row.booking_reference,
        scorePenalty: row.score_penalty,
        fineAmount: row.fine_amount,
        fineCurrency: row.fine_currency,
        customerCompensationAmount: row.customer_compensation_amount,
        /*
          A waived violation is SHOWN, not hidden. It stayed on the record and the reader needs to
          see that it was forgiven — a row that vanishes when it is waived looks like one that was
          never written, and the partner cannot tell that SAFRA acted on their appeal.
        */
        waived: row.waived_at !== null,
        waivedReason: row.waived_reason,
        collectedAt: row.collected_at,
        createdAt: row.created_at,
        stage: row.stage,
        warnedAt: row.warned_at,
        warningNote: row.warning_note,
        description: row.description,
        /*
          The fine's reason follows the fine's own visibility rule.

          `moneyHidden` withholds every figure from a reader without `payout.read_own` — an employee
          holds `violation.read` and not that — and a sentence explaining a fine is about the fine.
          Sending the words while withholding the amount would leak the thing the rule protects,
          one field over, in prose.
        */
        fineReason: money ? row.fine_reason : null,
      })),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.sort_key, last.id)
          : null,
      moneyHidden: !money,
    };
  }
}
