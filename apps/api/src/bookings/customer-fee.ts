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
 * **A flat fee is per UNIT TYPE, and never per night or per room.**
 *
 * Per night would quietly multiply it by the length of the stay, which is what the approved
 * settings screen forbids: «رسوم ثابتة تضاف على كل حجز». Per ROOM would charge a family taking
 * three of the same room three times for one arrival.
 *
 * Per TYPE is Bashar's rule (2026-09-14): «the رسوم سفرة should be added on every unit art only
 * one time if the client book the unit many +1. By multiple different units booking should it be
 * on every one unit art also.» Three double rooms is one fee; a double room and a suite is two.
 * It was once per BOOKING until that date, so a mixed basket now costs one fee more per extra type.
 *
 * **`unitTypes` does NOT apply to a percentage fee**, and that is not an oversight: a percentage is
 * already proportional to the basket, so a second type has already raised it. Multiplying it again
 * would charge the second type twice — once through the larger base and once through the count.
 *
 * The default of 1 keeps every single-unit caller — the search service's browse prices, above all —
 * charging exactly what it charged before.
 */
export function customerFeeMinor(
  baseMinor: bigint,
  rule: CustomerFeeRule,
  scale: number,
  unitTypes = 1,
): bigint {
  if (rule.mode === 'percent') return applyRate(baseMinor, rule.value);

  /* Guarded, because a count of zero would make the fee vanish rather than fail loudly. */
  const types = BigInt(Math.max(1, Math.trunc(unitTypes)));

  return toMinor(rule.value.toFixed(scale), scale) * types;
}
