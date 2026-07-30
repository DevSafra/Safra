import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { SettingsService } from '../settings/settings.service.js';

/**
 * Every amount is a decimal STRING, never a number.
 *
 * JavaScript numbers are IEEE-754 doubles: `0.1 + 0.2 !== 0.3`, and
 * `55.05 * 3 === 165.14999999999998`. A booking total is a legal obligation, so all
 * arithmetic here is done in integer minor units and only formatted back to a
 * decimal string at the boundary.
 */
export interface PriceBreakdown {
  baseAmount: string;
  customerFeeMode: 'flat' | 'percent';
  customerFeeValue: string;
  customerFeeAmount: string;
  partnerCommissionRate: string;
  partnerCommissionAmount: string;
  totalAmount: string;
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
      throw new NotFoundException('Unit not found, or the date range is empty.');
    }

    const first = nights[0];
    if (!first) throw new NotFoundException('Unit not found.');

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

    const totalMinor = baseMinor + customerFeeMinor;
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

/** Parses a decimal string into integer minor units. Never uses parseFloat. */
export function toMinor(value: string, scale: number): bigint {
  const trimmed = value.trim();
  const negative = trimmed.startsWith('-');
  const unsigned = negative ? trimmed.slice(1) : trimmed;

  const [whole = '0', fraction = ''] = unsigned.split('.');
  // Pad or truncate the fraction to the currency's scale, so "55.5" and "55.50"
  // both become 5550 for a 2-decimal currency.
  const padded = (fraction + '0'.repeat(scale)).slice(0, scale);

  const minor = BigInt(whole || '0') * 10n ** BigInt(scale) + BigInt(padded || '0');
  return negative ? -minor : minor;
}

/** Formats integer minor units back into a decimal string. */
export function fromMinor(minor: bigint, scale: number): string {
  const negative = minor < 0n;
  const abs = negative ? -minor : minor;
  const divisor = 10n ** BigInt(scale);

  const whole = abs / divisor;
  const fraction = abs % divisor;

  const body =
    scale === 0
      ? whole.toString()
      : `${whole.toString()}.${fraction.toString().padStart(scale, '0')}`;

  return negative ? `-${body}` : body;
}

/**
 * Applies a fractional rate (0.07) to minor units, rounding half-up.
 *
 * The rate is scaled to an integer first so the multiplication stays in bigint —
 * `baseMinor * 0.07` would reintroduce float error on the very value we are
 * protecting.
 */
export function applyRate(minor: bigint, rate: number): bigint {
  const RATE_SCALE = 1_000_000n; // six decimal places of rate precision
  const scaledRate = BigInt(Math.round(rate * Number(RATE_SCALE)));

  const product = minor * scaledRate;
  // Round half-up rather than truncating, so a fee is never systematically short.
  return (product + RATE_SCALE / 2n) / RATE_SCALE;
}

/** Multiplies two decimal strings exactly, at a fixed output scale. */
export function multiplyDecimalStrings(a: string, b: string, outScale: number): string {
  const SCALE = 8;
  const aMinor = toMinor(a, SCALE);
  const bMinor = toMinor(b, SCALE);

  const productMinor = aMinor * bMinor; // now at 2 * SCALE
  const divisor = 10n ** BigInt(2 * SCALE - outScale);

  return fromMinor((productMinor + divisor / 2n) / divisor, outScale);
}
