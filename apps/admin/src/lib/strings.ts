import IntlMessageFormat from 'intl-messageformat';

import { adminAr, errorMessage, fill, type Locale } from '@safra/i18n';

/**
 * The staff console's copy, and the lookups that read it.
 *
 * ## What changed and why
 *
 * The copy itself moved to `@safra/i18n` (`messages/admin/ar.ts`). This file used to hold an
 * 818-line constant named `AR`, which put the LANGUAGE in the name of every one of the 577
 * call sites reading it: `AR.bookings.title` cannot become German without editing all 577.
 * `t.bookings.title` can, so the binding below is the only line that names a locale.
 *
 * What stays here is lookup LOGIC, not copy — `bookingStatus`, `label`, `auditAction`,
 * `roleName`, `apiError`. Each maps a machine value onto a catalogue entry and decides what
 * to do when there is no entry, which is a decision about this app rather than about wording.
 *
 * ## Why `adminAr` and not `adminMessages(locale)`
 *
 * The console is Arabic-only (Bashar, 2026-08-03). `adminAr` carries the literal types that
 * let `fill()` check placeholder names at compile time, so `fill(t.staff.inviteSent, { emial })`
 * does not build. `adminMessages(locale)` returns the widened type, which a registry of three
 * languages has to, and there is no reason to pay that while there is one language.
 *
 * When a second console language arrives this becomes `adminMessages(locale)` — one line, here
 * — and placeholder checking hands over to the `completeness` tests in `@safra/i18n`.
 */
export const CONSOLE_LOCALE: Locale = 'ar';

export const t = adminAr;

/**
 * The sidebar's element id, shared by the hamburger's `aria-controls` and the aside itself.
 *
 * A constant rather than a literal in both files: `aria-controls` pointing at an id that does not
 * exist is invisible to everyone except the screen-reader user it was added for.
 */
export const SIDEBAR_ID = 'console-nav';

/** Re-exported so components interpolate copy without also importing the package. */
export { fill };

/**
 * The booking status in Arabic, falling back to the raw value rather than blank.
 *
 * The fallback returns the key UNCHANGED — see `label()` for why spacing the underscores out was
 * the thing that hid forty-three missing translations.
 */
export function bookingStatus(status: string): string {
  return t.bookingStatus[status] ?? status;
}

/**
 * Looks a value up in one of the enum maps.
 *
 * ## The fallback returns the key VERBATIM, and that is the whole point
 *
 * It used to return `value.replace(/_/g, ' ')`, on the reasoning quoted here: "deliberately ugly —
 * an untranslated status should look like a missing translation, not like a design choice". The
 * reasoning was right and the implementation did the opposite. Spacing the underscores out of
 * `booking.export_requested` produces "booking.export requested"; `auditAction` also stripped the
 * dot, producing "auth password changed" — which does not look like a missing translation at all.
 * It looks like a label somebody chose.
 *
 * The cost was measured on 2026-08-20: **forty-three** of the seventy-three audit actions the code
 * emits had no Arabic label, and all three notification templates the platform actually sends had
 * none either. None of it was caught, because `navigation.spec.ts` sweeps every console section for
 * snake_case — and this function had already removed the underscore it greps for.
 *
 * So a miss now surfaces as the identifier itself. It is uglier on screen, which is the intent, and
 * it puts the existing sweep back in charge of catching the next one.
 */
export function label(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (!value) return t.admin.noData;

  return map[value] ?? value;
}

/** A city's `categories` array arrives pre-joined; translate each part. */
export function cityCategories(joined: string): string {
  return joined
    .split(' · ')
    .map((part) => t.enums.cityCategory[part] ?? part)
    .join(' · ');
}

/**
 * A cancellation reason, which is EITHER a `system.*` code or a person's own sentence.
 *
 * Its own function rather than `label()` because `label` answers «—» for an absent value, which is
 * right in a table cell and wrong for prose. An unknown value is returned exactly as stored, which
 * covers both a human's words and the English sentences written into rows before the codes existed.
 */
