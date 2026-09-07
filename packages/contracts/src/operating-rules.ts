/**
 * The operating values a person reads on screen, read from configuration rather than written down.
 *
 * ## Why this file exists
 *
 * Bashar, 2026-09-07: *"I do not want any customer-facing, partner-facing or admin-facing
 * operational values hardcoded in the interface when those values can be changed through the Super
 * Admin settings. Values such as SAFRA fees, commissions, SLA compensations, fines, confirmation
 * windows should always be derived from the active configuration rather than embedded in static
 * strings."*
 *
 * Five catalogue strings said otherwise. «مهلة ساعتين — الغرامة 10$ عند عدم الرد» sat over the
 * partner's acceptance queue; «عمولة الشريك 7٪ + رسوم خدمة 1.99$» and «رسوم خدمة 1.99$ للعميل +
 * عمولة 7٪ شريك» headed two console cards; «مثل 10$ عند فشل الشريك بالرد» explained المحافظ; and the
 * customer's own home page promised «نؤكد خلال ساعتين». Every one of those numbers is a row in
 * `settings` that a super admin can change from the console — and on the day one of them does, four
 * screens describe a platform that no longer exists, with nothing to catch it.
 *
 * ## The readers take the MAP, never the key
 *
 * Same reasoning as `customerFeeVisible` beside this file: a mistyped key reads as `undefined`,
 * falls back, and looks exactly like the setting holding its default. Callers pass the settings map
 * they already receive and never spell a key.
 *
 * ## Every value tolerates the string form
 *
 * `settings.value` is `jsonb`, and a row edited by hand arrives as `"120"` rather than `120`. A
 * reader that only accepted the number would silently fall back on exactly the rows an operator
 * touched most recently.
 *
 * ## The fallbacks are the SEEDED values, and that is deliberate
 *
 * A fallback that differed from the seed would change what a screen says the first time a settings
 * read failed — which is the failure mode this file exists to prevent, arriving by another door.
 * The one exception is `sameDayCutoffEnabled`, whose fallback matches the API's rather than the
 * seed's, and says why.
 */

import {
  DEFAULT_SAME_DAY_CUTOFF_HOUR,
  SAME_DAY_CUTOFF_ENABLED_SETTING,
} from './search.js';

export { SAME_DAY_CUTOFF_ENABLED_SETTING };

/**
 * The Next.js cache tag every surface puts on its settings read.
 *
 * Bashar, 2026-09-08: *"I would like configuration changes to become visible immediately after a
 * settings update… the platform should reflect those updates without requiring users to wait
 * several minutes for caches to expire."*
 *
 * Deriving a value from configuration is only half the promise. The other half is that a change
 * ARRIVES: `/settings/public` was cached for 300 seconds in the customer app and 60 in the console,
 * and الشروط and the home page are prerendered on top of that — so an admin who changed the fee
 * watched two screens quote the old one for five minutes and had no way to tell a slow cache from a
 * failed save.
 *
 * A TAG rather than a path, and that is the whole design. `revalidateTag` invalidates the cached
 * FETCH and every prerendered page whose render consumed it — so a new screen that reads the
 * settings is covered the day it is written, with no list of paths for somebody to forget to
 * update. A path list is the shape that decays; this one cannot.
 *
 * Spelled here so no app types it. A mistyped tag purges nothing, fails nowhere, and looks exactly
 * like a cache that is working.
 */
export const OPERATING_SETTINGS_TAG = 'safra:operating-settings';

/** `booking.confirmation_window_minutes` — how long a partner has to answer a request (§6.4). */
export const CONFIRMATION_WINDOW_SETTING = 'booking.confirmation_window_minutes';

/** `commission.partner_rate` — SAFRA's cut, as a fraction between 0 and 1. */
export const PARTNER_RATE_SETTING = 'commission.partner_rate';

/** `commission.customer_fee_value` — the service fee, flat or percent per `customer_fee_mode`. */
export const CUSTOMER_FEE_VALUE_SETTING = 'commission.customer_fee_value';

/** `commission.customer_fee_mode` — `flat` (an amount) or `percent` (of the stay). */
export const CUSTOMER_FEE_MODE_SETTING = 'commission.customer_fee_mode';

/** `refund.minimum_percent` — the floor SAFRA guarantees inside a policy window (§7.4). */
export const REFUND_MINIMUM_SETTING = 'refund.minimum_percent';

/** `partner.first_violation_fine` — what a first unanswered request costs (§7.1). */
export const FIRST_VIOLATION_FINE_SETTING = 'partner.first_violation_fine';

/**
 * `booking.same_day_cutoff_hour` — the GLOBAL hour, which a city may override (§5.3).
 *
 * `SAME_DAY_CUTOFF_ENABLED_SETTING` and `DEFAULT_SAME_DAY_CUTOFF_HOUR` are NOT redeclared here:
 * `search.ts` already names them beside the rule they govern, and a second spelling of a settings
 * key is the drift this whole file exists to prevent.
 */
export const SAME_DAY_CUTOFF_HOUR_SETTING = 'booking.same_day_cutoff_hour';

/** `wallet.sla_compensation` — what the customer receives when a partner does not answer (P-007). */
export const SLA_COMPENSATION_SETTING = 'wallet.sla_compensation';

/**
 * A number out of a `jsonb` settings value, or the fallback.
 *
 * `Number('')` and `Number(null)` are both `0` and both finite, so an empty or absent row would
 * otherwise become a confident zero — «مهلة 0 دقيقة» over the acceptance queue, or a fine of
 * nothing. Only a value that parses to a finite number is accepted.
 */
