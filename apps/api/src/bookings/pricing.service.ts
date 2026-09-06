import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  applyRate,
  divideDecimalStrings,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from '../common/money.js';
import { customerFeeMinor, customerFeeRule } from './customer-fee.js';
import { DEFAULT_MONEY_CURRENCY, ERROR } from '@safra/contracts';
import { notFound, badRequest } from '../common/errors/app-error.js';

/**
 * Every amount is a decimal STRING, never a number — see `common/money.ts` for why
 * and for the integer minor-unit arithmetic this service is built on.
 */
export interface PriceBreakdown {
  baseAmount: string;
  customerFeeMode: 'flat' | 'percent';
  customerFeeValue: string;
  customerFeeAmount: string;
  partnerCommissionRate: string;
  partnerCommissionAmount: string;
  /**
   * What the customer owes AFTER any coupon — `base + fee - discount`.
   *
   * The partner's payable is deliberately not derived from this: a discount is SAFRA's, and
   * reducing what a partner is owed because SAFRA ran a campaign would be taking their money.
   */
  totalAmount: string;
  /** Zero when no coupon applied. Never negative — the discount is capped at the stay. */
  discountAmount: string;
  partnerPayableAmount: string;
  currencyCode: string;
  currencyId: string;
  nights: number;
  /** How many identical rooms this price covers. One unless the guest asked for more. */
  rooms: number;
  fxRateToSyp: string;
  totalSyp: string;
  /** Per-night prices actually used, for the LEAD line. See `lines` for a mixed basket. */
  nightly: { date: string; amount: string }[];
  /** One entry per room TYPE in the basket, in the order the caller asked for them. */
  lines: PriceLine[];
}

/** One room type on a booking, and what it costs. */
export interface PriceLine {
  readonly unitId: string;
  readonly rooms: number;
  /** Whole-stay accommodation for ONE room of this type. */
  readonly perRoomAmount: string;
  /** `perRoomAmount` × `rooms`. */
  readonly amount: string;
  readonly nightly: { date: string; amount: string }[];
}

@Injectable()
export class PricingService {
  private readonly logger = new Logger(PricingService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly fx: FxRateService,
  ) {}

  /**
   * Holds a partner's commission to the ceiling they negotiated.
   *
   * ## Why the cap is in USD and the commission is not
   *
   * The cap is a term of a contract — «12%, never more than $50 a booking» — and a contract is
   * written in one currency. The commission is computed in the BOOKING's currency, which is USD
   * for every booking the platform has taken but is not guaranteed to be: 57 units are priced in
   * SYP. So the cap converts, and it converts through SYP because that is the pair every recorded
   * rate is against.
   *
   * ## When the pair cannot be derived
   *
   * The cap is NOT applied, and the partner is charged the uncapped commission. That is the wrong
   * answer in the partner's favour, and it is the least bad of three: refusing to price the stay
   * would stop a sale over a configuration gap, and guessing a rate would invent money. It is
   * logged with the partner's reference so it is findable rather than silent — and it cannot
   * happen at all while bookings are priced in USD, which is the only currency any of them use.
   */
  private async capCommission(
    commissionMinor: bigint,
    capUsd: string | null,
    currencyCode: string,
    scale: number,
  ): Promise<bigint> {
    if (capUsd === null) return commissionMinor;

    let capMinor: bigint;

    if (currencyCode === DEFAULT_MONEY_CURRENCY) {
      capMinor = toMinor(capUsd, scale);
    } else {
      try {
        const [usdToSyp, ownToSyp] = await Promise.all([
          this.fx.rateToSyp(DEFAULT_MONEY_CURRENCY),
          this.fx.rateToSyp(currencyCode),
        ]);

        const capInSyp = multiplyDecimalStrings(capUsd, usdToSyp, 8);

        capMinor = toMinor(divideDecimalStrings(capInSyp, ownToSyp, scale), scale);
      } catch {
        this.logger.warn(
          `Commission cap of ${capUsd} USD not applied: no rate between ` +
            `${DEFAULT_MONEY_CURRENCY} and ${currencyCode}.`,
        );

        return commissionMinor;
      }
    }

    return commissionMinor < capMinor ? commissionMinor : capMinor;
  }

