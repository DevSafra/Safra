import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';
import { ltrIsolate } from '@safra/i18n';

import { amount, count } from '@/lib/format';
import { ARABIC_WESTERN_DIGITS } from '@/lib/numerals';
import { fill, plural, t } from '@/lib/strings';

/**
 * How one operational setting is READ (§9.3, P-005).
 *
 * ## The problem this solves
 *
 * الإعدادات printed the stored JSON value and nothing else. Four of the seventeen rows were
 * therefore unreadable without knowing the schema by heart:
 *
 *   `0.07`  — a seven-per-cent partner commission
 *   `120`   — a two-hour confirmation window, in minutes
 *   `17`    — a five-o'clock same-day cutoff, city-local
 *   `10`    — a ten-DOLLAR fine, with no currency anywhere on the row
 *
 * The last one is a live breach of the standing rule of 2026-08-25: SAFRA prices in five
 * currencies and settles in SYP, so «١٠» beside «غرامة عدم الرد» is not a smaller version of the
 * right answer — it is a number nobody can act on.
 *
 * So the schema each row DECLARES decides how the row reads, in one place, tested. The component
 * renders; it does not decide.
 *
 * ## Where the unit comes from
 *
 * Mostly from the schema — a `percent` is per cent, an `hourOfDay` is an hour, a `money` carries a
 * currency. `positiveInt` is the one that cannot: `booking.confirmation_window_minutes` is minutes
 * and `search.max_nights` is nights, and both are `positiveInt`.
 *
 * For those the unit comes from an allow-list of key SUFFIXES, and a key matching none of them
 * shows no unit at all. That direction matters: an absent entry costs a reader a unit they can
 * infer from the label, while a guessed one states something false. `_minutes` at the end of a
 * key has exactly one meaning, and a setting added next month that ends the same way is right
 * without anybody remembering this file.
 */

/** What the value is a quantity OF, once the schema and the key have been read. */
type Unit = 'minutes' | 'nights';

/**
 * Suffix → unit, for `positiveInt` only.
 *
 * An allow-list rather than a map of every key, so a new `*_minutes` setting reads correctly on
 * the day it is seeded. Anything else gets no unit rather than a wrong one.
 */
const SUFFIX_UNITS: ReadonlyArray<readonly [suffix: string, unit: Unit]> = [
  ['_minutes', 'minutes'],
  ['_nights', 'nights'],
];

/** The schemas `SettingRow` can render an input for. Anything else is read-only, with the reason. */
const EDITABLE = new Set([
  'rate',
  'percent',
  'positiveInt',
  'hourOfDay',
  'money',
  'boolean',
  'feeMode',
  'sanctionsPolicy',
]);

export function isEditableSchema(valueSchema: string): boolean {
  return EDITABLE.has(valueSchema);
}

/**
 * What the screen shows for one value.
 *
 * A tagged union rather than a string, because a flag is a pill, an amount is an isolated
 * left-to-right run and a routing table is a scrolling block — three different renderings that
 * must not be decided by sniffing a formatted string.
 */
export type SettingDisplay =
  /**
   * A figure and, separately, the Arabic noun that goes beside it.
   *
   * SEPARATELY, and that is the whole reason this is not one string. «120 دقيقة» composed as one
   * run and dropped into an RTL line renders as «دقيقة 120» — the unit and the number swap places,
   * because the number is a left-to-right run inside a right-to-left paragraph. The figure is
   * drawn as its own isolated run and the noun as ordinary Arabic beside it, which is the same
   * rule `docs/i18n.md` §9 states for a Latin value on an Arabic line.
   */
  | {
      readonly kind: 'quantity';
      readonly text: string;
      readonly unit: string | null;
      readonly aside: string | null;
    }
  /** An amount WITH its currency (2026-08-25). `note` says when the platform overrides it. */
  | { readonly kind: 'money'; readonly text: string; readonly note: string | null }
  | { readonly kind: 'flag'; readonly on: boolean }
  /** One of a named set — a fee mode, a sanctions policy — in the reader's words. */
  | { readonly kind: 'choice'; readonly text: string }
  /** A nested object, pretty-printed. Read-only by construction. */
  | { readonly kind: 'json'; readonly text: string }
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'missing' };

