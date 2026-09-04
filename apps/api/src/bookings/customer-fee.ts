import { applyRate, toMinor } from '../common/money.js';
import type { SettingsService } from '../settings/settings.service.js';

export interface CustomerFeeRule {
  readonly mode: 'flat' | 'percent';
  readonly value: number;
}

/**
 * SAFRA's customer fee, as configured on the Rules Engine page (§2.1).
 *
 * ## Why this is a module rather than two copies
 *
 * It was computed inside `PricingService` alone, which was correct while checkout was the only
 * place the fee reached a customer. It is not any more: Bashar asked for the fee to stop being
 * NAMED to guests (2026-09-03) and then, seeing a card say «$100» above a checkout saying
 * «$101.99», for the displayed prices to INCLUDE it. Browse prices are produced by the search
 * query, which knows nothing about pricing.
 *
 * Two implementations of «what does SAFRA add» is how a card and a checkout come to disagree about
 * money — and the disagreement would be invisible until a guest reached the last screen, which is
 * exactly the failure this change exists to remove. So the rule is read once, here, and both
 * callers use it.
 */
export async function customerFeeRule(
  settings: SettingsService,
): Promise<CustomerFeeRule> {
  const mode = (await settings.get<string>('commission.customer_fee_mode', 'flat')) as
    'flat' | 'percent';

  return { mode, value: await settings.getNumber('commission.customer_fee_value', 0) };
}

/**
 * The fee on a base amount, in minor units.
 *
 * **A flat fee is per BOOKING, not per night.** The approved settings screen says «رسوم ثابتة تضاف
 * على كل حجز» — a fixed fee added to every booking — and charging it per night would quietly
 * multiply it by the length of the stay. That sentence lived in `PricingService` and moved here
 * with the arithmetic it describes, because it is the part a second caller is most likely to get
 * wrong.
 */
export function customerFeeMinor(
  baseMinor: bigint,
  rule: CustomerFeeRule,
  scale: number,
): bigint {
  return rule.mode === 'percent'
    ? applyRate(baseMinor, rule.value)
    : toMinor(rule.value.toFixed(scale), scale);
}
