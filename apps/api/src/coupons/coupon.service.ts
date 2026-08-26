import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, normaliseCouponCode, type CouponValueKind } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { badRequest } from '../common/errors/app-error.js';
import { MONEY_SCALE, applyRate, fromMinor, quantise, toMinor } from '../common/money.js';

/** Everything a coupon is judged against — the stay it is being applied to. */
export interface CouponContext {
  readonly baseAmount: string;
  readonly totalAmount: string;
  readonly currencyId: string;
  readonly currencyCode: string;
  readonly currencyDecimals: number;
  readonly cityId: string;
  readonly partnerId: string;
  /** Absent for a guest who has not been resolved to a profile yet. */
  readonly customerProfileId?: string | undefined;
}

export interface CouponMatch {
  readonly couponId: string;
  readonly code: string;
  readonly valueKind: CouponValueKind;
  readonly discountAmount: string;
}

interface CouponRow extends Record<string, unknown> {
  id: string;
  code: string;
  type: string;
  value_kind: string;
  value: string;
  currency_code: string | null;
  max_discount_amount: string | null;
  min_booking_amount: string | null;
  starts_at: string;
  ends_at: string;
  max_redemptions: number | null;
  max_redemptions_per_customer: number;
  redemptions_count: number;
  city_id: string | null;
  partner_id: string | null;
  is_active: boolean;
}

/**
 * Coupons — validating a code against a stay, and spending it.
 *
 * ## Two entry points, and the difference is a lock
 *
 * `preview()` prices a code without touching anything: it is what the customer sees before they
 * commit, and it must not reserve a redemption somebody may never complete. `redeem()` runs INSIDE
 * the booking's transaction with the coupon row locked, because `max_redemptions` is a race — two
 * customers spending the last one of a hundred is the ordinary case on a campaign, not an
 * exotic one.
 *
 * A preview can therefore go stale between quote and booking, and that is correct: the redemption
 * re-validates everything from scratch. What the customer saw is never trusted.
 *
 * ## What the discount is taken FROM
 *
 * The STAY — `base_amount` — for both the percentage and the minimum. SAFRA's service fee is its
 * own charge rather than part of what is being discounted, and «20% off» means off the room. The
 * discount is then capped so it can never exceed the stay: a coupon must not make a booking free
 * of the partner's own inventory, and it may never make a total negative.
 *
 * ## Who pays for it
 *
 * SAFRA, always. `partner_payable_amount` is untouched by a discount — reducing what a partner is
 * owed because SAFRA ran a campaign would be taking their money. The five types are TARGETING
 * categories; `partner` narrows where a coupon applies, it does not make the partner fund it. The
 * ledger says the same thing through `coupon_discount`.
 */
@Injectable()
export class CouponService {
  private readonly logger = new Logger(CouponService.name);

  constructor(@Inject(DATABASE) private readonly db: Database) {}

  /**
   * Prices a code against a stay, writing nothing.
   *
   * Every refusal is its own code so the customer is told what to do about it — «this coupon starts
   * on Sunday» and «you have already used this» are different problems. The ONE exception is a code
   * that does not exist, which answers the same as one that is not yet valid: a distinguishable
   * "no such coupon" turns this endpoint into an oracle for guessing live campaign codes.
   */
  async preview(rawCode: string, context: CouponContext): Promise<CouponMatch> {
    const coupon = await this.find(this.db, rawCode, false);

    return this.judge(
      coupon,
      context,
      await this.customerUses(this.db, coupon.id, context),
    );
  }

  /**
   * Spends the coupon against a booking, inside the caller's transaction.
   *
   * The row is locked FIRST and every rule is re-checked against it, so a preview that has gone
   * stale cannot buy a discount. The counter is incremented in the same breath as the redemption is
   * written: two rows that could disagree about how many times a coupon has been used is exactly
   * the drift `redemptions_count` exists to avoid, and it is a cached count of the redemption rows.
   */
  async redeem(
    tx: Database,
    rawCode: string,
    context: CouponContext & { customerProfileId: string },
    bookingId: string,
  ): Promise<CouponMatch> {
    const coupon = await this.find(tx, rawCode, true);

    const match = this.judge(
      coupon,
      context,
      await this.customerUses(tx, coupon.id, context),
    );

    await tx.execute(sql`
      INSERT INTO coupon_redemptions (coupon_id, booking_id, customer_profile_id, discount_amount)
      VALUES (${coupon.id}::uuid, ${bookingId}::uuid, ${context.customerProfileId}::uuid,
              ${match.discountAmount}::numeric)
    `);

    /*
      Guarded in the WHERE as well as checked above.

      The `FOR UPDATE` already serialises redemptions of this coupon, so the check in `judge` is
      sound. This is the belt: if a future caller ever reaches the counter without the lock, the
      update matches nothing and the transaction fails rather than overselling the campaign.
    */
    const bumped = await tx.execute<{ id: string }>(sql`
      UPDATE coupons
      SET redemptions_count = redemptions_count + 1, updated_at = now()
      WHERE id = ${coupon.id}::uuid
        AND (max_redemptions IS NULL OR redemptions_count < max_redemptions)
      RETURNING id
    `);

    if (!bumped.rows.at(0)) throw badRequest(ERROR.COUPON_EXHAUSTED);

    /*
      The CODE is logged, and that is a deliberate difference from a gift card.

      A gift card code is a bearer credential — whoever reads it can spend the whole balance, so it
      never appears in a log line. A coupon code is the opposite: it goes on posters and in emails,
      it is meant to be shared, and it buys nothing on its own — a redemption needs a booking and is
      capped globally and per customer. Support answering «why did my code not work» needs it.
    */
    this.logger.log(
      `Coupon ${coupon.code} redeemed on booking ${bookingId} for ` +
        `${match.discountAmount} ${context.currencyCode}.`,
    );

    return match;
  }

