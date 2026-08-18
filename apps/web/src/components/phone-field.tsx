'use client';

import { useMemo, useState } from 'react';

import { parsePhoneNumberFromString } from 'libphonenumber-js/max';

import { useTranslations } from 'next-intl';

import type { Locale } from '@/i18n/routing';
import { DIAL_COUNTRIES, dialCountry, flagOf, toE164 } from '@/lib/dial-codes';

/**
 * The registration phone field: a country picker, then the national number (Bashar, 2026-08-18).
 *
 * It replaces a bare `<input type="tel">` whose placeholder was `+963912345678` — a field that
 * asked the customer to know what E.164 is, and to type a country code most people cannot recall
 * for their own country. The picker carries the calling code, so what a person types is the number
 * as it is written on their own phone.
 *
 * ## The API contract did not change
 *
 * A hidden `phone` input carries `+<dial><national>`, so the form still posts one E.164 string and
 * `phoneSchema` is still the authority on what is valid. Nothing server-side knows this component
 * exists, which is what keeps the blast radius to this file.
 *
 * ## Why a native `<select>` and not a custom listbox
 *
 * The design shows a compact control — caret, flag, dial code. A custom combobox would draw that
 * exactly, at the cost of hand-written ARIA, keyboard handling and a focus trap on the one form a
 * stranger meets first. A native select is searchable by typing (`De` jumps to Deutschland), works
 * on a phone's native picker, and is correct for assistive technology without any of that. The
 * option text is `flag · +dial · name` and the control is narrow, so the collapsed state shows the
 * flag and the code and truncates the name — the design's shape, with the platform's behaviour.
 *
 * ## Country names come from `Intl.DisplayNames`
 *
 * 245 names × 3 locales is not copy anybody would translate by hand, and the platform already has
 * them right. This is the same documented exception `docs/i18n.md` makes for weekday and month
 * names, for the same reason.
 */
