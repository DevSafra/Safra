'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { CURRENCY_CATALOGUE, currencyOption, preferredCurrency } from '@safra/contracts';

import type { CategoryOption } from '@/components/geo-city-editor';
import {
  Actions,
  CheckboxField,
  Field,
  Panel,
  Row,
  SelectField,
} from '@/components/geo-form';
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
        <SelectField
          label={c.currencyCode}
          name="code"
          value={code}
          onChange={choose}
          hint={c.currencyCodeHint}
        >
          <option value="" disabled>
            {c.currencyChoose}
          </option>
          {available.map((one) => (
            <option key={one.code} value={one.code}>
              {`${one.code} · ${one.nameAr}`}
            </option>
          ))}
        </SelectField>

        {/*
          Disabled and filled from the code above. It is shown rather than hidden because an
          operator adding a currency should SEE what will be printed beside every amount in it —
          a field that is absent teaches nothing, and one that is editable is a way to get it
          wrong. `decimals` is not shown at all: it changes no rendering an operator can check.
        */}
        <Field
          label={c.symbol}
          name="symbol"
          value={chosen?.symbol ?? ''}
          disabled
          hint={c.symbolFromCode}
        />
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
    anchor. Both existing launch markets display in USD. `preferredCurrency` is that decision,
    shared with every other picker rather than spelled out per form.
  */
  const [currency, setCurrency] = useState<string>(preferredCurrency(currencies));
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
      <Row>
        <SelectField
          label={c.currency}
          name="displayCurrencyCode"
          value={currency}
          onChange={setCurrency}
        >
          {currencies.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </SelectField>
      </Row>

      <CheckboxField label={c.launchMarket} checked={launch} onChange={setLaunch} />
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
      <Row>
        <SelectField
          label={c.country}
          name="countryCode"
          value={countryCode}
          onChange={setCountryCode}
        >
          {countries.map((one) => (
            <option key={one} value={one}>
              {one}
            </option>
          ))}
        </SelectField>
      </Row>

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
        <Panel heading={heading} marker={marker}>
          {children}

          <Actions
            busy={busy}
            ready={ready}
            error={error}
            saveLabel={c.create}
            busyLabel={c.creating}
            cancelLabel={c.cancel}
            onSave={() => void send()}
            onClose={() => setOpen(false)}
          />
        </Panel>
      ) : null}
    </>
  );
}
