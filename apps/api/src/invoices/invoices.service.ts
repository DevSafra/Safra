import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type InvoiceDetail,
  type InvoiceLine,
  type InvoicePayment,
  type InvoiceQuery,
  type InvoiceSummary,
  decodeCursor,
  encodeCursor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';

/** A uuid, checked before it reaches a `::uuid` cast so a forged cursor is a 400 and not a 500. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A booking reference, bounded before it is compared.
 *
 * The query is parameterised, so this is not what makes the lookup safe — it BOUNDS the input, so a
 * path segment of arbitrary length never becomes a database round trip. Deliberately permissive on
 * shape: production references read `BKG-2026-000123` but every fixture and integration row reads
 * `BKG-TEST-<hex>`, and a pattern tight enough to describe only the former would refuse the reference
 * that the tests — and therefore the proof this works — are written against.
 */
const REFERENCE_PATTERN = /^[A-Za-z0-9-]{4,64}$/;

/**
 * A `draft` booking has amounts on it and has never been a transaction.
 *
 * Everything else does: `pending_payment` is precisely the case an invoice exists FOR — a statement of
 * what is owed — and `cancelled` is the case somebody most needs a record of, because that is the one
 * they will be asking about a refund for. Filtering cancellations out of a receipt list would hide the
 * money movement that matters most.
 */
const RECEIPTABLE = sql`b.status <> 'draft'`;

type BookingRow = {
  reference: string;
  status: string;
  created_at: string;
  paid_at: string | null;
  check_in: string;
  check_out: string;
  nights: number;
  slug: string;
  name_ar: string;
  name_en: string | null;
  name_de: string | null;
  city_name_ar: string;
  city_name_en: string | null;
  city_name_de: string | null;
  currency_code: string;
  total_amount: string;
  base_amount: string;
  customer_fee_amount: string;
  discount_amount: string;
  gift_card_amount: string;
  wallet_amount: string;
  id: string;
};

/**
 * الفواتير — a customer's own receipts (handoff §6).
 *
 * ## Nothing here is calculated
 *
 * Every figure is `::text` off the booking row, including the total. That is the whole design: a
 * receipt whose total is re-derived in the API can disagree with the booking, the payment and the
 * partner payout the moment any rounding rule differs, and the disagreement surfaces as a customer
 * saying "you charged me the wrong amount". `total_amount` is the number that was charged, so it is
 * the number the receipt prints.
 *
 * The lines therefore do NOT have to sum to the total, and the UI must not assert that they do. A
 * booking priced before a fee rule changed is allowed to be internally odd; the receipt's job is to
 * report it faithfully, not to correct it.
 *
 * ## The scope is the token's customer profile
 *
 * No endpoint here accepts a customer id, and `one()` looks a reference up WITH the profile in the
 * WHERE clause rather than fetching then checking. A reference is short, sequential and quotable, so
 * guessing a neighbouring one is trivial; the query simply finds nothing.
 *
 * ## Known limitation: the property name is joined, not snapshotted
 *
 * A renamed or re-slugged property changes what an old receipt says it was for. A document that may
 * not change after issue has to snapshot its own descriptions — recorded in `docs/FUTURE-WORK.md`
 * alongside the rest of what a real tax invoice needs.
 */