export function cancellationReason(reason: string): string {
  return t.enums.cancellationReason[reason] ?? reason;
}

/**
 * A timeline event's payload, as readable label/value pairs.
 *
 * Replaces printing the JSON verbatim. The reasoning for showing the payload at all is that a
 * timeline which SUMMARISES loses the detail a dispute turns on — which fine was applied, which
 * occurrence number — and that argues for dropping no field, not for showing braces. So every
 * entry survives: an unknown key falls back to itself, and an unknown value is printed as stored.
 *
 * A non-scalar value (a nested object, an array) is re-serialised rather than flattened, because
 * flattening it is where a field would actually go missing.
 */
export function payloadEntries(
  payload: unknown,
): readonly { key: string; label: string; value: string }[] {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload))
    return [];

  const fields = payload as Record<string, unknown>;

  /*
    Each amount takes ITS OWN currency, and only falls back to the payload's general one.

    One currency for the whole payload was wrong, and confidently wrong. An SLA compensation on a
    JOD booking paid into a USD wallet writes `fine` and `compensation` in the BOOKING's currency
    beside `creditedAmount` in the WALLET's — the payload is built that way on purpose, and the
    comment where it is written names the case. `creditedCurrency` sat in the general list, so it
    was found first and stamped onto all four: «الغرامة 10.000 USD» for a fine of 10.000 JOD.

    A bare number is a number nobody can act on. A number wearing the wrong currency is worse —
    it is one somebody acts on and is wrong by whatever the two currencies differ by, which
    between SYP and USD is four orders of magnitude.
  */
  const general = currencyOf(fields, GENERAL_CURRENCY_KEYS);
  const currencyFor = (key: string): string | null =>
    (PAIRED_CURRENCY_KEY[key] !== undefined
      ? currencyOf(fields, [PAIRED_CURRENCY_KEY[key]])
      : null) ?? general;

  /* A currency row is dropped only where its own amount actually carried it. */
  const consumed = new Set(
    Object.keys(fields)
      .filter((key) => MONEY_KEYS.has(key) && currencyFor(key) !== null)
      .map((key) => PAIRED_CURRENCY_KEY[key] ?? '')
      .filter((key) => key !== '' && currencyOf(fields, [key]) !== null),
  );

  if (general !== null && Object.keys(fields).some((key) => MONEY_KEYS.has(key))) {
    for (const key of GENERAL_CURRENCY_KEYS) {
      if (currencyOf(fields, [key]) === general) consumed.add(key);
    }
  }

  return (
    Object.entries(fields)
      /*
        The currency's OWN row goes, once it is on the amounts.

        Otherwise «المبلغ 90.00 USD» is followed by «العملة USD», which is the same fact twice and
        reads as though the two might differ. It is dropped only when it was actually attached to
        something — a payload carrying a currency and no money key keeps its row, because there it
        is the only place the currency appears at all.
      */
      .filter(([key]) => !consumed.has(key))
      .map(([key, value]) => {
        const currency = MONEY_KEYS.has(key) ? currencyFor(key) : null;

        return {
          key,
          label: t.enums.payloadKey[key] ?? key,
          value: currency ? `${payloadValue(value)} ${currency}` : payloadValue(value),
        };
      })
  );
}

/**
 * The payload keys that hold an AMOUNT OF MONEY, and nothing else.
 *
 * ## Named, not sniffed
 *
 * A heuristic over "looks like a decimal" would attach a currency to `rate` — an FX rate of
 * 13000.00 is not 13,000 dollars — and to `percent`. Both are numbers in the same payloads. So the
 * set is written down, and `strings.test.ts` holds it.
 *
 * ## Grounded in the data, not invented
 *
 * Every entry here was read out of the live `timeline_events.payload` and `audit_log.after` key
 * lists on 2026-08-25 rather than guessed at. A key that is money and missing from this set renders
 * bare, which is exactly today's behaviour — the failure mode is the old one, not a wrong one.
 */
