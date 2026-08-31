import { z } from 'zod';

import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';
import { ltrIsolate } from '@safra/i18n';

import { amount, count } from '@/lib/format';
import { ARABIC_WESTERN_DIGITS } from '@/lib/numerals';
import { CONSOLE_LOCALE, fill, plural, t } from '@/lib/strings';

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
  /**
   * The payment routing table, as rows a person can read.
   *
   * Not `JSON.stringify` any more. `{"*":["manual_transfer"],"SY":["manual_transfer"]}` in a
   * monospace block was the least legible thing on the screen and told an operator nothing about
   * which rail a Syrian customer meets — see `routingRows`.
   */
  | { readonly kind: 'routing'; readonly rows: RoutingRow[] }
  /** A nested object this console has no reader for, pretty-printed. Read-only by construction. */
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
    if (value === null || value === undefined) return { kind: 'missing' };

    const rows = routingRows(setting.key, value);

    return rows
      ? { kind: 'routing', rows }
      : { kind: 'json', text: JSON.stringify(value, null, 2) };
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return numeric(setting.key, valueSchema, value);
  }

  if (typeof value === 'string' && value !== '') return { kind: 'text', text: value };

  return { kind: 'missing' };
}

/** One line of the payment routing table: a place, and the rails serving it in order. */
export interface RoutingRow {
  /** «سوريا», «كل البلدان الأخرى» — already in the reader's language. */
  readonly place: string;
  /** «تحويل بنكي يدوي», in preference order. */
  readonly providers: string[];
  /** True for the `*` entry, so the row can be drawn last and marked as the fallback. */
  readonly isFallback: boolean;
}

/**
 * `payment.provider_routing` as rows, or `null` when the value is not that shape.
 *
 * ## Why the key is checked, not just the shape
 *
 * `Record<string, string[]>` is a shape any number of future settings might have, and reading an
 * unrelated one as «country → payment provider» would put confident nonsense on the screen. So
 * this only speaks for the one key it understands; anything else falls through to the JSON block,
 * which is honest about not knowing.
 *
 * The `*` row sorts LAST and is labelled as the fallback. In the stored object it may come first —
 * key order in JSON is arbitrary — and «كل البلدان الأخرى» above «سوريا» reads as though the
 * general case wins, which is the opposite of how the registry resolves it.
 */
export function routingRows(key: string, value: unknown): RoutingRow[] | null {
  if (key !== ROUTING_KEY) return null;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;

  const entries = Object.entries(value as Record<string, unknown>);

  if (entries.length === 0) return null;

  const rows: RoutingRow[] = [];

  for (const [place, providers] of entries) {
    /* One bad entry invalidates the whole reading — a half-rendered routing table is worse. */
    if (!Array.isArray(providers) || providers.some((one) => typeof one !== 'string')) {
      return null;
    }

    rows.push({
      place: place === '*' ? t.sections.settings.routingFallback : regionName(place),
      providers: (providers as string[]).map(providerName),
      isFallback: place === '*',
    });
  }

  return rows.sort((a, b) => Number(a.isFallback) - Number(b.isFallback));
}

/** The one `json` setting this console can read. A written key, not a shape guess. */
const ROUTING_KEY = 'payment.provider_routing';

/**
 * A country name in Arabic, from the platform rather than from a list written here.
 *
 * `Intl.DisplayNames` — the same documented exception `docs/i18n.md` makes for weekday names and
 * for the customer app's country picker: 245 names in three languages is not copy anybody would
 * translate by hand, and the platform already has them right.
 *
 * Falls back to the CODE, which is what a missing name should look like.
 */
