import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, decodeCursor, encodeCursor, type CursorQuery } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * `BKG-2026-000042`. Bounded BEFORE it reaches a query.
 *
 * The lookup is parameterised regardless, so this is not about injection — it is about not handing
 * Postgres a megabyte of caller-chosen text to compare against an indexed column, on a route any
 * signed-in employee can call sixty times a minute. The same pattern `invoices`, `disputes` and
 * `export-request` already use; found in my own security pass over this file rather than by a test,
 * because a test would have had to think to send one.
 */
const REFERENCE_PATTERN = /^BKG-\d{4}-\d{1,12}$/;

export type Arrival = {
  reference: string;
  guestName: string;
  propertyName: string;
  unitName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  status: string;
  checkedInAt: string | null;
};

export type ArrivalPage = {
  items: Arrival[];
  nextCursor: string | null;
};

/**
 * وصول الضيوف — the front desk's screen (Bashar, 2026-08-23).
 *
 * ## Why this exists as its own list rather than a filter on الحجوزات
 *
 * `booking.check_in` was a grantable capability with nothing behind it: a partner could give a
 * receptionist "check guests in" and there was no screen on which to do it. A capability the role
 * form offers and the product cannot honour is a promise gap — worse than a missing feature,
 * because somebody believes the job is delegated.
 *
 * The screen it needs is not the bookings registry with a filter. A receptionist works a SHORT,
 * TIME-BOUNDED list — who is arriving today — and reads a different set of facts from it: the
 * guest's name, the unit, how many people. Money is deliberately absent, and that is not an
 * oversight: `booking.check_in` does not imply `payout.read_own`, and a screen that showed the rate
 * would leak the business's earnings to whoever works the desk.
 *
 * ## What is arriving
 *
 * `confirmed` bookings whose `check_in` is today or in the past and are not yet checked in, plus
 * everything already checked in today. The past-dated ones matter most: a guest who arrives at
 * 01:00 for a booking dated yesterday is the case a strict "today only" filter loses, and the desk
 * then cannot record the arrival at all.
 *
 * Dates are compared in the CITY's timezone, not the server's. A property in Damascus rolls over to
 * tomorrow three hours before UTC does, and a desk clerk looking at "today" means their today.
 */