const MONEY_KEYS = new Set([
  'amount',
  'appliedAmount',
  'balance',
  'basePrice',
  'compensation',
  'compensationAmount',
  'creditedAmount',
  'fine',
  'fineAmount',
  'net',
  'price',
  'providerAmount',
  'remainingAmount',
  'requestedAmount',
  'toProvider',
  'toWallet',
  'total',
  'walletAmount',
  'walletBalance',
]);

/**
 * The currency this payload states, if it states one.
 *
 * ## Why the payload has to say, rather than the screen assuming
 *
 * A booking's own currency is on the screen already, and using it would be wrong the moment the two
 * differ — a compensation credited in USD on a booking priced in SYP is exactly the case where an
 * assumed currency is worse than none. So a payload gets a currency only when it carries one.
 *
 * ## And nothing is attached when it does not
 *
 * Every row written before 2026-08-25 has no currency key, and `audit_log` is append-only — there
 * is no backfilling it. Those render exactly as they do today, which is the honest outcome: an
 * amount whose currency was never recorded must not be shown wearing a guess.
 */
/**
 * The currency a payload states for its amounts GENERALLY — the booking's, the payment's.
 *
 * `creditedCurrency` used to be in here and that was the leak: it is the WALLET's currency, which
 * on a cross-currency compensation is not the currency of the fine or the compensation sitting
 * beside it in the same payload. It is paired below instead, so it reaches its own amount and
 * nothing else.
 */
const GENERAL_CURRENCY_KEYS = ['currency', 'currencyCode'];

/**
 * Amounts that state their own currency, and the key each one states it in.
 *
 * These exist because a single payload legitimately holds money in two currencies — what a staff
 * member asked for against what the wallet took, what a booking was priced at against what landed
 * in a differently denominated balance. Where a pair exists it WINS over the general currency; a
 * money key with neither renders bare, which is the old behaviour rather than a wrong one.
 */
const PAIRED_CURRENCY_KEY: Record<string, string | undefined> = {
  creditedAmount: 'creditedCurrency',
  requestedAmount: 'requestedCurrency',
  compensationAmount: 'compensationCurrency',
  walletBalance: 'walletCurrency',
};

function currencyOf(
  fields: Record<string, unknown>,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = fields[key];

    /* Three letters, upper case — an ISO code and not a name, a symbol or an id. */
    if (typeof value === 'string' && /^[A-Z]{3}$/.test(value)) return value;
  }

  return null;
}

/**
 * Each scalar type named rather than `String(value)` over whatever is left.
 *
 * `String()` on an unexpected object yields `[object Object]`, which is a field silently replaced
 * by nothing — the one outcome this rendering exists to prevent. Lint flags it; the fix is to say
 * what a string, a number and a boolean each become, and to let everything else keep its JSON.
 */
function payloadValue(value: unknown): string {
  if (value === null || value === undefined) return t.admin.noData;

  // Only a string can be a code, so only a string is looked up.
  if (typeof value === 'string') return t.enums.payloadValue[value] ?? value;

  /*
    A boolean is a WORD, not a literal. `String(value)` printed `true`/`false` — English, on an
    Arabic screen, in a column that exists to be read (Bashar, 2026-08-20).
  */
  if (typeof value === 'boolean') return value ? t.admin.yes : t.admin.no;

  if (typeof value === 'number') return String(value);

  /*
    A list of SCALARS reads as a list; anything else stays JSON.

    `staff.scope_changed` carries `citySlugs`, so this column was about to print `["petra","aleppo"]`
    — brackets, quotes and all — which is the JSON-in-a-narrow-column problem this function exists
    to remove. Each element goes through the same lookup, so a list of codes is translated element by
    element and a list of slugs stays as slugs, which is what a slug is for.

    The `every` guard is not defensive tidiness: joining an array of OBJECTS was my first version and
    it turned `[{ days: 7 }]` into `{"days":7}`, silently dropping the fact that it was a list of
    one. `strings.test.ts` caught it — a pricing payload really does carry nested tiers, and
    "re-serialise rather than lose it" is that test's whole point.
  */
  if (Array.isArray(value)) {
    if (value.length === 0) return t.admin.noData;

    if (value.every((item) => typeof item !== 'object' || item === null)) {
      return value.map((item) => payloadValue(item)).join(' · ');
    }
  }

  return JSON.stringify(value) ?? t.admin.noData;
}