export interface DisplayableSetting {
  readonly key: string;
  readonly value: unknown;
  readonly valueSchema: string;
}

/**
 * The value as a reader meets it.
 *
 * `alwaysUsd` is the platform's `money.always_usd`, which overrides every money setting's own
 * currency. It is passed IN rather than read here so the row and the note it carries come from
 * the same fetch — a second read could disagree with the row beside it.
 */
export function settingDisplay(
  setting: DisplayableSetting,
  alwaysUsd: boolean,
): SettingDisplay {
  const { value, valueSchema } = setting;

  if (valueSchema === 'boolean') {
    return typeof value === 'boolean' ? { kind: 'flag', on: value } : { kind: 'missing' };
  }

  if (valueSchema === 'feeMode') {
    const mode = value === 'flat' ? t.sections.settings.feeFlat : null;

    return {
      kind: 'choice',
      text:
        mode ?? (value === 'percent' ? t.sections.settings.feePercent : String(value)),
    };
  }

  if (valueSchema === 'sanctionsPolicy') {
    const policy = t.sections.settings.sanctionsPolicy;
    const named =
      typeof value === 'string' ? policy[value as keyof typeof policy] : undefined;

    return { kind: 'choice', text: named ?? String(value) };
  }

  if (valueSchema === 'money') {
    const parsed = moneyOf(value);

    if (!parsed) return { kind: 'missing' };

    /*
      The currency shown is the one the row STATES, never the override.

      `money.always_usd` relabels the amount without converting it, so painting a JOD row as
      dollars would be the console asserting something the row does not say. The note carries the
      override instead — see `money-settings.service.ts`, where it is actually applied.
    */
    return {
      kind: 'money',
      text: amount(parsed.amount, parsed.currency),
      note:
        alwaysUsd && parsed.currency !== DEFAULT_MONEY_CURRENCY
          ? t.sections.settings.alwaysUsdNote
          : null,
    };
  }

  if (valueSchema === 'json') {
    return value === null || value === undefined
      ? { kind: 'missing' }
      : { kind: 'json', text: JSON.stringify(value, null, 2) };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return numeric(setting.key, valueSchema, value);
  }

  if (typeof value === 'string' && value !== '') return { kind: 'text', text: value };

  return { kind: 'missing' };
}

/** A number, with the unit its schema or its key names. */
function numeric(key: string, valueSchema: string, value: number): SettingDisplay {
  if (valueSchema === 'rate') {
    /*
      Shown as the percentage it MEANS, with the fraction it is stored as underneath.

      Both, because the two differ and each is needed: the reader thinks «٧٪», the audit row and
      the field they type into hold `0.07`. A screen that shows only the percentage invites
      somebody to type 7 into a field that accepts 0 to 1.
    */
    return {
      kind: 'quantity',
      text: percentText(value * 100),
      unit: null,
      aside: fill(t.sections.settings.stored, { value: ltrIsolate(decimal(value)) }),
    };
  }

  if (valueSchema === 'percent') {
    return { kind: 'quantity', text: percentText(value), unit: null, aside: null };
  }

  if (valueSchema === 'hourOfDay') {
    /* `17:00`, not `17`. An hour of the day is a time, and the city it applies to is the aside. */
    return {
      kind: 'quantity',
      text: `${String(value).padStart(2, '0')}:00`,
      unit: null,
      aside: t.sections.settings.cityTime,
    };
  }

  const unit = unitOf(key, valueSchema);

  return {
    kind: 'quantity',
    text: count(value),
    unit: unit === null ? null : plural(unitMessage(unit), { n: value }),
    aside: null,
  };
}

function unitMessage(unit: Unit): string {
  return unit === 'minutes'
    ? t.sections.settings.unitMinutes
    : t.sections.settings.unitNights;
}

/**
 * The percentage a rate MEANS, for the live echo beside the field being typed into.
 *
 * Isolated, because it is written into a hint that also carries Arabic: without the isolate
 * «= 7٪ كسر بين 0 و 1» reorders around the `=`.
 */
function ratePercentText(fraction: number): string {
  return fill(t.sections.settings.ratePercent, {
    percent: ltrIsolate(percentText(fraction * 100)),
  });
}

