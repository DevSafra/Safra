'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { CURRENCY_CATALOGUE, currencyOption } from '@safra/contracts';

import type { CategoryOption } from '@/components/geo-city-editor';
import { t, apiErrorOf } from '@/lib/strings';

/**
 * «+ إضافة دولة» / «+ إضافة عملة» / «+ إضافة مدينة» — the three buttons that did nothing.
 *
 * ## What they were
 *
 * Rendered `aria-disabled` with «لم يُبنَ بعد» as a title, on the reasoning that each needed its
 * own validated form and audit entry. That reasoning was right and the outcome was not: P-005 says
 * launch geography is an OPERATIONAL value staff adjust, and a control that renders and does
 * nothing reads as coverage. Bashar asked for all three (2026-08-30).
 *
 * ## Collapsed until asked for
 *
 * Three permanently-open forms above three small lists would bury the lists, which are what the
 * screen is for. The trigger stays where the disabled button was.
 *
 * ## Nothing here decides anything
 *
 * Each posts to the API, whose schema is the authority on shape and whose `GEO_MANAGE` check is
 * the authority on permission. A currency's code is validated as ISO 4217 there, not here.
 */
export function AddCurrency({
  title,
  existing,
}: {
  readonly title: string;
  /** Codes already on the platform — offering one of them would only earn a 409. */
  readonly existing: readonly string[];
}) {
  const c = t.sections.geo;
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');

  const available = CURRENCY_CATALOGUE.filter((one) => !existing.includes(one.code));
  const chosen = currencyOption(code);

  /**
   * Choosing a code fills everything the code decides, and the names it is usually read by.
   *
   * The symbol and the minor-unit digits are not editable — they are properties of ISO 4217, and
   * the API takes them from the code regardless of what a form sends. The NAMES are prefilled
   * rather than fixed: «دولار أمريكي» is a translation, and a catalogue's suggestion is a starting
   * point somebody may legitimately word differently.
   */
  function choose(next: string): void {
    setCode(next);

    const option = currencyOption(next);

    if (!option) return;

    setNameAr(option.nameAr);
    setNameEn(option.nameEn);
    setNameDe(option.nameDe);
  }

  return (
    <AddForm
      title={title}
      label={c.addCurrency}
      heading={c.addCurrencyTitle}
      marker="currency"
      ready={code !== '' && nameAr !== ''}
      path="/api/geo/currencies"
      body={{ code, nameAr, nameEn: nameEn || nameAr, nameDe: nameDe || nameAr }}
    >
      <Row>
        {/*
          A MENU, not a text box (Bashar, 2026-08-30). A currency code is an identifier from a
          standard, and typing one lets «USD» be saved beside «€» — every dollar on the platform
          then renders with a euro sign, and nothing refuses it.
        */}
        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.currencyCode}
          <select
            name="code"
            value={code}
            onChange={(event) => choose(event.target.value)}
            className="cursor-pointer rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
          >
            <option value="" disabled>
              {c.currencyChoose}
            </option>
            {available.map((one) => (
              <option key={one.code} value={one.code}>
                {`${one.code} · ${one.nameAr}`}
              </option>
            ))}
          </select>
          <span className="text-[10.5px] font-normal text-faint2">
            {c.currencyCodeHint}
          </span>
        </label>

        {/*
          Disabled and filled from the code above. It is shown rather than hidden because an
          operator adding a currency should SEE what will be printed beside every amount in it —
          a field that is absent teaches nothing, and one that is editable is a way to get it
          wrong. `decimals` is not shown at all: it changes no rendering an operator can check.
        */}
        <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
          {c.symbol}
          <input
            name="symbol"
            value={chosen?.symbol ?? ''}
            readOnly
            disabled
            aria-describedby="currency-symbol-note"
            className="cursor-not-allowed rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-faint"
          />
          <span
            id="currency-symbol-note"
            className="text-[10.5px] font-normal text-faint2"
          >
            {c.symbolFromCode}
          </span>
        </label>
      </Row>
      <Row>
        <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
        <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
      </Row>
    </AddForm>
  );
}

export function AddCountry({
  title,
  currencies,
}: {
  readonly title: string;
  readonly currencies: readonly string[];
}) {
  const c = t.sections.geo;
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  /*
    USD, not the first in the list.

    The list is ordered with the ACCOUNTING currency first — SYP — and defaulting to it would
    price a new market in the unit the ledger measures rather than the one §1.4 calls the pricing
    anchor. Both existing launch markets display in USD.
  */
  const [currency, setCurrency] = useState(
    currencies.find((one) => one === 'USD') ?? currencies[0] ?? '',
  );
  const [launch, setLaunch] = useState(false);

  return (
    <AddForm
      title={title}
      label={c.addCountry}
      heading={c.addCountryTitle}
      marker="country"
      ready={code !== '' && nameAr !== '' && currency !== ''}
      path="/api/geo/countries"
      body={{
        code,
        nameAr,
        nameEn: nameEn || nameAr,
        nameDe: nameDe || nameAr,
        displayCurrencyCode: currency,
        isLaunchMarket: launch,
      }}
    >
      <Row>
        <Field
          label={c.countryCode}
          value={code}
          onChange={setCode}
          hint={c.countryCodeHint}
        />
        <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
      </Row>
      <Row>
        <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
      </Row>

      {/*
        A SELECT of currencies that exist, not a text box. A country priced in a currency the
        platform does not hold breaks every listing in it — the API refuses that, and offering the
        choice as free text would make the refusal the operator's first discovery of the rule.
      */}
      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.currency}
        <select
          value={currency}
          onChange={(event) => setCurrency(event.target.value)}
          className="cursor-pointer rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
        >
          {currencies.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      </label>

      <label className="flex cursor-pointer items-center gap-2.5 text-[12.5px] text-text2">
        <input
          type="checkbox"
          checked={launch}
          onChange={(event) => setLaunch(event.target.checked)}
          className="size-[15px] cursor-pointer accent-gold"
        />
        {c.launchMarket}
      </label>
    </AddForm>
  );
}