export function PhoneField({
  locale,
  label,
  hint,
  error,
  defaultValue,
  onChange,
}: {
  readonly locale: Locale;
  readonly label: string;
  readonly hint: string;
  readonly error?: string | undefined;
  /**
   * An E.164 number already on record, split back into its country and its national digits.
   *
   * The profile form edits a stored number, so the field has to be able to show one. Parsed with
   * libphonenumber rather than by matching the longest dial code in the table: `+1` belongs to
   * twenty-odd countries, and a Canadian opening their profile to a United States flag would be
   * told, by the UI, something untrue about their own number.
   */
  readonly defaultValue?: string | undefined;
  /** For a form that keeps its value in React state rather than reading `FormData`. */
  readonly onChange?: ((e164: string) => void) | undefined;
}) {
  const t = useTranslations('auth');

  const initial = useMemo(() => {
    const parsed = defaultValue ? parsePhoneNumberFromString(defaultValue) : undefined;

    /* Syria: the primary market, and what this field's old placeholder already assumed. */
    return {
      code: parsed?.country ?? 'SY',
      national: parsed?.nationalNumber ?? '',
    };
  }, [defaultValue]);

  /* `string`, not libphonenumber's `CountryCode` union: the value comes from a `<select>`. */
  const [code, setCode] = useState<string>(initial.code);
  const [national, setNational] = useState(initial.national);

  const country = dialCountry(code) ?? DIAL_COUNTRIES[0]!;

  /*
    Names resolved once per locale, and SORTED by the reader's own collation — an Arabic reader
    scrolling a list ordered by English names has no way to find their country.

    The launch markets are lifted to the top because they are where most customers are, and a
    separator row would need `<optgroup>` copy in three locales to say so; being first says it.
  */
  const countries = useMemo(() => {
    const names = new Intl.DisplayNames([locale], { type: 'region' });
    const collator = new Intl.Collator(locale);
    const PINNED = ['SY', 'JO', 'LB'];

    return [...DIAL_COUNTRIES]
      .map((entry) => ({ ...entry, name: names.of(entry.code) ?? entry.code }))
      .sort((a, b) => {
        const pinned = PINNED.indexOf(a.code) - PINNED.indexOf(b.code);
        if (PINNED.includes(a.code) || PINNED.includes(b.code)) {
          return PINNED.includes(a.code) && PINNED.includes(b.code)
            ? pinned
            : PINNED.includes(a.code)
              ? -1
              : 1;
        }
        return collator.compare(a.name, b.name);
      });
  }, [locale]);

  const typed = national.replace(/\D/g, '').replace(/^0+/, '');

  /*
    One place composes the value, and both consumers read it from there: the hidden input below for
    a form that submits `FormData`, and this callback for one that holds state. Two separate
    compositions would be two chances for them to disagree about the same field.
  */
  const emit = (nextCode: string, nextNational: string) => {
    const country = dialCountry(nextCode);

    onChange?.(country ? toE164(country.dial, nextNational) : '');
  };

  const id = 'field-phone';
  const describedBy = [error ? `${id}-error` : null, `${id}-hint`]
    .filter(Boolean)
    .join(' ');

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm text-muted">
        {label} <span className="text-gold">*</span>
      </label>

      {/*
        One bordered box around both controls, so they read as a single field. The ring is on the
        BOX via `focus-within` rather than on either control, because a border that moved between
        the two halves as focus crossed them would look like two fields again.
      */}
      <div
        className={`flex items-stretch overflow-hidden rounded-lg border bg-field ${
          error ? 'border-bad' : 'border-line'
        } focus-within:border-gold has-[select:focus-visible]:border-gold`}
      >
        {/*
          The compact control the design draws — caret, flag, dial code — with a REAL `<select>`
          transparent on top of it.

          The select alone could not do this: a native control renders one text for the collapsed
          state and the list, so showing `+963` when closed means showing `+963` for all 245
          options, and a list where every row reads the same is not a list. Narrowing it instead
          truncated the name mid-word — «+963 S» — which reads as a broken field rather than a
          compact one.

          So the summary below is what a person SEES, and the select is what they OPERATE: still
          focusable, still keyboard-searchable, still the phone's native picker, still announced by
          its `aria-label`. The summary is `aria-hidden` because the select already says all of it.
        */}
        <span className="relative flex shrink-0 items-center">
          <span
            aria-hidden="true"
            dir="ltr"
            className="pointer-events-none flex items-center gap-1.5 border-e border-line px-2.5 py-2.5 text-text"
          >
            <svg
              viewBox="0 0 10 6"
              className="h-1.5 w-2.5 fill-faint"
              role="presentation"
            >
              <path d="M0 0h10L5 6z" />
            </svg>
            <span className="text-base leading-none">{flagOf(country.code)}</span>
            <span className="text-sm tabular-nums">+{country.dial}</span>
          </span>

          <select
            aria-label={t('phoneCountry')}
            value={code}
            onChange={(event) => {
              setCode(event.target.value);
              emit(event.target.value, national);
            }}
            data-testid="phone-country"
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
          >
            {countries.map((entry) => (
              <option key={entry.code} value={entry.code}>
                {flagOf(entry.code)} +{entry.dial} {entry.name}
              </option>
            ))}
          </select>
        </span>

        <input
          id={id}
          type="tel"
          inputMode="tel"
          autoComplete="tel-national"
          placeholder={label}
          value={national}
          onChange={(event) => {
            setNational(event.target.value);
            emit(code, event.target.value);
          }}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={describedBy}
          /*
            `required` on the VISIBLE input, so the browser stops an empty submission where it
            always did. It cannot go on the hidden field — a hidden `required` input blocks the
            form with a validation bubble the browser refuses to anchor to anything, so the form
            silently does nothing.

            No `pattern` and no `minLength`. The counter is deliberately advisory (several
            countries have more than one valid national length), and a client rule stricter than
            `phoneSchema` would refuse real numbers that the API accepts. Empty is the one case
            the browser can judge without knowing a dial plan.
          */
          required
          className="field-ltr min-w-0 flex-1 bg-field px-3 py-2.5 text-text outline-none"
        />
      </div>

      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span id={`${id}-hint`} className="text-xs text-faint">
          {hint}
        </span>
        {/*
          The counter, as STRINGS.

          `{typed}` given a NUMBER is formatted by ICU for the locale, and `ar` formats numbers
          with Arabic-Indic digits — so an Arabic customer would read «٠/٩» on a form where every
          other figure is Western (the 2026-08-17 rule). Strings are passed through untouched.
        */}
        <span dir="ltr" className="text-xs text-faint tabular-nums">
          {t('phoneCount', {
            typed: String(typed.length),
            total: String(country.digits),
          })}
        </span>
      </div>

      {/*
        The API's sentence, shown as it comes.

        `phone_invalid` — "That number is not valid in the country selected. Check it, or choose
        another country." — is written for this field: a country was CHOSEN here, so naming it is
        the actionable part. An earlier version of this component re-worded every phone error into
        one generic sentence, which masked exactly that.

        The empty case never reaches the API: `auth-form`'s pre-flight sets `phoneIncomplete`
        before the request, because the form is `noValidate` and `required` does not stop it.
      */}
      {error ? (
        <span id={`${id}-error`} className="text-xs text-bad">
          {error}
        </span>
      ) : null}

      {/* What the form actually posts: one E.164 string, exactly as before this component. */}
      <input type="hidden" name="phone" value={toE164(country.dial, national)} />
    </div>
  );
}