function regionName(code: string): string {
  try {
    return new Intl.DisplayNames([CONSOLE_LOCALE], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * A payment provider in Arabic.
 *
 * Unlike a country, `manual_transfer` is a slug WE chose, so its name is copy. A slug with no
 * entry reads as the slug — a missing translation, looking like one.
 */
function providerName(slug: string): string {
  return t.sections.settings.providers[slug] ?? slug;
}

/**
 * The setting's name in the reader's language.
 *
 * Catalogue first, then the database's own `description_ar`, then the key. The catalogue wins
 * because `settings.description_ar` is one column and therefore one language: using it as the
 * label put words on an Arabic-only screen that the task of adding a language cannot reach. Two of
 * them were already wrong — «مهلة Pending Payment» carried an English status name, and «مهلة تأكيد
 * الشريك (ساعتان)» stated the current VALUE, which stops being true the moment somebody changes it.
 */
export function settingName(setting: {
  key: string;
  descriptionAr: string | null;
}): string {
  return t.sections.settings.names[setting.key] ?? setting.descriptionAr ?? setting.key;
}

/**
 * What kind of value the setting holds, in Arabic.
 *
 * The screen printed «نوع json» and «نوع string» — Zod schema names, in English, to an operator.
 * A schema with no entry falls back to its own name so a miss looks like a missing translation.
 */
export function valueTypeName(valueSchema: string): string {
  return t.sections.settings.valueTypes[valueSchema] ?? valueSchema;
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

  /*
    The NAME as the reader sees it, which is the catalogue's — not the database description that
    used to be the label. Searching the words on screen is the only search that behaves; the
    description stays in the haystack too, since it is the fallback label for an unnamed key.
  */
  return (
    normalise(setting.key).includes(needle) ||
    normalise(settingName(setting)).includes(needle) ||
    normalise(setting.descriptionAr ?? '').includes(needle)
  );
}

/**
 * One entry of `settings_history`, parsed at the boundary.
 *
 * A SCHEMA rather than a cast, because this arrives over the network — the project's rule 1, and
 * the practical reason is that `previousValue` and `newValue` are `unknown` by design, so nothing
 * downstream would notice a payload that had lost its shape. The two values stay `unknown`: they
 * are whatever that setting's own `valueSchema` says, and `settingDisplay` is what reads them.
 */
export const settingHistorySchema = z.object({
  history: z.array(
    z.object({
      previousValue: z.unknown(),
      newValue: z.unknown(),
      reason: z.string().nullable(),
      changedByEmail: z.string().nullable(),
      createdAt: z.string(),
    }),
  ),
});

export type SettingHistoryEntry = z.infer<typeof settingHistorySchema>['history'][number];

/**
 * One history entry as a sentence: «من 0.07 إلى 0.08».
 *
 * Both values go through `settingDisplay`, so the log gets the same units and the same currency
 * the row does — «من $10.00 إلى $12.00», never «من 10 إلى 12». `audit_log.after` and
 * `timeline_events.payload` are held to that by `strings.test.ts`; this is the same rule for the
 * same reason, on a payload a person reads.
 *
 * Each value is isolated, because the sentence around them is Arabic and a bare `0.07` inside it
 * would be reordered by the bidirectional algorithm.
 */
export function historyChange(
  entry: SettingHistoryEntry,
  setting: DisplayableSetting,
  alwaysUsd: boolean,
): string {
  return fill(t.sections.settings.historyChange, {
    previous: valueLine({ ...setting, value: entry.previousValue }, alwaysUsd),
    next: valueLine({ ...setting, value: entry.newValue }, alwaysUsd),
  });
}

/**
 * A value as ONE line of text, with each FIGURE isolated and the Arabic around it left alone.
 *
 * ## The isolate goes round the figure, never round the line
 *
 * `ltrIsolate('90 ليلة')` renders «ليلة 90» — the same swap the row was fixed for, because the
 * whole string is laid out left to right and the Arabic noun ends up on the wrong side of the
 * digits. It read «من ليلة 89 إلى ليلة 90» in the drawer until this was split.
 *
 * So the composition happens here: the figure is isolated, the unit is ordinary Arabic beside it,
 * and the sentence around both is Arabic too. `docs/i18n.md` §9 — isolate the VALUE, never the
 * label.
 *
 * Deliberately reuses `settingDisplay` rather than formatting again: a second formatter is how the
 * log and the row come to disagree about what the same number means.
 */
function valueLine(setting: DisplayableSetting, alwaysUsd: boolean): string {
  const display = settingDisplay(setting, alwaysUsd);

  switch (display.kind) {
    case 'quantity':
      return display.unit
        ? `${ltrIsolate(display.text)} ${display.unit}`
        : ltrIsolate(display.text);
    /* `amount()` is already one left-to-right token — «$10.00», «10.00 ل.س». */
    case 'money':
      return ltrIsolate(display.text);
    case 'flag':
      return display.on ? t.sections.settings.enabled : t.sections.settings.disabled;
    /* Arabic, from the catalogue. Isolating it would be the mistake this function documents. */
    case 'choice':
      return display.text;
    case 'text':
      return ltrIsolate(display.text);
    case 'routing':
      return display.rows
        .map((row) => `${row.place}: ${row.providers.join(' · ')}`)
        .join(' — ');
    case 'json':
      return ltrIsolate(display.text);
    default:
      return t.admin.noData;
  }
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
