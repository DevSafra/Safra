import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { ERROR, evaluateArrival, type CouponPreview } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { SettingsService } from '../settings/settings.service.js';
import { BookingAccessService } from './booking-access.service.js';
import { PricingService } from './pricing.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/** PostgreSQL raises 23P01 when an EXCLUDE constraint rejects a row. */
const EXCLUSION_VIOLATION = '23P01';

export interface BookingDraftInput {
  unitId: string;
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
  async quote(input: { unitId: string; checkIn: string; checkOut: string }) {
    const price = await this.pricing.quote(input);

    return {
      nights: price.nights,
      baseAmount: price.baseAmount,
      customerFeeAmount: price.customerFeeAmount,
      totalAmount: price.totalAmount,
      currencyCode: price.currencyCode,
      nightly: price.nightly,
    };
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
        u.id AS unit_id, u.property_id, u.max_guests, u.min_nights, u.max_nights,
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

    const verdict = evaluateArrival(input.checkIn, now, unit.city_timezone, cutoffHour);

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
    const guests = input.adults + (input.children ?? 0); // infants do not occupy a bed
    if (guests > unit.max_guests) {
      throw badRequest(ERROR.UNIT_GUEST_LIMIT, {
        max: unit.max_guests,
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

        const [booking] = await tx
          .insert(schema.bookings)
          .values({
            customerProfileId,
            unitId: input.unitId,
            propertyId: unit.property_id,
            partnerId: unit.partner_id,
            cityId: unit.city_id,
            checkIn: input.checkIn,
            checkOut: input.checkOut,
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
