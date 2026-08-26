import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { SettingsService } from '../settings/settings.service.js';
import {
  applyRate,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from '../common/money.js';
import { ERROR } from '@safra/contracts';
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
  fxRateToSyp: string;
  totalSyp: string;
  /** Per-night prices actually used, for the customer's breakdown. */
  nightly: { date: string; amount: string }[];
}

@Injectable()
export class PricingService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly settings: SettingsService,
    private readonly fx: FxRateService,
  ) {}

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
  }): Promise<PriceBreakdown> {
    const rows = await this.db.execute<{
      date: string;
      price: string;
      currency_code: string;
      currency_id: string;
      decimals: number;
    }>(sql`
      SELECT
        d.day::date::text AS date,
        COALESCE(ad.price, u.base_price)::text AS price,
        cur.code AS currency_code,
        cur.id::text AS currency_id,
        cur.decimals
      FROM units u
      JOIN currencies cur ON cur.id = u.currency_id
      CROSS JOIN generate_series(
        ${input.checkIn}::date, ${input.checkOut}::date - INTERVAL '1 day', INTERVAL '1 day'
      ) AS d(day)
      LEFT JOIN availability_days ad ON ad.unit_id = u.id AND ad.date = d.day::date
      WHERE u.id = ${input.unitId} AND u.deleted_at IS NULL
      ORDER BY d.day
    `);

    const nights = rows.rows;
    if (nights.length === 0) {
      throw notFound(ERROR.UNIT_NOT_FOUND_OR_RANGE_EMPTY);
    }

    const first = nights[0];
    if (!first) throw notFound(ERROR.UNIT_NOT_FOUND);

    const scale = first.decimals;

    // ── Sum the nightly rates in minor units ────────────────────────────────
    let baseMinor = 0n;
    const nightly: { date: string; amount: string }[] = [];

    for (const night of nights) {
      const minor = toMinor(night.price, scale);
      baseMinor += minor;
      nightly.push({ date: night.date, amount: fromMinor(minor, scale) });
    }

    // ── Customer fee (§2.1, configured on the Rules Engine page) ────────────
    const feeMode = (await this.settings.get<string>(
      'commission.customer_fee_mode',
      'flat',
    )) as 'flat' | 'percent';
    const feeValue = await this.settings.getNumber('commission.customer_fee_value', 0);

    /**
     * A flat fee is per BOOKING, not per night.
     *
     * The approved settings screen says "رسوم ثابتة تضاف على كل حجز" — a fixed fee
     * added to every booking. Charging it per night would quietly multiply it by the
     * length of stay.
     */
    const customerFeeMinor =
      feeMode === 'percent'
        ? applyRate(baseMinor, feeValue)
        : toMinor(feeValue.toFixed(scale), scale);

    // ── Partner commission (§2.1) ───────────────────────────────────────────
    const partnerRate = await this.settings.getNumber('commission.partner_rate', 0);
    const partnerCommissionMinor = applyRate(baseMinor, partnerRate);

    /*
      The discount comes off the total the CUSTOMER pays, and off nothing else.

      `payableMinor` is computed from the base as it always was, so the partner is owed exactly what
      the stay is worth however much SAFRA discounted it. The capture group then needs a
      `coupon_discount` leg to balance, which is where the money actually comes from.
    */
    const discountMinor = toMinor(input.discountAmount ?? '0', scale);
    const grossMinor = baseMinor + customerFeeMinor;

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
      customerFeeAmount: fromMinor(customerFeeMinor, scale),
      partnerCommissionRate: partnerRate.toString(),
      partnerCommissionAmount: fromMinor(partnerCommissionMinor, scale),
      totalAmount: fromMinor(totalMinor, scale),
      discountAmount: fromMinor(discountMinor, scale),
      partnerPayableAmount: fromMinor(payableMinor, scale),
      currencyCode: first.currency_code,
      currencyId: first.currency_id,
      nights: nights.length,
      fxRateToSyp: fxRate,
      totalSyp,
      nightly,
    };
  }
}
