'use client';

import { useRouter } from 'next/navigation';
import { useState, type ReactNode } from 'react';

import { t, apiErrorOf, cityCategories } from '@/lib/strings';

const CATEGORIES = ['coastal', 'mountain', 'desert', 'historic'] as const;

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
export function AddCurrency() {
  const c = t.sections.geo;
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [symbol, setSymbol] = useState('');

  return (
    <AddForm
      label={c.addCurrency}
      marker="currency"
      ready={code !== '' && nameAr !== '' && symbol !== ''}
      path="/api/geo/currencies"
      body={{ code, nameAr, nameEn: nameEn || nameAr, nameDe: nameDe || nameAr, symbol }}
    >
      <Field
        label={c.currencyCode}
        value={code}
        onChange={setCode}
        hint={c.currencyCodeHint}
      />
      <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
      <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
      <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
      <Field label={c.symbol} value={symbol} onChange={setSymbol} />
    </AddForm>
  );
}

export function AddCountry({ currencies }: { readonly currencies: readonly string[] }) {
  const c = t.sections.geo;
  const [code, setCode] = useState('');
  const [nameAr, setNameAr] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [nameDe, setNameDe] = useState('');
  const [currency, setCurrency] = useState(currencies[0] ?? '');
  const [launch, setLaunch] = useState(false);

  return (
    <AddForm
      label={c.addCountry}
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
      <Field
        label={c.countryCode}
        value={code}
        onChange={setCode}
        hint={c.countryCodeHint}
      />
      <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
      <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
      <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />

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

export function AddCity({ countries }: { readonly countries: readonly string[] }) {
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
      label={c.addCity}
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

      <Field label={c.slug} value={slug} onChange={setSlug} hint={c.slugHint} />
      <Field label={c.nameAr} value={nameAr} onChange={setNameAr} />
      <Field label={c.nameEn} value={nameEn} onChange={setNameEn} />
      <Field label={c.nameDe} value={nameDe} onChange={setNameDe} />
      <Field
        label={c.timezone}
        value={timezone}
        onChange={setTimezone}
        hint={c.timezoneHint}
      />

      <fieldset className="grid gap-1.5">
        <legend className="text-[11.5px] font-semibold text-muted">
          {c.categoriesLabel}
        </legend>
        <div className="flex flex-wrap gap-2">
          {CATEGORIES.map((category) => (
            <label
              key={category}
              className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-text2"
            >
              <input
                type="checkbox"
                checked={categories.includes(category)}
                onChange={(event) =>
                  setCategories((current) =>
                    event.target.checked
                      ? [...current, category]
                      : current.filter((one) => one !== category),
                  )
                }
                className="size-[15px] cursor-pointer accent-gold"
              />
              {cityCategories(category)}
            </label>
          ))}
        </div>
      </fieldset>
    </AddForm>
  );
}

/** The trigger, the panel and the submit — written once for all three. */
function AddForm({
  label,
  marker,
  ready,
  path,
  body,
  children,
}: {
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

  if (!open) {
    return (
      <button
        type="button"
        data-geo-add={marker}
        onClick={() => setOpen(true)}
        className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
      >
        {label}
      </button>
    );
  }

  return (
    <div
      data-geo-form={marker}
      className="mt-2 grid w-full gap-2.5 rounded-[10px] border border-line bg-field p-3.5 text-start"
    >
      {children}

      {error ? <p className="text-[11px] font-semibold text-bad">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
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
  );
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
