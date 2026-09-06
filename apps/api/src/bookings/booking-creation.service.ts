import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  SAME_DAY_CUTOFF_ENABLED_SETTING,
  evaluateArrival,
  type CouponPreview,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { BookingAccessService } from './booking-access.service.js';
import { PricingService } from './pricing.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/**
 * The most rooms one booking may hold, across every type in the basket.
 *
 * A booking is a family's trip. A group taking a floor is a conversation with the hotel, and an
 * uncapped basket is an invitation to price a stay with a number chosen to overflow something.
 */
const MAX_ROOMS_PER_BOOKING = 10;

/** PostgreSQL raises 23P01 when an EXCLUDE constraint rejects a row. */
const EXCLUSION_VIOLATION = '23P01';

export interface BookingDraftInput {
  unitId: string;
  /** How many rooms of the LEAD type. One when the caller says nothing. */
  rooms?: number | undefined;
  /** Other room types on the same booking. The lead is `unitId` × `rooms` above. */
  additionalLines?: readonly { unitId: string; rooms: number }[] | undefined;
  checkIn: string;
  checkOut: string;
  adults: number;
  children?: number | undefined;
  infants?: number | undefined;
  guest: { fullName: string; email: string; phone: string };
  attributes?: string[] | undefined;
  /** As the customer typed it; `CouponService` normalises. Never a discount amount. */
  couponCode?: string | undefined;
}