/** One field that differs between two payloads, already resolved into the reader's language. */
export interface PayloadChange {
  readonly key: string;
  readonly label: string;
  readonly before: string | undefined;
  readonly after: string | undefined;
}

/**
 * What CHANGED between two payloads, named and worded in Arabic.
 *
 * ## Why the diff lives here rather than in the page
 *
 * Because the labelling does. سجل التدقيق rendered its own grid and looked up nothing, so every
 * field name and every status value printed in English under «الحقل», «قبل» and «بعد» — `status`,
 * `basePrice`, `pending_confirmation` — on a console that is Arabic-only (Bashar, 2026-08-20).
 * Putting the resolution next to `payloadEntries` is what stops the two renderings of the same
 * jsonb drifting into two vocabularies.
 *
 * Keys are unioned with `after`'s order first: an update's payload is written in the order its
 * author thought about the fields, and that is the order a reader follows.
 *
 * A field whose two sides are EQUAL is dropped. That is not tidying — the console was showing
 * `{"before":{"status":"contacted"},"after":{"status":"contacted"}}`, an entry whose whole content
 * was that nothing had changed. Compared before resolution, on the stored values, so two different
 * codes that happen to share a translation still count as a change.
 *
 * `undefined` on a side means that side had no such field — rendered by the caller, because "no
 * value" and "the value «—»" are the same glyph and only the caller knows whether a column of them
 * is worth drawing at all.
 */
export function payloadChanges(
  before: unknown,
  after: unknown,
): readonly PayloadChange[] {
  const from = plainObject(before);
  const to = plainObject(after);

  if (!from && !to) return [];

  const changes: PayloadChange[] = [];
  const seen = new Set<string>();

  for (const key of [...Object.keys(to ?? {}), ...Object.keys(from ?? {})]) {
    if (seen.has(key)) continue;
    seen.add(key);

    const left = from?.[key];
    const right = to?.[key];

    if (JSON.stringify(left) === JSON.stringify(right)) continue;

    changes.push({
      key,
      label: t.enums.payloadKey[key] ?? key,
      before: from && key in from ? payloadValue(left) : undefined,
      after: to && key in to ? payloadValue(right) : undefined,
    });
  }

  return changes;
}

