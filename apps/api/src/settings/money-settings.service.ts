import { Injectable, Logger } from '@nestjs/common';

import { FxRateService } from '../fx/fx-rate.service.js';
import {
  MONEY_SCALE,
  quantise,
  divideDecimalStrings,
  fromMinor,
  multiplyDecimalStrings,
  toMinor,
} from '../common/money.js';
import { SettingsService } from './settings.service.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * The currency a bare money setting is assumed to be in.
 *
 * The approved Rules Engine screen shows every figure with a `$`, so a value stored
 * as a plain number means dollars.
 */
export const DEFAULT_MONEY_CURRENCY = 'USD';

/** When true, every money setting is USD whatever its own currency says. */
export const ALWAYS_USD_KEY = 'money.always_usd';

export interface MoneySetting {
  readonly amount: string;
  readonly currency: string;
}

/**
 * Money settings that know what currency they are in (SRS §2.1, P-005).
 *
 * ## The problem this fixes
 *
 * `partner.first_violation_fine`, `wallet.sla_compensation` and
 * `commission.customer_fee_value` were bare numbers. The SLA sweep applied them in
 * whichever currency the BOOKING used, so missing the confirmation window on a
 * 10 JOD booking fined a partner about $14 while the same lapse on a USD booking
 * fined $10. Same offence, different penalty, decided by where the property happened
 * to be.
 *
 * ## The shape
 *
 * A setting's value may be either form, and both are understood:
 *
 *   `10`                              → 10 in DEFAULT_MONEY_CURRENCY
 *   `{ "amount": "8.50", "currency": "JOD" }`  → explicitly JOD
 *
 * Accepting the bare number keeps every existing row valid, which matters because
 * `settings` is seeded and never truncated — a shape change that orphaned the
 * current values would silently fall back to defaults on a live system.
 *
 * `money.always_usd` overrides the per-setting currency wholesale. It exists because
 * "make everything dollars" is the answer most of the time, and expressing that
 * should not mean editing every money row and remembering to edit the next one too.
 */
@Injectable()
export class MoneySettingsService {
  private readonly logger = new Logger(MoneySettingsService.name);

  constructor(
    private readonly settings: SettingsService,
    private readonly fx: FxRateService,
  ) {}

  /** The setting as configured, before any conversion. */
  async read(key: string, fallbackAmount: string): Promise<MoneySetting> {
    const raw = await this.settings.get<unknown>(key, null);
    const parsed = normalise(raw) ?? {
      amount: fallbackAmount,
      currency: DEFAULT_MONEY_CURRENCY,
    };

    const alwaysUsd = await this.settings.get<boolean>(ALWAYS_USD_KEY, true);

    return alwaysUsd
      ? { amount: parsed.amount, currency: DEFAULT_MONEY_CURRENCY }
      : parsed;
  }

  /**
   * The setting expressed in `targetCurrency`.
   *
   * Conversion goes through SYP, the only pair SAFRA holds rates for, using exact
   * decimal arithmetic throughout — see `common/money.ts` for why no step of this may
   * touch a float.
   */
  async resolve(
    key: string,
    fallbackAmount: string,
    targetCurrency: string,
  ): Promise<string> {
    const setting = await this.read(key, fallbackAmount);

    if (setting.currency === targetCurrency) return setting.amount;

    const fromRate = await this.fx.rateToSyp(setting.currency);
    const toRate = await this.fx.rateToSyp(targetCurrency);

    const inSyp = multiplyDecimalStrings(setting.amount, fromRate, MONEY_SCALE);
    /* To the TARGET currency's decimals — a converted setting must be payable in it. */
    const converted = quantise(
      divideDecimalStrings(inSyp, toRate, MONEY_SCALE),
      await this.fx.decimalsOf(targetCurrency),
    );

    this.logger.log(
      `Setting ${key}: ${setting.amount} ${setting.currency} → ${converted} ` +
        `${targetCurrency} via SYP.`,
    );

    return converted;
  }

  /**
   * Like `resolve`, but never throws.
   *
   * Used by the SLA sweep, where the alternative to an approximate fine is no fine
   * at all: an unconfigured FX rate must not stop a partner being held to §6.4, and
   * it certainly must not stop the customer being compensated. Falls back to treating
   * the configured number as already being in the target currency — the old
   * behaviour — and says so loudly.
   */
  async resolveOrFallback(
    key: string,
    fallbackAmount: string,
    targetCurrency: string,
  ): Promise<string> {
    try {
      return await this.resolve(key, fallbackAmount, targetCurrency);
    } catch (error) {
      const setting = await this.read(key, fallbackAmount);

      this.logger.error(
        `Could not convert ${key} from ${setting.currency} to ${targetCurrency}: ` +
          `${describeError(error)}. ` +
          `Applying ${setting.amount} as ${targetCurrency} instead — set an FX rate ` +
          `via POST /admin/fx-rates to make this exact.`,
      );

      return setting.amount;
    }
  }
}

/**
 * Reads either stored shape, or null when the value is not money at all.
 *
 * Amounts are normalised to a fixed-scale decimal string on the way out, so a value
 * stored as the JSON number `10` and one stored as `"10.00"` are the same money to
 * every caller.
 */
export function normalise(raw: unknown): MoneySetting | null {
  /**
   * Negatives are rejected on every path.
   *
   * A negative fine, fee or compensation is not a configuration anyone means: it
   * inverts who owes whom. Rejecting here means the caller falls back to its stated
   * default rather than quietly paying a partner for missing an SLA.
   */
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return {
      amount: fromMinor(toMinor(raw.toFixed(MONEY_SCALE), MONEY_SCALE), MONEY_SCALE),
      currency: DEFAULT_MONEY_CURRENCY,
    };
  }

  if (typeof raw === 'string' && /^\d+(\.\d+)?$/.test(raw)) {
    return {
      amount: fromMinor(toMinor(raw, MONEY_SCALE), MONEY_SCALE),
      currency: DEFAULT_MONEY_CURRENCY,
    };
  }

  if (typeof raw === 'object' && raw !== null) {
    const record = raw as Record<string, unknown>;
    const amount = record['amount'];
    const currency = record['currency'];

    /**
     * Narrowed rather than coerced. `String(someObject)` yields "[object Object]",
     * which would then fail the regex anyway — but only by accident, and a nested
     * object reaching a money parser deserves an explicit "no" rather than a lucky one.
     */
    const amountText =
      typeof amount === 'number'
        ? amount.toFixed(MONEY_SCALE)
        : typeof amount === 'string'
          ? amount
          : '';

    if (
      typeof currency === 'string' &&
      /^[A-Z]{3}$/.test(currency) &&
      /^\d+(\.\d+)?$/.test(amountText)
    ) {
      return {
        amount: fromMinor(toMinor(amountText, MONEY_SCALE), MONEY_SCALE),
        currency,
      };
    }
  }

  return null;
}