@Injectable()
export class ArrivalsService {
  private readonly logger = new Logger(ArrivalsService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /**
   * The arrivals list, newest check-in date first, cursor-paged.
   *
   * Cursor rather than a page number: this is partner-facing, and the standing instruction reserves
   * `OFFSET` and a page NUMBER for the console's registries.
   */
  async list(
    partnerId: string,
    query: CursorQuery = { limit: 20 },
  ): Promise<ArrivalPage> {
    let after: { sortKey: string; id: string } | null = null;

    if (query.cursor !== undefined) {
      const decoded = decodeCursor(query.cursor);

      /* A forged cursor shifts the window and never widens it — the partner id is not in it. */
      if (!decoded) throw badRequest(ERROR.REQUEST_CURSOR_INVALID);

      after = { sortKey: decoded.sortKey, id: decoded.id };
    }

    const keyset = after
      ? sql`AND (b.check_in::text, b.id::text) < (${after.sortKey}, ${after.id})`
      : sql``;

    const rows = await this.db.execute<{
      id: string;
      sort_key: string;
      reference: string;
      guest_name: string;
      property_name: string;
      unit_name: string;
      check_in: string;
      check_out: string;
      nights: number;
      guests: number;
      status: string;
      checked_in_at: string | null;
    }>(sql`
      SELECT b.id, b.check_in::text AS sort_key, b.reference,
             cp.full_name AS guest_name,
             p.name_ar    AS property_name,
             u.name_ar    AS unit_name,
             b.check_in::text, b.check_out::text, b.nights,
             (b.guests_adults + b.guests_children + b.guests_infants)::int AS guests,
             b.status::text AS status, b.checked_in_at::text
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = b.property_id
      JOIN cities c ON c.id = b.city_id
      WHERE b.partner_id = ${partnerId}::uuid
        AND b.deleted_at IS NULL
        AND (
          (b.status = 'confirmed' AND b.check_in <= (now() AT TIME ZONE c.timezone)::date)
          OR (b.status = 'checked_in'
              AND b.checked_in_at >= (now() AT TIME ZONE c.timezone)::date)
        )
        ${keyset}
      ORDER BY b.check_in DESC, b.id DESC
      LIMIT ${query.limit + 1}
    `);

    const page = rows.rows.slice(0, query.limit);
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        reference: row.reference,
        guestName: row.guest_name,
        propertyName: row.property_name,
        unitName: row.unit_name,
        checkIn: row.check_in,
        checkOut: row.check_out,
        nights: row.nights,
        guests: row.guests,
        status: row.status,
        checkedInAt: row.checked_in_at,
      })),
      nextCursor:
        rows.rows.length > query.limit && last
          ? encodeCursor(last.sort_key, last.id)
          : null,
    };
  }

  /**
   * Records that a guest arrived.
   *
   * ## The partner id is a WHERE clause, not a check afterwards
   *
   * The `UPDATE` carries `partner_id = <from the token>`, so "check in somebody else's guest" is
   * not a request this can express. A reference belonging to another business affects no rows and
   * answers 404 — the same answer as a reference that does not exist, which is the point.
   *
   * ## Only `confirmed` becomes `checked_in`
   *
   * The status is in the predicate rather than read and compared, so two clerks pressing at once
   * cannot both succeed: the second `UPDATE` matches nothing. Cancelled, completed and disputed
   * bookings are refused by the same clause — a cancelled booking whose guest turns up is a
   * conversation with SAFRA, not a button.
   */
  async checkIn(
    claims: AccessTokenClaims | undefined,
    partnerId: string,
    reference: string,
  ): Promise<Arrival> {
    this.assertReference(reference);

    const rows = await this.db.execute<{ id: string }>(sql`
      UPDATE bookings b
      SET status = 'checked_in', checked_in_at = now(), updated_at = now()
      WHERE b.reference = ${reference}
        AND b.partner_id = ${partnerId}::uuid
        AND b.deleted_at IS NULL
        AND b.status = 'confirmed'
      RETURNING b.id
    `);

    if (!rows.rows[0]) throw notFound(ERROR.BOOKING_NOT_FOUND);

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'booking.checked_in',
      subjectType: 'booking',
      subjectId: rows.rows[0].id,
      after: { status: 'checked_in' },
    });

    this.logger.log(`Booking ${reference} checked in.`);

    return this.one(partnerId, reference);
  }

  /**
   * Undoes a check-in.
   *
   * Asked for by project-cc during the design, and it is right: a desk clerk checking in the wrong
   * room is the most ordinary mistake this screen can produce, and without an undo the only route
   * back is a support ticket. Recording the arrival then becomes something people hesitate over,
   * which defeats the screen.
   *
   * Bounded the same way as the forward move: `status = 'checked_in'` is in the predicate, so this
   * cannot reach into `completed` or `disputed` — those are states other parts of the platform have
   * acted on, and reversing them is not a front-desk decision.
   */
  async undoCheckIn(
    claims: AccessTokenClaims | undefined,
    partnerId: string,
    reference: string,
  ): Promise<Arrival> {
    this.assertReference(reference);

    const rows = await this.db.execute<{ id: string }>(sql`
      UPDATE bookings b
      SET status = 'confirmed', checked_in_at = NULL, updated_at = now()
      WHERE b.reference = ${reference}
        AND b.partner_id = ${partnerId}::uuid
        AND b.deleted_at IS NULL
        AND b.status = 'checked_in'
      RETURNING b.id
    `);

    if (!rows.rows[0]) throw notFound(ERROR.BOOKING_NOT_FOUND);

    await this.audit.record({
      actorUserId: claims?.sub,
      actorRole: claims?.role,
      action: 'booking.check_in_undone',
      subjectType: 'booking',
      subjectId: rows.rows[0].id,
      after: { status: 'confirmed' },
    });

    this.logger.log(`Check-in undone for booking ${reference}.`);

    return this.one(partnerId, reference);
  }

  /**
   * ONE booking by its reference — §6.5's «يستطيع الشريك البحث برقم الحجز».
   *
   * ## Why the arrivals list is not enough
   *
   * That list is TIME-BOUNDED — today and the overdue — and §6.5 describes precisely the guest it
   * cannot show: one whose phone is flat, holding a paper voucher, for a stay that is not today.
   * A desk with no way to look that up sends the guest away, which is the failure the voucher and
   * this lookup exist together to prevent.
   *
   * ## Scoped by the same WHERE clause as everything else here
   *
   * `one()` carries `partner_id` from the TOKEN into the predicate, so another business's booking
   * answers exactly as one that does not exist, and a malformed reference answers the same again.
   * The lookup therefore reveals whether a reference is one of YOUR OWN bookings and nothing more.
   */
  async find(partnerId: string, reference: string): Promise<Arrival> {
    this.assertReference(reference);

    return this.one(partnerId, reference);
  }

  /**
   * A malformed reference is a 404, not a 400.
   *
   * "That is not a reference" and "that is not your booking" answer the same, so a caller cannot
   * learn the shape of a reference by watching which refusals differ.
   */
  private assertReference(reference: string): void {
    if (!REFERENCE_PATTERN.test(reference)) throw notFound(ERROR.BOOKING_NOT_FOUND);
  }

  /** One arrival, scoped to the partner, so the screen can replace a row without a refetch. */
  private async one(partnerId: string, reference: string): Promise<Arrival> {
    const rows = await this.db.execute<{
      reference: string;
      guest_name: string;
      property_name: string;
      unit_name: string;
      check_in: string;
      check_out: string;
      nights: number;
      guests: number;
      status: string;
      checked_in_at: string | null;
    }>(sql`
      SELECT b.reference, cp.full_name AS guest_name,
             p.name_ar AS property_name, u.name_ar AS unit_name,
             b.check_in::text, b.check_out::text, b.nights,
             (b.guests_adults + b.guests_children + b.guests_infants)::int AS guests,
             b.status::text AS status, b.checked_in_at::text
      FROM bookings b
      JOIN customer_profiles cp ON cp.id = b.customer_profile_id
      JOIN units u ON u.id = b.unit_id
      JOIN properties p ON p.id = b.property_id
      WHERE b.reference = ${reference} AND b.partner_id = ${partnerId}::uuid
        AND b.deleted_at IS NULL
      LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw notFound(ERROR.BOOKING_NOT_FOUND);

    return {
      reference: row.reference,
      guestName: row.guest_name,
      propertyName: row.property_name,
      unitName: row.unit_name,
      checkIn: row.check_in,
      checkOut: row.check_out,
      nights: row.nights,
      guests: row.guests,
      status: row.status,
      checkedInAt: row.checked_in_at,
    };
  }
}
