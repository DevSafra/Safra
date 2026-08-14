import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type DisputeDetail,
  type DisputeKind,
  type DisputeOpenInput,
  type DisputeQuery,
  type DisputeSummary,
  decodeCursor,
  encodeCursor,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { REDACTION_MARKERS } from '@safra/i18n';

import { redactIncomingMessage } from '../messaging/redaction.js';
import { badRequest, notFound, unauthorized } from '../common/errors/app-error.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `DSP-000112`. Bounded before it reaches a query; the lookup is parameterised regardless. */
const REFERENCE_PATTERN = /^DSP-\d{1,12}$/;

type DisputeRow = {
  reference: string;
  booking_reference: string;
  kind: string;
  status: string;
  title: string;
  description: string | null;
  resolution: string | null;
  redacted_count: number;
  opened_at: string;
  closed_at: string | null;
};

/**
 * النزاعات, from the asking side.
 *
 * ## What this is for
 *
 * `disputes`, `dispute_evidence`, the console's queue and the payout freeze have all existed since
 * the first migration, and nothing could create a row. Staff opened disputes by hand from what a
 * customer said on the phone, which made the customer's own account a thing somebody else typed.
 *
 * ## Opening one FREEZES the partner's payout, which is why the scope check is the whole design
 *
 * `DisputeService.frozenBookingReferences` derives the freeze from "does this booking have a dispute
 * that is not resolved or rejected". So this endpoint moves money — or rather, stops it. A customer
 * who could name somebody else's booking could freeze a stranger's payout, repeatedly, for nothing.
 *
 * The defence is that the booking is resolved BY REFERENCE WITHIN THE CALLER'S OWN PROFILE in a
 * single query. There is no branch where a booking is fetched and then checked, because that shape
 * answers differently for "exists and is not yours" than for "does not exist" — and a `BKG-` is
 * sequential enough to walk.
 *
 * ## And why a paid booking only
 *
 * A `pending_payment` booking has no money at stake, so there is nothing to freeze and nothing to
 * compensate. `paid_at IS NOT NULL` is the test rather than a status list: it survives a status
 * being added, and it is the exact question — has money changed hands.
 */