@Injectable()
export class InvoicesService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The caller's own profile, or a refusal. */
  private profileOf(claims: AccessTokenClaims | undefined): string {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    const profileId = claims.customerProfileId;

    /* A staff or partner token has no customer account, and so has no receipts of its own. */
    if (!profileId) throw notFound(ERROR.CUSTOMER_NOT_FOUND);

    return profileId;
  }

  /** The columns every receipt needs, listed once so the list and the detail cannot diverge. */
  private get projection() {
    return sql`
      b.id, b.reference, b.status::text AS status,
      b.created_at::text AS created_at,
      b.paid_at::text    AS paid_at,
      b.check_in::text   AS check_in,
      b.check_out::text  AS check_out,
      b.nights,
      p.slug, p.name_ar, p.name_en, p.name_de,
      ci.name_ar AS city_name_ar,
      ci.name_en AS city_name_en,
      ci.name_de AS city_name_de,
      cur.code   AS currency_code,
      b.total_amount::text        AS total_amount,
      b.base_amount::text         AS base_amount,
      b.customer_fee_amount::text AS customer_fee_amount,
      b.discount_amount::text     AS discount_amount,
      b.gift_card_amount::text    AS gift_card_amount,
      b.wallet_amount::text       AS wallet_amount
    `;
  }

  /** Read once, so a receipt row is assembled the same way wherever it is asked for. */
  private get joins() {
    return sql`
      FROM bookings b
      JOIN properties p  ON p.id = b.property_id
      JOIN cities ci     ON ci.id = p.city_id
      JOIN currencies cur ON cur.id = b.currency_id
    `;
  }

  private summaryOf(row: BookingRow): InvoiceSummary {
    return {
      reference: row.reference,
      bookingStatus: row.status,
      issuedAt: row.created_at,
      paidAt: row.paid_at,
      checkIn: row.check_in,
      checkOut: row.check_out,
      nights: row.nights,
      property: {
        slug: row.slug,
        nameAr: row.name_ar,
        nameEn: row.name_en,
        nameDe: row.name_de,
      },
      city: {
        nameAr: row.city_name_ar,
        nameEn: row.city_name_en,
        nameDe: row.city_name_de,
      },
      currencyCode: row.currency_code,
      totalAmount: row.total_amount,
    };
  }

  /**
   * The breakdown.
   *
   * A zero line is DROPPED rather than printed as `0.00`: a receipt listing a gift card that was not
   * used invites the question of where it went. `accommodation` and `serviceFee` always appear, since
   * a stay with no accommodation charge is a data fault worth seeing rather than hiding.
   */
  private linesOf(row: BookingRow): InvoiceLine[] {
    const optional: readonly (readonly [InvoiceLine['key'], string])[] = [
      ['discount', row.discount_amount],
      ['giftCard', row.gift_card_amount],
      ['wallet', row.wallet_amount],
    ];

    return [
      { key: 'accommodation' as const, amount: row.base_amount, deduction: false },
      { key: 'serviceFee' as const, amount: row.customer_fee_amount, deduction: false },
      ...optional
        .filter(([, amount]) => Number(amount) !== 0)
        .map(([key, amount]) => ({ key, amount, deduction: true })),
    ];
  }

  async list(claims: AccessTokenClaims | undefined, query: InvoiceQuery) {
    const profileId = this.profileOf(claims);

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID_PATTERN.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    /* String sort key: `created_at` holds microseconds and a Date holds milliseconds — see
       `encodeCursor`, which documents why truncating it repeats the boundary row. */
    const keyset = after
      ? sql`AND (b.created_at, b.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    /* `bookings_customer_idx` is (customer_profile_id, created_at) — this ordering, this filter. */
    const result = await this.db.execute<BookingRow>(sql`
      SELECT ${this.projection}
      ${this.joins}
      WHERE b.customer_profile_id = ${profileId}
        AND b.deleted_at IS NULL
        AND ${RECEIPTABLE}
        ${keyset}
      ORDER BY b.created_at DESC, b.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = result.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => this.summaryOf(row)),
      nextCursor:
        result.rows.length > query.limit && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }

  /** One receipt in full, or a 404 — including when it belongs to somebody else. */
  async one(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<InvoiceDetail> {
    const profileId = this.profileOf(claims);

    /*
      A 404, not a 400: a reference of the wrong shape cannot name a booking, and answering "malformed"
      would tell somebody probing what shape a real one has.
    */
    if (!REFERENCE_PATTERN.test(reference)) throw notFound(ERROR.BOOKING_NOT_FOUND);

    const found = await this.db.execute<BookingRow>(sql`
      SELECT ${this.projection}
      ${this.joins}
      WHERE b.customer_profile_id = ${profileId}
        AND b.reference = ${reference}
        AND b.deleted_at IS NULL
        AND ${RECEIPTABLE}
      LIMIT 1
    `);

    const row = found.rows.at(0);

    if (!row) throw notFound(ERROR.BOOKING_NOT_FOUND);

    /*
      The payment history, every attempt of it.

      A failed attempt is shown rather than filtered: somebody reading a receipt because their card was
      charged twice needs to see both rows. `payments_booking_idx` covers this lookup.
    */
    const paid = await this.db.execute<{
      reference: string;
      method: string;
      status: string;
      amount: string;
      currency_code: string;
      captured_at: string | null;
    }>(sql`
      SELECT pay.reference,
             pay.method::text AS method,
             pay.status::text AS status,
             pay.amount::text AS amount,
             cur.code         AS currency_code,
             pay.captured_at::text AS captured_at
      FROM payments pay
      JOIN currencies cur ON cur.id = pay.currency_id
      WHERE pay.booking_id = ${row.id}::uuid
        AND pay.deleted_at IS NULL
      ORDER BY pay.created_at ASC
    `);

    return {
      ...this.summaryOf(row),
      lines: this.linesOf(row),
      payments: paid.rows.map((payment): InvoicePayment => ({
        reference: payment.reference,
        method: payment.method,
        status: payment.status,
        amount: payment.amount,
        currencyCode: payment.currency_code,
        capturedAt: payment.captured_at,
      })),
    };
  }
}