/** The unit a `positiveInt` carries, from its key. `null` where the key does not say. */
export function unitOf(key: string, valueSchema: string): Unit | null {
  if (valueSchema !== 'positiveInt') return null;

  return SUFFIX_UNITS.find(([suffix]) => key.endsWith(suffix))?.[1] ?? null;
}

/**
 * A percentage, with every decimal the value actually has.
 *
 * Not `percent()` from `format.ts`, which rounds to one decimal: that is right for a metric read
 * off a dashboard and wrong for a setting, where `0.0725` must not be shown as «٧٫٣٪» beside a
 * field holding `0.0725`.
 */
function percentText(value: number): string {
  return `${decimal(value)}${t.percentSign}`;
}

/** A number with its trailing zeros dropped — `0.07`, not `0.070000`. */
function decimal(value: number): string {
  return value.toLocaleString(ARABIC_WESTERN_DIGITS, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
}

/**
 * The stored value as text a field can hold, for the amount of a money row.
 *
 * Mirrors `MoneySettingsService.normalise`: a bare number is `DEFAULT_MONEY_CURRENCY`, and
 * `{ amount, currency }` states its own. Returning `null` rather than guessing means an
 * unexpected shape shows «لا بيانات» instead of a number in an unknown currency.
 */
export function moneyOf(value: unknown): { amount: string; currency: string } | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return { amount: String(value), currency: DEFAULT_MONEY_CURRENCY };
  }

  if (typeof value !== 'object' || value === null) return null;

  const record = value as Record<string, unknown>;
  const raw = record['amount'];
  const currency = record['currency'];

  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (!Number.isFinite(Number(raw))) return null;

  return {
    amount: String(raw),
    currency: typeof currency === 'string' ? currency : DEFAULT_MONEY_CURRENCY,
  };
}

/** The value as text an input can be seeded with — the fraction, not the percentage. */
export function editableText(setting: DisplayableSetting): string {
  if (setting.valueSchema === 'money') return moneyOf(setting.value)?.amount ?? '';

  const { value } = setting;

  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);

  return '';
}

/** The hint under the input, per schema. */
export function schemaHint(valueSchema: string): string {
  const hints = t.sections.settings;

  if (valueSchema === 'rate') return hints.hintRate;
  if (valueSchema === 'percent') return hints.hintPercent;
  if (valueSchema === 'hourOfDay') return hints.hintHourOfDay;
  if (valueSchema === 'money') return hints.hintMoney;

  return hints.hintInt;
}

/**
 * The live «= ٧٪» beside a rate being typed.
 *
 * The one field on this screen whose unit differs from the unit the reader is thinking in, and the
 * one place a typo is silent: `0.7` instead of `0.07` passes validation and multiplies every
 * partner commission by ten.
 */
export function ratePercentEcho(typed: string): string | null {
  const parsed = Number(typed.trim());

  if (typed.trim() === '' || !Number.isFinite(parsed)) return null;

  return ratePercentText(parsed);
}

/**
 * Does this setting match what the reader typed into the filter?
 *
 * Matched against the Arabic description AND the key, because both are how somebody looks for a
 * setting: an operator searches «عمولة», an engineer following a runbook searches
 * `commission.partner_rate`.
 *
 * Arabic is normalised first. Without it a search for «الاعدادات» misses «الإعدادات», which is
 * the same word typed by somebody whose keyboard habit omits the hamza — that is not a typo the
 * reader can see, so it must not be a miss.
 */
export function matchesFilter(
  setting: { key: string; descriptionAr: string | null },
  query: string,
): boolean {
  const needle = normalise(query);

  if (needle === '') return true;

  return (
    normalise(setting.key).includes(needle) ||
    normalise(setting.descriptionAr ?? '').includes(needle)
  );
}

/**
 * Arabic folded to one spelling: no diacritics, one alef, one yaa, one haa, no tatweel.
 *
 * `ً-ْ` are the harakat, `ـ` the tatweel, `ٰ` the superscript alef. Latin is
 * lower-cased in the same pass so `COMMISSION` finds `commission.partner_rate`.
 */
function normalise(text: string): string {
  return text
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .trim();
}