export function AddCity({
  title,
  countries,
  categories: options,
}: {
  readonly title: string;
  readonly countries: readonly string[];
  /** From `city_categories`, so a category added on الفئات is selectable here immediately. */
  readonly categories: readonly CategoryOption[];
}) {
  const c = t.sections.geo;
  const [countryCode, setCountryCode] = useState(countries[0] ?? '');
  const [slug, setSlug] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [timezone, setTimezone] = useState('Asia/Damascus');
  const [categories, setCategories] = useState<string[]>([]);

  return (
    <AddForm
      title={title}
      label={c.addCity}
      heading={c.addCityTitle}
      marker="city"
      ready={countryCode !== '' && slug !== '' && nameAr !== '' && timezone !== ''}
      path="/api/geo/cities"
      body={{
        countryCode,
        slug,
        nameAr,
        nameEn: nameEn || nameAr,
        nameDe: nameDe || nameAr,
        timezone,
        categories,
      }}
    >
      <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
        {c.country}
        <select
          value={countryCode}
          onChange={(event) => setCountryCode(event.target.value)}
          className="cursor-pointer rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text"
        >
          {countries.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </select>
      </label>

      <Row>
        <Field label={c.slug} value={slug} onChange={setSlug} hint={c.slugHint} />
        <Field
          label={c.timezone}
          value={timezone}
          onChange={setTimezone}
          hint={c.timezoneHint}
        />
      </Row>
      <Row>
        <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
        <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
        <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
      </Row>

      <fieldset className="grid gap-1.5">
        <legend className="text-[11.5px] font-semibold text-muted">
          {c.categoriesLabel}
        </legend>
        <div className="flex flex-wrap gap-2">
          {options.map((option) => (
            <label
              key={option.code}
              className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-text2"
            >
              <input
                type="checkbox"
                checked={categories.includes(option.code)}
                onChange={(event) =>
                  setCategories((current) =>
                    event.target.checked
                      ? [...current, option.code]
                      : current.filter((one) => one !== option.code),
                  )
                }
                className="size-[15px] cursor-pointer accent-gold"
              />
              {option.nameAr}
            </label>
          ))}
        </div>
      </fieldset>
    </AddForm>
  );
}

/**
 * The panel's heading, its trigger and the form beneath — written once for all three.
 *
 * ## Why this owns the heading row
 *
 * The trigger sat in a `<span className="ms-auto">` beside the panel's `<h2>`, and the form opened
 * INSIDE it. `ms-auto` sizes to its content, so the form rendered in a 230px column against the
 * left edge with the panel's whole right half empty — Bashar screenshotted it. `TableToolbar`
 * documents this exact trap for its own `below` slot: «a `w-full` child resolves to the content
 * width and a form placed there renders in a third of the row».
 *
 * So the component takes the heading too, and the form is a sibling of the heading ROW rather than
 * a child of the thing pinned to its end.
 */
function AddForm({
  title,
  heading,
  label,
  marker,
  ready,
  path,
  body,
  children,
}: {
  /** The panel's own «دول الإطلاق» / «العملات» / «المدن». */
  readonly title: string;
  /** The form's own heading — «إضافة دولة», so an open panel says what it is collecting. */
  readonly heading: string;
  readonly label: string;
  /** `data-geo-add` value, so a browser test can find one form among three. */
  readonly marker: string;
  readonly ready: boolean;
  readonly path: string;
  readonly body: Record<string, unknown>;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const c = t.sections.geo;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(): Promise<void> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        setError(apiErrorOf(await response.json().catch(() => null)));

        return;
      }

      setOpen(false);
      router.refresh();
    } catch {
      setError(t.errors.unreachable);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
        <h2 className="text-[14px] font-extrabold text-gold">{title}</h2>
        <span className="ms-auto">
          <button
            type="button"
            data-geo-add={marker}
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
          >
            {label}
          </button>
        </span>
      </div>

      {open ? (
        <div
          data-geo-form={marker}
          className="mb-3 grid w-full gap-3 rounded-[10px] border border-line bg-field p-4 text-start"
        >
          <p className="text-[11.5px] font-bold text-gold">{heading}</p>

          {children}

          {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
            <button
              type="button"
              disabled={busy || !ready}
              onClick={() => void send()}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg bg-gold px-4.5 py-2 text-xs font-bold text-ink transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
            >
              {busy ? c.creating : c.create}
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line px-4 py-2 text-xs font-bold text-muted transition-colors hover:text-text lg:min-h-0"
            >
              {c.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </>
  );
}

/** A row of fields that share the width — one column on a phone, several on a laptop. */
function Row({ children }: { readonly children: ReactNode }) {
  return <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{children}</div>;
}

function Field({
  label,
  value,
  onChange,
  hint,
}: {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly hint?: string | undefined;
}) {
  return (
    <label className="grid gap-1.5 text-[11.5px] font-semibold text-muted">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-[9px] border border-line bg-card px-3 py-2 text-[12.5px] text-text placeholder:text-faint"
      />
      {hint ? (
        <span className="text-[10.5px] font-normal text-faint2">{hint}</span>
      ) : null}
    </label>
  );
}
