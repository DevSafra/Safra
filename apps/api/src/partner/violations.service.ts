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
import { badRequest } from '../common/errors/app-error.js';
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
    }>(sql`
      SELECT v.id, v.created_at::text AS sort_key, v.kind::text AS kind,
             v.occurrence_number, b.reference AS booking_reference,
             v.score_penalty, ${amounts},
             v.waived_at::text, v.waived_reason, v.collected_at::text,
             to_char(v.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at
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
      })),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.sort_key, last.id)
          : null,
      moneyHidden: !money,
    };
  }
}