@Injectable()
export class BookingCreationService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly pricing: PricingService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly access: BookingAccessService,
    private readonly coupons: CouponService,
  ) {}

  /**
   * A price quote with no side effects (§6.3 step 3).
   *
   * Returns only what the customer needs to see. The partner's commission and payable
   * amounts are deliberately withheld: §7.2 forbids exposing partner financials, and
   * a guest quoting a price has no business learning either.
   */
  async quote(input: {
    unitId: string;
    checkIn: string;
    checkOut: string;
    rooms?: number | undefined;
    /** A basket of room types. See `PricingService.quote`. */
    lines?: readonly { unitId: string; rooms: number }[] | undefined;
  }) {
    const price = await this.pricing.quote(input);

    /*
      The stay rules, which `create` has always applied and this did not.
      
      A quote is what the customer decides on: it prices the checkout page, and pressing «تابع إلى
      الدفع» sends the same dates to `create`. So a quote that prices a stay `create` will refuse is
      a screen that takes a guest's name, phone and card details for a booking that cannot exist —
      the "control that appears to work but does not complete" shape, one door earlier.
      
      Invisible until 2026-09-06 because every fixture unit had `min_nights = 1`, so the two paths
      could never disagree. A realistic hotel has a suite that takes two nights and a standard room
      that takes one, and the property page linked to both with the same dates.
      
      Read here rather than threaded out of pricing: pricing's job is what a stay COSTS, and
      whether it is allowed is this service's.
    */
    await this.assertStayIsAllowed(input.unitId, price.nights);

    return {
      nights: price.nights,
      /* Echoed back so checkout can show «غرفتان» beside the total it is about to charge for. */
      rooms: price.rooms,
      /*
        One entry per room TYPE. A basket's total is the sum of these, so a checkout showing only
        the aggregate would be asking somebody to pay a figure with no working shown.
      */
      lines: price.lines.map((line) => ({
        unitId: line.unitId,
        rooms: line.rooms,
        perRoomAmount: line.perRoomAmount,
        amount: line.amount,
      })),
      baseAmount: price.baseAmount,
      customerFeeAmount: price.customerFeeAmount,
      totalAmount: price.totalAmount,
      currencyCode: price.currencyCode,
      nightly: price.nightly,
    };
  }

  /**
   * The minimum and maximum stay a unit accepts.
   *
   * One rule, asked in two places — `quote` before the customer commits and `create` when they do.
   * `create` keeps its own inline copy because it has the unit row in hand already and re-reading
   * it inside the booking transaction would be a second query for a value it holds; what matters is
   * that the two ANSWER the same, which `booking-min-nights.integration.test.ts` asserts directly.
   */
  private async assertStayIsAllowed(unitId: string, nights: number): Promise<void> {
    const rows = await this.db.execute<{ min_nights: number; max_nights: number | null }>(
      sql`
        SELECT min_nights, max_nights
          FROM units
         WHERE id = ${unitId} AND is_active AND deleted_at IS NULL
         LIMIT 1
      `,
    );

    const unit = rows.rows[0];

    /* No unit is `pricing.quote`'s refusal to make, and it has already made it. */
    if (!unit) return;

    if (nights < unit.min_nights) {
      throw badRequest(ERROR.UNIT_MIN_NIGHTS, { min: unit.min_nights });
    }
    if (unit.max_nights !== null && nights > unit.max_nights) {
      throw badRequest(ERROR.UNIT_MAX_NIGHTS, { max: unit.max_nights });
    }
  }

  /**
   * The TRIP this booking belongs to.
   *
   * A guest taking two doubles and a suite makes two bookings, because a booking carries one room
   * type and a quantity. Nothing recorded that they were one trip, so support saw two references,
   * finance saw two payments, and neither could say they belonged together.
   *
   * ## The rule is bounded, and both bounds were earned
   *
   * Same guest, same property, same dates, **within two hours**, and **fewer than ten** bookings
   * already in the group. A real guest adds a second room type within minutes; the window and the
   * cap exist because the unbounded version of this rule, run over the existing data, produced one
   * "trip" containing 2,910 bookings. A group that would breach either bound simply starts a new
   * one — which is what an operator sees today, rather than a wrong answer stated confidently.
   *
   * ## Never load-bearing
   *
   * Nothing decides anything from this. If it groups wrongly, a support agent sees one trip as two
   * — the status quo. That is what makes a heuristic acceptable here, and it is why this must not
   * be used to decide availability, money or access.
   */
  private async tripReference(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    input: {
      customerProfileId: string;
      propertyId: string;
      checkIn: string;
      checkOut: string;
    },
  ): Promise<string> {
    const existing = await tx.execute<{ reference: string }>(sql`
      SELECT b.booking_group_reference AS reference
        FROM bookings b
       WHERE b.customer_profile_id = ${input.customerProfileId}
         AND b.property_id         = ${input.propertyId}
         AND b.check_in            = ${input.checkIn}::date
         AND b.check_out           = ${input.checkOut}::date
         AND b.booking_group_reference IS NOT NULL
         AND b.created_at > now() - INTERVAL '2 hours'
         AND b.deleted_at IS NULL
       GROUP BY b.booking_group_reference
      HAVING COUNT(*) < 10
       ORDER BY MAX(b.created_at) DESC
       LIMIT 1
    `);

    const found = existing.rows[0]?.reference;

    if (found) return found;

    const minted = await tx.execute<{ reference: string }>(sql`
      SELECT 'TRP-' || to_char(now(), 'YYYY') || '-'
             || reference_number(nextval('booking_group_reference_seq')) AS reference
    `);

    return minted.rows[0]!.reference;
  }

  /**
   * How many people the basket sleeps, across every type in it.
   *
   * Read from the database rather than from the request: capacity is a fact about the rooms, and a
   * caller who could state it would be a caller who could book a suite for twelve.
   */
  private async basketCapacity(
    basket: readonly { unitId: string; rooms: number }[],
  ): Promise<number> {
    const rows = await this.db.execute<{ id: string; max_guests: number }>(sql`
      SELECT id::text AS id, max_guests
        FROM units
       WHERE id IN (${sql.join(
         basket.map((line) => sql`${line.unitId}`),
         sql`, `,
       )})
         AND is_active AND deleted_at IS NULL
    `);

    const capacityOf = new Map(rows.rows.map((row) => [row.id, row.max_guests]));

    let total = 0;

    for (const line of basket) {
      const each = capacityOf.get(line.unitId);

      /* A unit the basket names and the catalogue does not have is a refusal, never free space. */
      if (each === undefined) throw notFound(ERROR.UNIT_NOT_FOUND);

      total += each * line.rooms;
    }

    return total;
  }

  /**
   * A non-lead line's own property and type code.
   *
   * The property is checked, not trusted: every line of a basket must belong to the SAME property
   * as the lead. A booking spanning two hotels would have one partner, one commission rate, one
   * cancellation policy and one voucher describing two places — and `bookings.property_id` is a
   * single column, so the second property would simply not be recorded.
   */
  private async unitGrouping(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    unitId: string,
    propertyId: string,
  ): Promise<{ property_id: string; room_type_code: string | null }> {
    const rows = await tx.execute<{
      property_id: string;
      room_type_code: string | null;
    }>(sql`
      SELECT property_id::text AS property_id, room_type_code
        FROM units
       WHERE id = ${unitId}
         AND property_id = ${propertyId}
         AND is_active
         AND deleted_at IS NULL
       LIMIT 1
    `);

    const found = rows.rows[0];

    /* Answers exactly as a unit that does not exist: a caller cannot probe another property. */
    if (!found) throw notFound(ERROR.UNIT_NOT_FOUND);

    return found;
  }

  /**
   * Writes one `booking_units` row per room the booking holds.
   *
   * ## Why the chosen room is pinned first
   *
   * `ORDER BY` puts the guest's own choice at the top so it is never the room dropped when only
   * some of the requested quantity is free. A guest who picked room 204 from the list and got 207
   * instead would be right to call that a different booking from the one they made.
   *
   * ## Why availability is re-read here and not trusted from the page
   *
   * The property page's counts were true when it rendered. This runs in the transaction that
   * actually takes the inventory, so it reads `booking_units` and `availability_days` again — and
   * even that is only advisory. The exclusion constraint is what makes the answer safe under
   * concurrency; this query exists so the ordinary case gets a sentence naming how many are left
   * rather than a bare conflict.
   */
  private async allocateRooms(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    input: {
      bookingId: string;
      leadUnitId: string;
      propertyId: string;
      roomTypeCode: string | null;
      checkIn: string;
      checkOut: string;
      rooms: number;
      /** What ONE room of this type costs for the stay. Written onto every row of the line. */
      perRoomAmount?: string | undefined;
    },
  ): Promise<void> {
    /*
      A room with no type code is one of a kind — a villa, a farmhouse. It is interchangeable with
      nothing, so the only room it can allocate is itself, and asking for two of it is refused
      below rather than silently filled with a neighbouring listing.
    */
    const interchangeable =
      input.roomTypeCode === null
        ? sql`u.id = ${input.leadUnitId}`
        : sql`u.property_id = ${input.propertyId}
             AND u.room_type_code = ${input.roomTypeCode}
             /*
               INTERCHANGEABLE means the guest cannot tell them apart, and the two facts that
               decide that are what it costs and how many it sleeps.

               A type code is a partner's free-text label. Nothing stops one being put on a $50
               room and a $500 room, and this allocation prices every room at the LEAD room's rate
               and multiplies its capacity — so without these two the cheapest room of a type would
               be a way to buy the dearest, and a party of eight could be given rooms that sleep
               four between them. Not an attack anyone needs privileges for: pick the cheap room,
               ask for two.
             */
             AND u.base_price = (SELECT base_price FROM units WHERE id = ${input.leadUnitId})
             AND u.max_guests = (SELECT max_guests FROM units WHERE id = ${input.leadUnitId})`;

    const free = await tx.execute<{ id: string }>(sql`
      SELECT u.id::text AS id
      FROM units u
      WHERE ${interchangeable}
        AND u.is_active
        AND u.deleted_at IS NULL
        -- Not already held by a live stay overlapping these nights.
        AND NOT EXISTS (
          SELECT 1 FROM booking_units bu
          WHERE bu.unit_id = u.id
            -- Not counting THIS booking's own lead room, which the AFTER INSERT
            -- trigger has already written. Without this the allocation would read
            -- the guest's own choice as taken and refuse the booking making it.
            AND bu.booking_id <> ${input.bookingId}
            AND bu.status IN ('pending_payment', 'pending_confirmation', 'confirmed', 'checked_in', 'disputed')
            AND daterange(bu.check_in, bu.check_out, '[)')
                && daterange(${input.checkIn}::date, ${input.checkOut}::date, '[)')
        )
        -- Nor closed by the partner's calendar on any night of the stay.
        AND NOT EXISTS (
          SELECT 1 FROM availability_days ad
          WHERE ad.unit_id = u.id
            AND ad.date >= ${input.checkIn}::date
            AND ad.date <  ${input.checkOut}::date
            AND ad.status <> 'available'

        )
      -- The guest's own choice first; after that, a stable order so two runs agree.
      ORDER BY (u.id = ${input.leadUnitId}) DESC, u.unit_label NULLS LAST, u.id
      LIMIT ${input.rooms}
    `);

    const chosen = free.rows.map((row) => row.id);

    if (chosen.length < input.rooms) {
      throw conflict(ERROR.UNIT_NOT_ENOUGH_ROOMS, {
        available: chosen.length,
        requested: input.rooms,
      });
    }

    /*
      The lead room must be among them. If the guest's choice was taken between the page and here,
      the allocation would otherwise quietly hand them a sibling while `bookings.unit_id` still
      names the one they picked — a booking whose own two columns disagree.
    */
    if (!chosen.includes(input.leadUnitId)) {
      throw conflict(ERROR.BOOKING_DATES_JUST_TAKEN);
    }

    /*
      `onConflictDoNothing` because the lead room is already here: an AFTER INSERT trigger on
      `bookings` writes it, so that a booking created by any OTHER path — the staff console, a seed
      script, whatever is written next — still holds the room it names. This insert adds the rest.
    */
    await tx
      .insert(schema.bookingUnits)
      .values(
        chosen.map((unitId) => ({
          bookingId: input.bookingId,
          unitId,
          /*
            Snapshotted here, so a booking's accommodation is the SUM of its rooms rather than one
            rate multiplied. It is what lets a basket mix types, and what lets an invoice restate a
            price the guest agreed to after a partner has edited their calendar.
          */
          accommodationAmount: input.perRoomAmount ?? null,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          status: 'pending_payment' as const,
        })),
      )
      /*
        UPDATE on conflict, not DO NOTHING.

        The lead room is already here — `bookings_hold_lead_room` writes it the moment the booking
        is inserted, so that a booking created by any other path still holds the room it names —
        and that row carries no amount. `DO NOTHING` would have left it NULL, so the lead room
        would have contributed zero and the booking's rooms would not have summed to its base. The
        invariant is asserted directly in `room-inventory.integration.test.ts`.
      */
      .onConflictDoUpdate({
        target: [schema.bookingUnits.bookingId, schema.bookingUnits.unitId],
        set: { accommodationAmount: input.perRoomAmount ?? null },
      });
  }

  /**
   * Prices a coupon against a stay, writing nothing (§9.3's الكوبونات).
   *
   * Answers what the customer needs to decide: the discount, and what it leaves to pay. The stay is
   * priced here rather than trusted from the client for the same reason `quote` exists — a total
   * the browser sent is a total the browser chose.
   *
   * The unit is resolved only far enough to know its city, its partner and its currency, which are
   * what a coupon is scoped and denominated against. A stay that cannot be priced fails on the
   * pricing call, before the coupon is ever consulted.
   */
  async previewCoupon(input: {
    code: string;
    unitId: string;
    checkIn: string;
    checkOut: string;
    /*
      The quantity, because a PERCENTAGE coupon is worth more on three rooms than on one. Previewing
      against a single room would show a discount smaller than the one the booking then applies —
      two different numbers for the same code on two consecutive screens.
    */
    rooms?: number | undefined;
  }): Promise<CouponPreview> {
    const scope = await this.db.execute<{
      city_id: string;
      partner_id: string;
      decimals: number;
    }>(sql`
      SELECT p.city_id, p.partner_id, cur.decimals
      FROM units u
      JOIN properties p  ON p.id = u.property_id
      JOIN currencies cur ON cur.id = u.currency_id
      WHERE u.id = ${input.unitId} AND u.is_active AND u.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const unit = scope.rows[0];

    if (!unit) throw notFound(ERROR.UNIT_NOT_FOUND);

    const price = await this.pricing.quote({
      unitId: input.unitId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      rooms: input.rooms,
    });

    const match = await this.coupons.preview(input.code, {
      baseAmount: price.baseAmount,
      totalAmount: price.totalAmount,
      currencyId: price.currencyId,
      currencyCode: price.currencyCode,
      currencyDecimals: unit.decimals,
      cityId: unit.city_id,
      partnerId: unit.partner_id,
    });

    const after = await this.pricing.quote({
      unitId: input.unitId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      rooms: input.rooms,
      discountAmount: match.discountAmount,
    });

    return {
      code: match.code,
      valueKind: match.valueKind,
      discountAmount: match.discountAmount,
      totalBefore: price.totalAmount,
      totalAfter: after.totalAmount,
      currencyCode: price.currencyCode,
    };
  }

  /**
   * Creates a booking in `pending_payment` (SRS §6.3 steps 1–4).
   *
   * The booking is inserted BEFORE any payment is attempted, and it is the insert
   * that reserves the inventory — the `bookings_no_overlapping_stays` exclusion
   * constraint is what makes the reservation real. Checking availability and then
   * inserting would leave a race between the two; here the database decides, and a
   * loser gets 23P01 rather than a double booking.
   *
   * §6.2 has no "reserved" state, so `pending_payment` holds the slot for the
   * configured window and EC-001's sweep releases it if payment never completes.
   */
  async createDraft(
    input: BookingDraftInput,
    claims: AccessTokenClaims | undefined,
    context: { ipAddress?: string | undefined; userAgent?: string | undefined },
    now: Date = new Date(),
  ) {
    // ── Resolve the unit and its property, and confirm it is bookable ────────
    const unitRows = await this.db.execute<{
      unit_id: string;
      property_id: string;
      partner_id: string;
      partner_suspended: boolean;
      city_id: string;
      city_timezone: string;
      city_cutoff_hour: number | null;
      max_guests: number;
      room_type_code: string | null;
      min_nights: number;
      max_nights: number | null;
      property_status: string;
      policy_id: string;
      policy_code: string;
      currency_decimals: number;
      policy_tiers: unknown;
      policy_min_refund: number;
    }>(sql`
      SELECT
        u.id AS unit_id, u.property_id, u.max_guests, u.room_type_code,
        u.min_nights, u.max_nights,
        p.partner_id, p.city_id, p.status AS property_status,
        (pa.suspended_at IS NOT NULL) AS partner_suspended,
        ci.timezone AS city_timezone, ci.same_day_cutoff_hour AS city_cutoff_hour,
        cp.id AS policy_id, cp.code AS policy_code, cp.tiers AS policy_tiers,
        cp.min_refund_percent AS policy_min_refund,
        -- The unit's own currency scale, so a coupon rounds to what the currency can pay.
        cur.decimals AS currency_decimals
      FROM units u
      JOIN properties p ON p.id = u.property_id
      JOIN partners pa ON pa.id = p.partner_id
      JOIN cities ci ON ci.id = p.city_id
      JOIN cancellation_policies cp ON cp.id = p.cancellation_policy_id
      JOIN currencies cur ON cur.id = u.currency_id
      WHERE u.id = ${input.unitId}
        AND u.is_active
        AND u.deleted_at IS NULL
        AND p.deleted_at IS NULL
      LIMIT 1
    `);

    const unit = unitRows.rows[0];
    if (!unit) throw notFound(ERROR.UNIT_NOT_FOUND);

    // Only published inventory is bookable (P-002). A draft or suspended listing is
    // reported as not found, exactly as search hides it.
    if (unit.property_status !== 'published') {
      throw notFound(ERROR.UNIT_NOT_FOUND);
    }

    /*
      No new bookings against a SUSPENDED partner (Bashar, 2026-08-24).

      NOT FOUND, not a refusal that names the reason — deliberately, and it is the same answer the
      line above gives an unpublished listing. This is a CUSTOMER-facing path: telling a stranger
      that a named business is under enforcement is a disclosure the policy never intended, and it
      would let anybody enumerate which partners are suspended by trying to book them.

      The customer's experience matches search, which no longer returns these listings at all — so
      the only way to reach here is a stale link or a bookmark, and "that is no longer available" is
      both true and the whole truth a stranger is owed.

      Existing confirmed bookings are untouched by this: it sits in CREATION and nowhere else, which
      is what makes «حجوزاتك المؤكدة مستمرة» a promise the code keeps rather than a sentence the
      portal prints.
    */
    if (unit.partner_suspended) {
      throw notFound(ERROR.UNIT_NOT_FOUND);
    }

    // ── §5.3 same-day cutoff, in the CITY's local time ──────────────────────
    const cutoffHour =
      unit.city_cutoff_hour ??
      (await this.settings.getNumber('booking.same_day_cutoff_hour', 17));

    /**
     * The cutoff can be switched off entirely (Bashar, 2026-09-04).
     *
     * *"The API must enforce the setting. Hiding the message or changing the date picker in the
     * client is not sufficient."* This line IS the enforcement: the picker is a courtesy, and a
     * customer who posts today's date directly meets the same verdict either way.
     *
     * The fallback is `true`, so an absent, unreadable or not-yet-seeded row keeps the existing
     * restriction. *"Existing behaviour should remain the safe default unless the administrator
     * explicitly changes it."*
     */
    const cutoffEnabled = await this.settings.getBoolean(
      SAME_DAY_CUTOFF_ENABLED_SETTING,
      true,
    );

    const verdict = evaluateArrival(
      input.checkIn,
      now,
      unit.city_timezone,
      cutoffHour,
      cutoffEnabled,
    );

    if (!verdict.allowed) {
      /*
        A CODE with the date as a PARAM, not one of two English sentences.

        `firstBookableDate` travelled as a top-level field and the wording as `message`; the customer
        app read `reason` for the cutoff case and translated it itself, but had no branch for a past
        arrival — so that one fell through to a fallback that printed the API's English `message`
        verbatim, on an Arabic checkout form. `params` is the mechanism that already exists for
        exactly this: the client resolves the code in the reader's language and fills `{date}` itself.
      */
      throw badRequest(
        verdict.reason === 'same_day_closed'
          ? ERROR.BOOKING_SAME_DAY_CLOSED
          : ERROR.BOOKING_ARRIVAL_IN_PAST,
        { date: verdict.firstBookableDate },
      );
    }

    // ── Party size and stay length ──────────────────────────────────────────
    /*
      Four suites sleeping four each hold sixteen people, so the limit is per-BOOKING rather than
      per-room. Checking one room's capacity against the whole party would refuse a family that
      booked exactly enough rooms for itself — which is the reason they asked for several.

      Across every LINE since 2026-09-07: a basket of «مزدوجة × 2، جناح × 1» sleeps what the two
      types sleep together, and reading only the lead type's capacity would refuse the mixed
      booking that exists precisely to fit a family the single type could not.
    */
    const leadRooms = Math.max(1, Math.trunc(input.rooms ?? 1));
    const extraLines = (input.additionalLines ?? []).map((line) => ({
      unitId: line.unitId,
      rooms: Math.max(1, Math.trunc(line.rooms)),
    }));
    const basket = [{ unitId: input.unitId, rooms: leadRooms }, ...extraLines];
    const rooms = basket.reduce((sum, line) => sum + line.rooms, 0);

    if (rooms > MAX_ROOMS_PER_BOOKING) {
      throw badRequest(ERROR.UNIT_NOT_ENOUGH_ROOMS, {
        available: MAX_ROOMS_PER_BOOKING,
        requested: rooms,
      });
    }

    const capacity = await this.basketCapacity(basket);
    const guests = input.adults + (input.children ?? 0); // infants do not occupy a bed

    if (guests > capacity) {
      throw badRequest(ERROR.UNIT_GUEST_LIMIT, {
        max: capacity,
        requested: guests,
      });
    }

    const nights = Math.round(
      (Date.parse(`${input.checkOut}T00:00:00Z`) -
        Date.parse(`${input.checkIn}T00:00:00Z`)) /
        86_400_000,
    );

    if (nights < 1) {
      throw badRequest(ERROR.BOOKING_DEPARTURE_AFTER_ARRIVAL);
    }
    if (nights < unit.min_nights) {
      throw badRequest(ERROR.UNIT_MIN_NIGHTS, { min: unit.min_nights });
    }
    if (unit.max_nights !== null && nights > unit.max_nights) {
      throw badRequest(ERROR.UNIT_MAX_NIGHTS, { max: unit.max_nights });
    }

    const maxNights = await this.settings.getNumber('search.max_nights', 90);
    if (nights > maxNights) {
      throw badRequest(ERROR.BOOKING_STAY_TOO_LONG, { maxNights });
    }

    // ── Partner-declared availability ───────────────────────────────────────
    // The exclusion constraint stops overlapping BOOKINGS; it knows nothing about a
    // partner closing dates, so that is checked here.
    const blocked = await this.db.execute<{ date: string; status: string }>(sql`
      SELECT date::text AS date, status::text AS status
      FROM availability_days
      WHERE unit_id = ${input.unitId}
        AND date >= ${input.checkIn}::date
        AND date <  ${input.checkOut}::date
        AND status <> 'available'
      ORDER BY date
      LIMIT 1
    `);

    const blockedDay = blocked.rows[0];
    if (blockedDay) {
      throw conflict(ERROR.UNIT_UNAVAILABLE_ON, { date: blockedDay.date });
    }

    const perDayMinimum = await this.db.execute<{ min_nights: number }>(sql`
      SELECT min_nights FROM availability_days
      WHERE unit_id = ${input.unitId}
        AND date = ${input.checkIn}::date
        AND min_nights IS NOT NULL
      LIMIT 1
    `);

    const arrivalMinimum = perDayMinimum.rows[0]?.min_nights;
    if (arrivalMinimum !== undefined && nights < arrivalMinimum) {
      throw badRequest(ERROR.BOOKING_ARRIVAL_MINIMUM_NIGHTS, {
        date: input.checkIn,
        nights: arrivalMinimum,
      });
    }

    // ── Price, with every rate snapshotted ──────────────────────────────────
    const undiscounted = await this.pricing.quote({
      unitId: input.unitId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      lines: basket,
    });

    /*
      The coupon is PREVIEWED here and REDEEMED inside the transaction below.

      Judging it out here means a bad code refuses before the booking exists, so a customer who
      mistyped one does not hold a unit's nights while they work it out. The preview is not trusted:
      `redeem()` locks the coupon and re-checks every rule, because between here and the insert the
      last redemption of a campaign may have gone to somebody else.
    */
    const preview =
      input.couponCode === undefined
        ? null
        : await this.coupons.preview(input.couponCode, {
            baseAmount: undiscounted.baseAmount,
            totalAmount: undiscounted.totalAmount,
            currencyId: undiscounted.currencyId,
            currencyCode: undiscounted.currencyCode,
            currencyDecimals: unit.currency_decimals,
            cityId: unit.city_id,
            partnerId: unit.partner_id,
          });

    const price =
      preview === null
        ? undiscounted
        : await this.pricing.quote({
            unitId: input.unitId,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            lines: basket,
            discountAmount: preview.discountAmount,
          });

    const paymentWindowMinutes = await this.settings.getNumber(
      'booking.pending_payment_timeout_minutes',
      30,
    );

    // ── Insert ──────────────────────────────────────────────────────────────
    try {
      return await this.db.transaction(async (tx) => {
        const customerProfileId = await this.resolveCustomerProfile(
          tx,
          input.guest,
          claims,
        );

        const bookingGroupReference = await this.tripReference(tx, {
          customerProfileId,
          propertyId: unit.property_id,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
        });

        const [booking] = await tx
          .insert(schema.bookings)
          .values({
            bookingGroupReference,
            customerProfileId,
            unitId: input.unitId,
            propertyId: unit.property_id,
            partnerId: unit.partner_id,
            cityId: unit.city_id,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            rooms,
            guestsAdults: input.adults,
            guestsChildren: input.children ?? 0,
            guestsInfants: input.infants ?? 0,
            status: 'pending_payment',

            baseAmount: price.baseAmount,
            customerFeeMode: price.customerFeeMode,
            customerFeeValue: price.customerFeeValue,
            customerFeeAmount: price.customerFeeAmount,
            partnerCommissionRate: price.partnerCommissionRate,
            partnerCommissionAmount: price.partnerCommissionAmount,
            totalAmount: price.totalAmount,
            discountAmount: price.discountAmount,
            partnerPayableAmount: price.partnerPayableAmount,
            currencyId: price.currencyId,
            fxRateToSyp: price.fxRateToSyp,
            totalSyp: price.totalSyp,

            /**
             * The policy AS IT STANDS NOW. The row may be edited later; the terms
             * this customer agreed to may not.
             */
            cancellationPolicySnapshot: {
              code: unit.policy_code,
              tiers: unit.policy_tiers,
              minRefundPercent: unit.policy_min_refund,
              snapshotAt: now.toISOString(),
            },

            /**
             * EC-001. The slot is held only until payment is expected to complete;
             * the sweep cancels it afterwards and releases the dates.
             */
            confirmationDeadlineAt: new Date(
              now.getTime() + paymentWindowMinutes * 60_000,
            ),

            searchAttributes: input.attributes ?? [],
            createdIp: context.ipAddress ?? null,
            createdUserAgent: context.userAgent ?? null,
          })
          .returning({
            id: schema.bookings.id,
            reference: schema.bookings.reference,
            status: schema.bookings.status,
          });

        if (!booking) throw new Error('Booking insert returned no row.');

        /*
          ── Hand over the physical rooms ──────────────────────────────────────

          The guest chose a room TYPE and a quantity; these are the doors. The one they clicked is
          always among them and comes first, so `bookings.unit_id` names a room the booking really
          holds rather than an arbitrary sibling.

          The SELECT is advisory and the CONSTRAINT is the guarantee. Two guests racing for the last
          suite both see it free here; one commits and the other is refused 23P01 by
          `booking_units_no_overlapping_stays` and handled by the catch below. Which is why this
          runs INSIDE the booking's transaction — a partial allocation rolls the whole booking back
          rather than leaving a guest holding three of the four rooms they paid for.
        */
        /*
          One allocation PER LINE, each within its own type.

          The rooms of a line are interchangeable with each other and with nothing else — the guard
          in `allocateRooms` still requires matching property, type, price and capacity, which is
          what stops a cheap room being a way to buy a dear one. A basket is several of those
          guarantees side by side, not a relaxation of any of them.

          Sequential inside the booking's transaction, so a line that cannot be filled rolls the
          whole booking back rather than leaving a family holding two of the four rooms they paid
          for.
        */
        for (const line of basket) {
          const lineUnit =
            line.unitId === input.unitId
              ? { property_id: unit.property_id, room_type_code: unit.room_type_code }
              : await this.unitGrouping(tx, line.unitId, unit.property_id);

          await this.allocateRooms(tx, {
            bookingId: booking.id,
            leadUnitId: line.unitId,
            propertyId: lineUnit.property_id,
            roomTypeCode: lineUnit.room_type_code,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
            rooms: line.rooms,
            /* What one room of this type costs for the stay, snapshotted onto every row. */
            perRoomAmount: price.lines.find((one) => one.unitId === line.unitId)
              ?.perRoomAmount,
          });
        }

        /*
          The coupon is SPENT here, in the booking's own transaction.

          `redeem()` takes the coupon's row lock and re-judges every rule, so the preview computed
          before the transaction opened is never trusted — between then and now the last redemption
          of a campaign may have gone to somebody else, and the customer would otherwise get a
          discount the campaign had already run out of.

          Same transaction as the booking, deliberately: a redemption recorded against a booking
          that rolled back is a coupon spent on nothing, and a booking discounted with no redemption
          row is money given away with no record of which campaign gave it.
        */
        if (preview !== null) {
          const spent = await this.coupons.redeem(
            tx as unknown as Database,
            preview.code,
            {
              baseAmount: undiscounted.baseAmount,
              totalAmount: undiscounted.totalAmount,
              currencyId: undiscounted.currencyId,
              currencyCode: undiscounted.currencyCode,
              currencyDecimals: unit.currency_decimals,
              cityId: unit.city_id,
              partnerId: unit.partner_id,
              customerProfileId,
            },
            booking.id,
          );

          /*
            The booking was priced against the PREVIEW. If the coupon is now worth something else —
            an operator edited its ceiling between the two — the row would claim a discount nobody
            granted, so the whole thing rolls back rather than committing a booking whose total and
            whose redemption disagree.

            Compared by VALUE, not as strings. `CouponService` quantises to `MONEY_SCALE` and
            returns `25.000`; `PricingService` formats at the CURRENCY's scale and returns `25.00`.
            The two are the same amount spelled differently, and a string comparison here rolled
            back every couponed booking — found by the end-to-end test, not by reading the code.
          */
          if (Number(spent.discountAmount) !== Number(price.discountAmount)) {
            throw badRequest(ERROR.COUPON_INVALID);
          }
        }

        /**
         * Minted inside the same transaction as the booking. §4 allows booking
         * without an account, so this token is the ONLY thing that will authorize
         * the guest to pay — a committed booking without one is unreachable and
         * unpayable, so the two must succeed or fail together.
         *
         * Scoped to the payment window: once EC-001 has released the dates there is
         * nothing left for it to authorize.
         */
        const accessToken = await this.access.mint(
          tx as unknown as Database,
          booking.id,
          new Date(now.getTime() + paymentWindowMinutes * 60_000),
        );

        await tx.insert(schema.timelineEvents).values({
          subjectType: 'booking',
          subjectId: booking.id,
          eventType: 'booking.payment_started',
          actorType: claims ? 'customer' : 'system',
          actorUserId: claims?.sub ?? null,
          payload: { total: price.totalAmount, currency: price.currencyCode },
        });

        await this.audit.record(
          {
            actorUserId: claims?.sub,
            actorRole: claims?.role,
            action: 'booking.created',
            subjectType: 'booking',
            subjectId: booking.id,
            after: {
              reference: booking.reference,
              total: price.totalAmount,
              currency: price.currencyCode,
              nights: price.nights,
            },
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
          },
          tx as unknown as Database,
        );

        return {
          reference: booking.reference,
          status: booking.status,
          /**
           * Returned exactly once, in this response, and never retrievable again —
           * only its digest is stored. The client must hold it to start payment.
           */
          accessToken,
          expiresAt: new Date(
            now.getTime() + paymentWindowMinutes * 60_000,
          ).toISOString(),
          price: {
            nightly: price.nightly,
            baseAmount: price.baseAmount,
            serviceFee: price.customerFeeAmount,
            totalAmount: price.totalAmount,
            currencyCode: price.currencyCode,
            nights: price.nights,
            rooms: price.rooms,
          },
        };
      });
    } catch (error) {
      /**
       * EC-005 reaching the surface. Two customers paid for the last room at the
       * same instant and the database rejected the second — which is the system
       * working, not failing. It becomes a 409 and the UI offers alternatives.
       */
      if (isExclusionViolation(error)) {
        /*
          A CODE, not the sentence this used to carry.

          It answered `{message: 'Those dates were just taken…', reason: 'dates_unavailable'}` — an
          English sentence with no error code, twelve lines below a `conflict(ERROR.UNIT_UNAVAILABLE_ON)`
          that does it correctly. This is the response a customer gets for losing the race on the last
          room, so it is a refusal a real person reads, and on an Arabic screen there was nothing to
          render but English.

          Distinct from `unit.unavailable_on`: that one names the blocked DATE, because the calendar
          said no before the attempt. Here the dates were free when the customer asked, so there is no
          single date to name — only the fact that somebody committed first.
        */
        throw conflict(ERROR.BOOKING_DATES_JUST_TAKEN);
      }

      throw error;
    }
  }

  /**
   * Finds or creates the customer profile.
   *
   * §4 allows a Guest Customer to complete a booking with no account, so an
   * unauthenticated caller still gets a profile — it is the identity a booking,
   * wallet and support thread attach to, not a login.
   */
  private async resolveCustomerProfile(
    tx: Parameters<Parameters<Database['transaction']>[0]>[0],
    guest: BookingDraftInput['guest'],
    claims: AccessTokenClaims | undefined,
  ): Promise<string> {
    if (claims?.customerProfileId) {
      return claims.customerProfileId;
    }

    // A returning guest is matched on email so their bookings stay together, rather
    // than accumulating a new profile per booking.
    const existing = await tx.execute<{ id: string }>(sql`
      SELECT id FROM customer_profiles
      WHERE email = ${guest.email} AND deleted_at IS NULL
      ORDER BY created_at
      LIMIT 1
    `);

    const found = existing.rows[0]?.id;
    if (found) return found;

    const created = await tx.execute<{ id: string }>(sql`
      INSERT INTO customer_profiles (full_name, email, phone, is_guest)
      VALUES (${guest.fullName}, ${guest.email}, ${guest.phone}, true)
      RETURNING id
    `);

    const id = created.rows[0]?.id;
    if (!id) throw new Error('Customer profile insert returned no row.');

    return id;
  }
}

function isExclusionViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  // Drizzle wraps the driver error, so the code can be one level down.
  const candidates = [error, (error as { cause?: unknown }).cause];

  return candidates.some(
    (candidate) =>
      typeof candidate === 'object' &&
      candidate !== null &&
      (candidate as { code?: unknown }).code === EXCLUSION_VIOLATION,
  );
}