@Injectable()
export class DisputeRequestService {
  private readonly logger = new Logger(DisputeRequestService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /** The caller's own customer profile, or a refusal. Partners do not come through here. */
  private profileOf(claims: AccessTokenClaims | undefined): string {
    if (!claims) throw unauthorized(ERROR.AUTH_REQUIRED);

    if (!claims.customerProfileId) {
      /*
        A partner or a staff member. Every `dispute_kind` is a complaint about the stay, so there is
        nothing here for them to raise — and staff already open disputes from the console, where the
        row records who did it.
      */
      throw notFound(ERROR.CUSTOMER_NOT_FOUND);
    }

    return claims.customerProfileId;
  }

  /** The columns a dispute row needs, listed once so the list and the detail cannot diverge. */
  private get projection() {
    return sql`
      d.reference,
      b.reference        AS booking_reference,
      d.kind::text       AS kind,
      d.status::text     AS status,
      d.title,
      d.description,
      d.resolution,
      d.created_at::text AS opened_at,
      d.closed_at::text  AS closed_at,
      /*
        Recomputed on READ rather than stored.

        The redactor already ran on the way in and the original is gone, so this counts the markers
        that are in the text — which is the number the reader needs and cannot drift from what they
        are looking at. A stored counter could.

        Summed over EVERY marker, bound as parameters from REDACTION_MARKERS rather than written
        as a literal. The Arabic mask was spelled out here, so the day the token replaced it every
        dispute reported zero masked details — the text was redacted correctly and the notice that
        says so silently stopped appearing. Caught by customer-gifts.spec.ts, which raises a
        dispute containing a phone number and reads the row back.

        (No backticks in this comment: it is inside a sql template literal, and one would end it.)

        The legacy masks stay in the sum for the rows written before the token, which are
        append-only and cannot be migrated.
      */
      ${this.markerCount()} AS redacted_count
    `;
  }

  /**
   * How many markers appear in a dispute's title and description together.
   *
   * The standard "count occurrences of a substring" shape — the length lost to replacing it,
   * divided by its own length — once per marker, added up. `::text` on each parameter because
   * `length($1)` on an untyped bind leaves Postgres unable to infer the argument.
   */
  private markerCount() {
    const haystack = sql`(coalesce(d.title, '') || coalesce(d.description, ''))`;

    return sql.join(
      REDACTION_MARKERS.map(
        (marker) => sql`
          ((length(${haystack}) - length(replace(${haystack}, ${marker}::text, '')))
            / nullif(length(${marker}::text), 0))`,
      ),
      sql` + `,
    );
  }

  private summaryOf(row: DisputeRow): DisputeSummary {
    return {
      reference: row.reference,
      bookingReference: row.booking_reference,
      kind: row.kind as DisputeKind,
      status: row.status,
      title: row.title,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
      resolution: row.resolution,
      redactedCount: Number(row.redacted_count ?? 0),
    };
  }

  /**
   * Raises a dispute about one of the caller's own bookings.
   *
   * Everything the row needs about WHO — the customer, the partner — comes from the booking, never
   * from the request. A caller supplies a reference, a reason and their own words, and nothing else
   * reaches the database.
   */
  async open(
    claims: AccessTokenClaims | undefined,
    input: DisputeOpenInput,
  ): Promise<DisputeDetail> {
    const profileId = this.profileOf(claims);

    /*
      One query: the booking, scoped to this customer, and paid. A row means all three are true, and
      the absence of a row is a single 404 that cannot distinguish "not yours" from "not there".
    */
    const found = await this.db.execute<{
      id: string;
      partner_id: string;
      reference: string;
    }>(sql`
      SELECT b.id, b.partner_id, b.reference
      FROM bookings b
      WHERE b.reference = ${input.bookingReference}
        AND b.customer_profile_id = ${profileId}::uuid
        AND b.deleted_at IS NULL
      LIMIT 1
    `);

    const booking = found.rows[0];

    if (!booking) throw notFound(ERROR.BOOKING_NOT_FOUND);

    const paid = await this.db.execute<{ paid: boolean }>(sql`
      SELECT (paid_at IS NOT NULL) AS paid FROM bookings WHERE id = ${booking.id}::uuid
    `);

    /*
      Asked separately from the ownership question, and answered differently.

      "Not your booking" must be a 404 — it is the enumeration boundary. "Your booking, but nothing
      has been paid for it" is a 400 that says so, because that reader can act on it: they are
      looking at their own booking and need to know why the button did nothing.
    */
    if (!paid.rows[0]?.paid) {
      throw badRequest(ERROR.DISPUTE_BOOKING_NOT_DISPUTABLE);
    }

    /*
      One live dispute per booking per REASON.

      The schema's own note says a booking can be disputed twice for different reasons, so this does
      not refuse a second dispute — only a second of the same kind while the first is unanswered.
      Without it, a form submitted twice freezes the payout on two rows and puts two identical cases
      in a queue real people are working.
    */
    const existing = await this.db.execute<{ reference: string }>(sql`
      SELECT reference FROM disputes
      WHERE booking_id = ${booking.id}::uuid
        AND kind = ${input.kind}::dispute_kind
        /*
          The live pair. resolved and rejected are terminal — the schema's CHECK requires a
          resolution to close — so a dispute in either state has been answered and the reason is
          free to raise again.
        */
        AND status IN ('open', 'investigating')
      LIMIT 1
    `);

    if (existing.rows[0]) throw badRequest(ERROR.DISPUTE_ALREADY_OPEN);

    /* Both prose fields, masked the way every stored message is. The originals are not kept. */
    const title = redactIncomingMessage(input.title);
    const description = redactIncomingMessage(input.description);

    const created = await this.db.execute<{ reference: string }>(sql`
      INSERT INTO disputes
        (booking_id, partner_id, customer_profile_id, kind, status, title, description,
         opened_by_user_id)
      VALUES (
        ${booking.id}::uuid,
        ${booking.partner_id}::uuid,
        ${profileId}::uuid,
        ${input.kind}::dispute_kind,
        'open'::dispute_status,
        ${title.body},
        ${description.body},
        /*
          NULL, and that is the schema's stated meaning: "null when the customer raised it through
          the app rather than a staff member". Who raised it is already answered by
          customer_profile_id; this column exists to say a STAFF member did, and writing the
          customer's user id here would make that question unanswerable.
        */
        NULL
      )
      RETURNING reference
    `);

    const reference = created.rows[0]?.reference;

    if (!reference) throw badRequest(ERROR.DISPUTE_NOT_FOUND);

    /*
      The reference and the reason only. A dispute's description is the customer's own account of
      something that went wrong, and a log line is the one place it would survive the redaction.
    */
    this.logger.log(
      `Dispute ${reference} opened on ${booking.reference} (${input.kind})` +
        `${title.redactedCount + description.redactedCount > 0 ? ' with contact details masked' : ''}.`,
    );

    return this.detail(claims, reference);
  }

  /** One dispute the caller owns, with their own account of it. */
  async detail(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<DisputeDetail> {
    const profileId = this.profileOf(claims);

    if (!REFERENCE_PATTERN.test(reference)) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    const found = await this.db.execute<DisputeRow>(sql`
      SELECT ${this.projection}
      FROM disputes d
      JOIN bookings b ON b.id = d.booking_id
      WHERE d.reference = ${reference}
        AND d.customer_profile_id = ${profileId}::uuid
      LIMIT 1
    `);

    const row = found.rows[0];

    /* Scoped IN the query. Fetch-then-compare answers differently for somebody else's reference. */
    if (!row) throw notFound(ERROR.DISPUTE_NOT_FOUND);

    return { ...this.summaryOf(row), description: row.description };
  }

  /** The caller's own disputes, newest first. */
  async list(claims: AccessTokenClaims | undefined, query: DisputeQuery) {
    const profileId = this.profileOf(claims);

    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      if (!decoded || !UUID_PATTERN.test(decoded.id)) {
        throw badRequest(ERROR.REQUEST_CURSOR_INVALID);
      }

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    /* Keyed on `created_at`, which never moves — the same reasoning as the support list's cursor. */
    const keyset = after
      ? sql`AND (d.created_at, d.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`
      : sql``;

    const rows = await this.db.execute<
      DisputeRow & { id: string; created_at: string }
    >(sql`
      SELECT d.id, d.created_at, ${this.projection}
      FROM disputes d
      JOIN bookings b ON b.id = d.booking_id
      WHERE d.customer_profile_id = ${profileId}::uuid
        ${keyset}
      ORDER BY d.created_at DESC, d.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => this.summaryOf(row)),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.created_at, last.id)
          : null,
    };
  }

  /** Which of the caller's bookings could be disputed, for the form's picker. */
  async disputableBookings(claims: AccessTokenClaims | undefined) {
    const profileId = this.profileOf(claims);

    const rows = await this.db.execute<{
      reference: string;
      property: string | null;
      check_in: string;
      status: string;
    }>(sql`
      SELECT b.reference, pr.name_ar AS property, b.check_in::text AS check_in,
             b.status::text AS status
      FROM bookings b
      JOIN properties pr ON pr.id = b.property_id
      WHERE b.customer_profile_id = ${profileId}::uuid
        AND b.deleted_at IS NULL
        AND b.paid_at IS NOT NULL
      ORDER BY b.check_in DESC
      LIMIT 50
    `);

    return rows.rows.map((row) => ({
      reference: row.reference,
      property: row.property,
      checkIn: row.check_in,
      status: row.status,
    }));
  }
}