  /**
   * Computes a booking's money from the unit's real per-night prices.
   *
   * Reads the nightly rate for each date — honouring per-day overrides — rather than
   * multiplying a base price by the night count. A weekend or seasonal rate would
   * otherwise be silently ignored, and the customer would be charged something
   * different from what the property page showed.
   */
  async quote(input: {
    unitId: string;
    checkIn: string;
    checkOut: string;
    /**
     * A discount already decided by `CouponService`, in this booking's currency.
     *
     * Passed IN rather than looked up here: pricing computes what a stay costs, and which coupon
     * applies is a question about a customer and a code. Keeping the lookup out of this service is
     * what stops a price quote acquiring a dependency on who is asking.
     */
    discountAmount?: string | undefined;
    /**
     * How many rooms of `unitId`'s type — the single-type shorthand.
     *
     * Kept because most bookings are one type and the caller should not have to build a list to
     * say so. Ignored when `lines` is given.
     */
    rooms?: number | undefined;
    /**
     * A BASKET: several room types on one booking.
     *
     * «مزدوجة × 2، جناح × 1» is one family's trip, and pricing it is a SUM rather than a
     * multiplication — which is the whole reason the accommodation could not mix types before. The
     * customer fee, the partner commission and its USD cap, the total and the SYP conversion all
     * derive from the summed base, so each of them is charged once for the booking rather than once
     * per line.
     */
    lines?: readonly { unitId: string; rooms: number }[] | undefined;
  }): Promise<PriceBreakdown> {
    /*
      The basket, normalised. A caller giving `unitId` + `rooms` is asking for a basket of one, and
      collapsing the two shapes here means everything below has exactly one case to handle.
    */
    const basket =
      input.lines && input.lines.length > 0
        ? input.lines.map((line) => ({
            unitId: line.unitId,
            rooms: Math.max(1, Math.trunc(line.rooms)),
          }))
        : [
            {
              unitId: input.unitId,
              rooms: Math.max(1, Math.trunc(input.rooms ?? 1)),
            },
          ];

    const rows = await this.db.execute<{
      unit_id: string;
      date: string;
      price: string;
      currency_code: string;
      currency_id: string;
      decimals: number;
      commission_rate: string | null;
      commission_cap_usd: string | null;
    }>(sql`
      SELECT
        u.id::text AS unit_id,
        d.day::date::text AS date,
        COALESCE(ad.price, u.base_price)::text AS price,
        cur.code AS currency_code,
        cur.id::text AS currency_id,
        cur.decimals,
        -- This partner's negotiated terms, NULL when they are on the platform rate.
        -- Joined here rather than fetched separately so a quote is still one round trip.
        pa.commission_rate::text  AS commission_rate,
        pa.commission_cap_usd::text AS commission_cap_usd
      FROM units u
      JOIN currencies cur ON cur.id = u.currency_id
      JOIN properties prop ON prop.id = u.property_id
      JOIN partners pa ON pa.id = prop.partner_id
      CROSS JOIN generate_series(
        ${input.checkIn}::date, ${input.checkOut}::date - INTERVAL '1 day', INTERVAL '1 day'
      ) AS d(day)
      LEFT JOIN availability_days ad ON ad.unit_id = u.id AND ad.date = d.day::date
      /*
        Every unit in the basket, in one round trip. Written with sql.join rather than an array
        parameter: a JS array inside a template expands to a TUPLE, not a Postgres array, which is
        a documented trap in this codebase and has cost a silent no-op before.
      */
      WHERE u.id IN (${sql.join(
        basket.map((line) => sql`${line.unitId}`),
        sql`, `,
      )}) AND u.deleted_at IS NULL
      ORDER BY u.id, d.day
    `);

    const nights = rows.rows;
    if (nights.length === 0) {
      throw notFound(ERROR.UNIT_NOT_FOUND_OR_RANGE_EMPTY);
    }

    const first = nights[0];
    if (!first) throw notFound(ERROR.UNIT_NOT_FOUND);

    const scale = first.decimals;

    // ── Sum each line's nightly rates, then sum the lines ───────────────────
    /*
      A room's whole-stay cost is the sum of ITS nights, and the booking's accommodation is the sum
      of its rooms. That is the change that lets a basket mix types: a suite and a standard room
      each carry their own rate, and nothing multiplies one rate by a quantity it does not describe.
    */
    const perUnit = new Map<string, { date: string; amount: string }[]>();

    for (const night of nights) {
      const table = perUnit.get(night.unit_id) ?? [];

      table.push({
        date: night.date,
        amount: fromMinor(toMinor(night.price, scale), scale),
      });
      perUnit.set(night.unit_id, table);
    }

    let baseMinor = 0n;
    let rooms = 0;
    const lines: PriceLine[] = [];

    for (const line of basket) {
      const table = perUnit.get(line.unitId);

      /* A unit the basket names and the catalogue does not have is a refusal, never a free room. */
      if (!table || table.length === 0) throw notFound(ERROR.UNIT_NOT_FOUND);

      const perRoom = table.reduce(
        (sum, night) => sum + toMinor(night.amount, scale),
        0n,
      );
      const lineMinor = perRoom * BigInt(line.rooms);

      baseMinor += lineMinor;
      rooms += line.rooms;

      lines.push({
        unitId: line.unitId,
        rooms: line.rooms,
        perRoomAmount: fromMinor(perRoom, scale),
        amount: fromMinor(lineMinor, scale),
        nightly: table,
      });
    }

    /*
      The LEAD line's nightly table, for callers that show one rate. On a mixed basket it describes
      the first type only — which is why `lines` exists and why anything rendering a booking's
      accommodation reads that instead.
    */
    const nightly = lines[0]?.nightly ?? [];

    /*
      ── Customer fee (§2.1, configured on the Rules Engine page) ────────────

      Read through `customer-fee.ts`, which the SEARCH service also uses to make browse prices
      fee-inclusive. Two copies of this rule would let a card and this quote disagree about money.
    */
    const feeRule = await customerFeeRule(this.settings);
    const feeMode = feeRule.mode;
    const feeValue = feeRule.value;
    const customerFeeMinorAmount = customerFeeMinor(baseMinor, feeRule, scale);

    // ── Partner commission (§2.1) ───────────────────────────────────────────
    /*
      This partner's own rate when they have one, the platform's when they do not.

      NULL is «use the platform rate» and 0 is a negotiated zero-commission deal — the reason the
      column is nullable rather than defaulted. `??` distinguishes them; `||` would not, and would
      quietly bill a zero-commission partner the platform rate.
    */
    const negotiatedRate =
      first.commission_rate === null ? null : Number(first.commission_rate);
    const partnerRate =
      negotiatedRate ?? (await this.settings.getNumber('commission.partner_rate', 0));

    const uncappedCommissionMinor = applyRate(baseMinor, partnerRate);
    const partnerCommissionMinor = await this.capCommission(
      uncappedCommissionMinor,
      first.commission_cap_usd,
      first.currency_code,
      scale,
    );

    /*
      The discount comes off the total the CUSTOMER pays, and off nothing else.

      `payableMinor` is computed from the base as it always was, so the partner is owed exactly what
      the stay is worth however much SAFRA discounted it. The capture group then needs a
      `coupon_discount` leg to balance, which is where the money actually comes from.
    */
    const discountMinor = toMinor(input.discountAmount ?? '0', scale);
    const grossMinor = baseMinor + customerFeeMinorAmount;

    if (discountMinor < 0n || discountMinor > grossMinor) {
      /* `CouponService` caps at the stay, so reaching here means a caller invented a figure. */
      throw badRequest(ERROR.VALIDATION_AMOUNT_POSITIVE);
    }

    const totalMinor = grossMinor - discountMinor;
    const payableMinor = baseMinor - partnerCommissionMinor;

    /**
     * FX snapshot (§1.4).
     *
     * Delegated, and it can REFUSE. If no rate to SYP is configured this throws
     * rather than quietly using 1 — the old behaviour understated every SYP figure
     * by roughly four orders of magnitude on a fresh install. Better to decline to
     * quote than to record a total nobody can reconcile.
     */
    const fxRate = await this.fx.rateToSyp(first.currency_code);
    const totalSyp = multiplyDecimalStrings(fromMinor(totalMinor, scale), fxRate, 2);

    return {
      baseAmount: fromMinor(baseMinor, scale),
      customerFeeMode: feeMode,
      customerFeeValue: feeValue.toString(),
      customerFeeAmount: fromMinor(customerFeeMinorAmount, scale),
      partnerCommissionRate: partnerRate.toString(),
      partnerCommissionAmount: fromMinor(partnerCommissionMinor, scale),
      totalAmount: fromMinor(totalMinor, scale),
      discountAmount: fromMinor(discountMinor, scale),
      partnerPayableAmount: fromMinor(payableMinor, scale),
      currencyCode: first.currency_code,
      currencyId: first.currency_id,
      nights: nightly.length,
      rooms,
      lines,
      fxRateToSyp: fxRate,
      totalSyp,
      nightly,
    };
  }
}