/** A jsonb payload as it actually arrives: an object of scalars, or nothing usable. */
function plainObject(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The Arabic name for an audit action, falling back to the raw key rather than blank. */
export function auditAction(action: string): string {
  return t.auditAction[action] ?? action;
}

/**
 * What an audit entry was about — `audit_log.subject_type`.
 *
 * Its own function rather than `label()` for one reason: `label` answers «—» for an absent value,
 * which is right in a table CELL and wrong here, where the subject sits inline beside the action
 * and an em dash would read as part of the sentence. An unnamed subject falls back to its key,
 * the same contract `auditAction` has.
 */
export function auditSubject(subjectType: string): string {
  return t.auditSubject[subjectType] ?? subjectType;
}

/** The Arabic name for a role, falling back to the raw value rather than blank. */
export function roleName(role: string | undefined): string {
  if (!role) return '';

  return t.roles[role] ?? role;
}

/**
 * The Arabic message for a failed API call.
 *
 * ## What this used to do
 *
 * It regex-matched the API's ENGLISH prose:
 *
 * ```ts
 * if (/invalid email or password/i.test(message)) return AR.errors.credentials;
 * ```
 *
 * Six patterns, and everything else fell through to "something went wrong". Two problems, both
 * live: rewording an API message silently broke the Arabic with no test failing, and the 77
 * conditions with no pattern showed an operator a generic string when the API knew exactly
 * what had happened.
 *
 * The API now answers with a stable `code`, so this is a catalogue lookup over all 101 of them.
 * `errorMessage` handles a code this build does not recognise — an API deployed ahead of the
 * console — by falling back rather than printing the code.
 */
/**
 * What a violation SAYS happened — the operator's words, or the sentence for its KIND.
 *
 * The console's counterpart to the portal's `violationDescription`, and it exists for the same
 * reason: a violation raised by hand carries a description, and the ones the PLATFORM writes carry
 * none. An operator deciding whether to waive a fine was reading a category and a figure.
 *
 * Stored words always win. The catalogue sentence is a fallback for a machine-written violation,
 * never a paraphrase of a human one.
 */
export function violationDescription(violation: {
  readonly kind: string;
  readonly description: string | null;
  readonly bookingReference?: string | null | undefined;
}): string | null {
  if (violation.description) return violation.description;

  const withBooking = t.enums.violationDefaultDescription[violation.kind];

  if (violation.bookingReference && withBooking) {
    return fill(withBooking, { reference: violation.bookingReference });
  }

  return (
    t.enums.violationDefaultDescriptionNoBooking[violation.kind] ??
    (violation.bookingReference ? null : withBooking) ??
    null
  );
}

export function apiError(code: string | null): string {
  return errorMessage(code, CONSOLE_LOCALE);
}

/**
 * The Arabic sentence for a refusal, taken from a response BODY rather than a code.
 *
 * ## Why this exists — reading the wrong field is silent
 *
 * An API refusal is `{ statusCode, code, message }`, and `message` is ENGLISH prose kept for logs
 * (`app-error.ts`). Handing that to `apiError` looks right and is not: `isErrorCode` rejects a
 * sentence, so `errorMessage` falls back and the reader gets «حدث خطأ ما» for every refusal the
 * platform can name precisely. Nothing fails — the screen shows Arabic, just the wrong Arabic —
 * which is why it survived a passing browser test that only asserted the text WAS Arabic.
 *
 * Found on 2026-08-23: a duplicate employee-role name answered 409 `employee_role.name_taken` and
 * the form said "something went wrong", so the operator could not tell a clash from an outage.
 *
 * `code` first, then `message`, and the fallback is not laziness: the console's own BFF routes
 * refuse malformed bodies before the API is called and put the CODE in `message`, because there is
 * no upstream response to copy a `code` from. One reader, both shapes.
 */
export function apiErrorOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return apiError(null);

  if ('code' in body && typeof body.code === 'string') return apiError(body.code);
  if ('message' in body && typeof body.message === 'string')
    return apiError(body.message);

  return apiError(null);
}

/**
 * A message whose wording depends on a COUNT.
 *
 * ## Why `fill` cannot do this
 *
 * `fill` substitutes placeholders. That is the right tool for «{city} · {type}» and the wrong one
 * for «{nights} ليلة», because Arabic agreement is not substitution: the noun changes with the
 * number, and it changes at boundaries an English speaker does not expect.
 *
 * - 3–10 is `few` and takes the broken plural — «٥ ليالٍ».
 * - **11–99 is `many` and takes the SINGULAR** — «١٥ ليلة», never «١٥ ليالٍ».
 * - 100 and above is `other`, singular again.
 *
 * The console printed «٤ ليلة» — correct for one night, wrong for four — on the booking detail an
 * operator reads all day. Teaching `fill` these rules would turn a placeholder substituter into a
 * small translation library; using ICU, which the customer app already speaks, keeps one mechanism
 * across both apps and puts the rules in `Intl.PluralRules` where they belong.
 *
 * ## Counts arrive as NUMBERS
 *
 * Not as `count(n)`. `IntlMessageFormat` formats the digits itself in `ar`, so the Arabic-Indic
 * numerals still appear — and passing a pre-formatted string would give `Intl.PluralRules` nothing
 * numeric to classify, so every message would silently resolve to `other` and read as the
 * singular. That failure leaves every test green, which is why the counts are typed as numbers.
 */
export function plural(message: string, values: Record<string, number | string>): string {
  return String(new IntlMessageFormat(message, CONSOLE_LOCALE).format(values));
}