  /** The coupon behind a code, locked when it is about to be spent. */
  private async find(tx: Database, rawCode: string, lock: boolean): Promise<CouponRow> {
    const code = normaliseCouponCode(rawCode);

    const rows = await tx.execute<CouponRow>(sql`
      SELECT c.id, c.code, c.type::text AS type, c.value_kind::text AS value_kind,
             c.value::text AS value, cur.code AS currency_code,
             c.max_discount_amount::text AS max_discount_amount,
             c.min_booking_amount::text  AS min_booking_amount,
             c.starts_at::text AS starts_at, c.ends_at::text AS ends_at,
             c.max_redemptions, c.max_redemptions_per_customer, c.redemptions_count,
             c.city_id, c.partner_id, c.is_active
      FROM coupons c
      LEFT JOIN currencies cur ON cur.id = c.currency_id
      WHERE c.code = ${code} AND c.deleted_at IS NULL
      ${lock ? sql`FOR UPDATE OF c` : sql``}
    `);

    const coupon = rows.rows.at(0);

    /* Same answer as "not started": see the note on `preview`. */
    if (!coupon) throw badRequest(ERROR.COUPON_INVALID);

    return coupon;
  }

  /** How many times this customer has already redeemed this coupon. */
  private async customerUses(
    tx: Database,
    couponId: string,
    context: CouponContext,
  ): Promise<number> {
    if (!context.customerProfileId) return 0;

    const rows = await tx.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM coupon_redemptions
      WHERE coupon_id = ${couponId}::uuid
        AND customer_profile_id = ${context.customerProfileId}::uuid
    `);

    return Number(rows.rows.at(0)?.n ?? 0);
  }

  /**
   * Every rule, in the order a person would ask them.
   *
   * Pure: it takes the coupon, the stay and the customer's history and decides. That is what lets
   * `preview` and `redeem` share one set of rules rather than two that drift — the failure this
   * whole service would otherwise invite, where a code previews cleanly and refuses at checkout.
   */
  private judge(coupon: CouponRow, context: CouponContext, uses: number): CouponMatch {
    if (!coupon.is_active) throw badRequest(ERROR.COUPON_INACTIVE);

    const now = Date.now();

    if (new Date(coupon.starts_at).getTime() > now) {
      throw badRequest(ERROR.COUPON_NOT_STARTED);
    }

    if (new Date(coupon.ends_at).getTime() <= now) {
      throw badRequest(ERROR.COUPON_EXPIRED);
    }

    if (
      coupon.max_redemptions !== null &&
      coupon.redemptions_count >= coupon.max_redemptions
    ) {
      throw badRequest(ERROR.COUPON_EXHAUSTED);
    }

    /*
      Always a number: the column is NOT NULL and defaults to 1, so every coupon is one-per-customer
      unless somebody says otherwise. There is no "unlimited per customer" — which is the right
      default for money off, and worth knowing when reading a coupon that has no explicit limit.
    */
    if (uses >= coupon.max_redemptions_per_customer) {
      throw badRequest(ERROR.COUPON_CUSTOMER_LIMIT);
    }

    /* Scope: a null column means "everywhere", a value means "only there". */
    if (coupon.city_id !== null && coupon.city_id !== context.cityId) {
      throw badRequest(ERROR.COUPON_NOT_FOR_CITY);
    }

    if (coupon.partner_id !== null && coupon.partner_id !== context.partnerId) {
      throw badRequest(ERROR.COUPON_NOT_FOR_PARTNER);
    }

    if (
      coupon.min_booking_amount !== null &&
      toMinor(context.baseAmount, MONEY_SCALE) <
        toMinor(coupon.min_booking_amount, MONEY_SCALE)
    ) {
      throw badRequest(ERROR.COUPON_MINIMUM_NOT_MET);
    }

    const discount = this.discountFor(coupon, context);

    return {
      couponId: coupon.id,
      code: coupon.code,
      valueKind: coupon.value_kind as CouponValueKind,
      discountAmount: discount,
    };
  }

  /**
   * What the coupon is worth against THIS stay.
   *
   * ## A fixed coupon must match the booking's currency
   *
   * Converting a marketing discount through an FX rate at the moment of redemption would make «50
   * off» mean a different thing to two customers on the same day, and it would fail outright for a
   * currency with no rate. Refusing is clear, and the operator creating the coupon chose its
   * currency deliberately.
   *
   * ## Capped twice, and the second cap is not decoration
   *
   * `max_discount_amount` is the operator's own ceiling on a percentage. The stay itself is the
   * hard one: a discount larger than the room is a booking that pays the partner out of nothing.
   */
  private discountFor(coupon: CouponRow, context: CouponContext): string {
    const baseMinor = toMinor(context.baseAmount, MONEY_SCALE);

    let discountMinor: bigint;

    if (coupon.value_kind === 'percent') {
      discountMinor = applyRate(baseMinor, Number(coupon.value) / 100);
    } else {
      if (coupon.currency_code !== context.currencyCode) {
        throw badRequest(ERROR.COUPON_CURRENCY_MISMATCH);
      }

      discountMinor = toMinor(coupon.value, MONEY_SCALE);
    }

    if (coupon.max_discount_amount !== null) {
      const ceiling = toMinor(coupon.max_discount_amount, MONEY_SCALE);

      if (discountMinor > ceiling) discountMinor = ceiling;
    }

    if (discountMinor > baseMinor) discountMinor = baseMinor;

    /* To the currency's own decimals: a percentage creates a value, it does not carry one. */
    return quantise(fromMinor(discountMinor, MONEY_SCALE), context.currencyDecimals);
  }
}