function numeric(raw: unknown, fallback: number): number {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : fallback;

  if (typeof raw === 'string' && raw.trim() !== '') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }

  return fallback;
}

/**
 * How long a partner has to answer, in minutes. Seeded at 120.
 *
 * Minutes rather than hours because the setting is minutes: rounding to hours here would make a
 * ninety-minute window read as one or two, and the partner it costs money is the one who believes
 * the rounded figure.
 */
export function confirmationWindowMinutes(settings: Record<string, unknown>): number {
  return Math.max(1, Math.round(numeric(settings[CONFIRMATION_WINDOW_SETTING], 120)));
}

/**
 * SAFRA's commission as a PERCENTAGE, for display. Seeded at 0.07 → 7.
 *
 * The setting is a fraction and every screen shows a percentage, so the multiplication happens once
 * here rather than at each of them. `0.075` renders as `7.5`, not `8`: a rate is a contractual
 * term, and rounding one for tidiness is how a partner is told a number they are not charged.
 */
export function partnerCommissionPercent(settings: Record<string, unknown>): number {
  const rate = numeric(settings[PARTNER_RATE_SETTING], 0.07);

  return Math.round(rate * 1000) / 10;
}

/** Whether the service fee is a flat amount or a percentage of the stay. Seeded `flat`. */
export function customerFeeMode(settings: Record<string, unknown>): 'flat' | 'percent' {
  return settings[CUSTOMER_FEE_MODE_SETTING] === 'percent' ? 'percent' : 'flat';
}

/**
 * The service fee as configured — an AMOUNT in `flat` mode, a PERCENTAGE in `percent` mode.
 *
 * Returned as a string because in flat mode it is money and money never becomes a float. The caller
 * pairs it with `customerFeeMode` to decide which sentence to write; a screen that assumed flat
 * would print «رسوم خدمة 5$» for a setting that means five per cent.
 */
export function customerFeeValue(settings: Record<string, unknown>): string {
  const raw = settings[CUSTOMER_FEE_VALUE_SETTING];

  if (typeof raw === 'string' && raw.trim() !== '' && Number.isFinite(Number(raw))) {
    return raw.trim();
  }

  return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '1.99';
}

/** The guaranteed refund floor inside a policy window, as a percentage. Seeded at 50. */
export function refundMinimumPercent(settings: Record<string, unknown>): number {
  return numeric(settings[REFUND_MINIMUM_SETTING], 50);
}

/**
 * Whether the same-day cutoff is in force at all.
 *
 * The flag matters as much as the hour, and it is why الشروط carried a defect rather than merely a
 * literal: the page stated «حجوزات اليوم نفسه تُغلق الساعة 17:00» as settled terms while the
 * setting was `false`, so it described a rule the platform was not applying. A conditional sentence
 * is the only honest shape — the hour alone would have made the statement precise and still untrue.
 *
 * **The fallback is `true`, and it MUST stay `true`**, because that is what
 * `BookingCreationService` enforces: `getBoolean(SAME_DAY_CUTOFF_ENABLED_SETTING, true)`, on
 * Bashar's «existing behaviour should remain the safe default unless the administrator explicitly
 * changes it». A reader here that defaulted to `false` would tell a customer the cutoff is off on
 * exactly the day the row goes missing — while the API turns them away at the door.
 *
 * `'false'` is honoured as well as `false`: a hand-edited `jsonb` row arrives as a string, and a
 * truthiness test on it would report the rule ON while the API had it off.
 */
export function sameDayCutoffEnabled(settings: Record<string, unknown>): boolean {
  const raw = settings[SAME_DAY_CUTOFF_ENABLED_SETTING];

  if (raw === false || raw === 'false') return false;

  return true;
}

/**
 * The GLOBAL hour same-day bookings close at, 0-23. Seeded at 17.
 *
 * Global, and that word is load-bearing: `cities.same_day_cutoff_hour` overrides it per city, and
 * `BookingCreationService` prefers the city's. So this is the platform-wide default and a surface
 * that speaks for all cities — الشروط — must say so rather than state one hour as though it were
 * universal. A screen about ONE city should read that city's own column instead.
 */
export function sameDayCutoffHour(settings: Record<string, unknown>): number {
  const hour = Math.round(
    numeric(settings[SAME_DAY_CUTOFF_HOUR_SETTING], DEFAULT_SAME_DAY_CUTOFF_HOUR),
  );

  return Math.min(23, Math.max(0, hour));
}

/**
 * A duration split into the unit a sentence should use.
 *
 * «ساعتين» is Arabic DUAL, and a catalogue string carrying it is correct for exactly one setting
 * value. Ninety minutes is not a whole number of hours and two hundred and forty is not «ساعتين»;
 * both need a different word, and Arabic has six plural forms to choose between. So this decides
 * only the UNIT and the COUNT, and the catalogue carries an ICU message per unit that knows the
 * forms — which is the division of labour `docs/i18n.md` requires, since «{n} ساعة» hard-codes
 * English grammar into a language that does not share it.
 */
export function durationParts(minutes: number): {
  readonly unit: 'hours' | 'minutes';
  readonly count: number;
} {
  return minutes > 0 && minutes % 60 === 0
    ? { unit: 'hours', count: minutes / 60 }
    : { unit: 'minutes', count: minutes };
}
