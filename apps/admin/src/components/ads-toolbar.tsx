'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import {
  AD_BILLING_PERIODS,
  ADVERTISER_KINDS,
  preferredCurrency,
  type AdBillingPeriod,
  type AdvertiserKind,
} from '@safra/contracts';

import { t, apiErrorOf, label } from '@/lib/strings';
import { TableToolbar } from './table-toolbar';

/**
 * §9.3's «+ حملة جديدة», and the advertiser behind it.
 *
 * ## Two forms, because a campaign needs an advertiser that exists
 *
 * `advertisers` had no create route and no screen, so the first campaign could never be made:
 * every one needs an advertiser reference and there was nowhere to get one. Adding a business is a
 * small administrative act — a name, a kind, a city — and it belongs beside the thing that needs
 * it rather than behind a separate section nobody would find.
 *
 * The new advertiser's REFERENCE is shown after it is created, because that is what the campaign
 * form asks for and it is not otherwise discoverable.
 *
 * ## The toolbar is drawn here
 *
 * The trigger belongs in the bar and the panel belongs under it at the table's full width, and
 * they share one piece of state — the lesson بطاقات الهدايا and الكوبونات both learned.
 */
export function AdsToolbar({
  action,
  query,
  size,
  placeholder,
  currencies,
  carry,
}: {
  readonly action: string;
  readonly query: string | undefined;
  readonly size: number;
  readonly placeholder: string;
  readonly currencies: readonly string[];
  /** فواتير الإعلانات's position — a search here must not reset the table below. */
  readonly carry: Readonly<Record<string, string | undefined>>;
}) {
  const router = useRouter();
  const c = t.sections.ads;

  const [open, setOpen] = useState<'none' | 'campaign' | 'advertiser'>('none');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  /* The advertiser form. */
  const [advName, setAdvName] = useState('');
  const [advKind, setAdvKind] = useState<AdvertiserKind>('restaurant');
  const [advCity, setAdvCity] = useState('');
  const [advEmail, setAdvEmail] = useState('');
  const [advPhone, setAdvPhone] = useState('');

  /* The campaign form. */
  const [advertiser, setAdvertiser] = useState('');
  const [citySlug, setCitySlug] = useState('');
  const [headlineAr, setHeadlineAr] = useState('');
  const [headlineEn, setHeadlineEn] = useState('');
  const [headlineDe, setHeadlineDe] = useState('');
  const [descriptionAr, setDescriptionAr] = useState('');
  const [descriptionEn, setDescriptionEn] = useState('');
  const [descriptionDe, setDescriptionDe] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [billing, setBilling] = useState<AdBillingPeriod>('monthly');
  const [price, setPrice] = useState('');
  /*
    The platform's standard currency, not `currencies[0]` — it decides what an advertiser is
    billed in when an operator does not touch the select. This reasoning was written here first
    and is now `preferredCurrency`, shared, because three other forms had the same decision to
    make and made it by taking the first entry of a list.
  */
  const [currency, setCurrency] = useState<string>(preferredCurrency(currencies));
  const [startsOn, setStartsOn] = useState('');
  const [endsOn, setEndsOn] = useState('');

  const field = 'rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-text';
  const labelled = 'grid gap-1.5 text-[11.5px] font-semibold text-muted';

  async function send(
    path: string,
    body: unknown,
  ): Promise<Record<string, unknown> | null> {
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload: unknown = await response.json().catch(() => null);

      if (!response.ok) {
        setError(apiErrorOf(payload));

        return null;
      }

      return (payload ?? {}) as Record<string, unknown>;
    } catch {
      setError(t.errors.unreachable);

      return null;
    } finally {
      setBusy(false);
    }
  }

  /*
    Shape only. Every rule that decides whether a campaign is COHERENT — a window in order, a price
    with its currency, a target that is http or https — is re-checked by the schema and, where it
    matters, by the database. This stops the obvious typo costing a round trip.
  */
  const campaignReady =
    advertiser.trim() !== '' &&
    citySlug.trim() !== '' &&
    headlineAr.trim().length >= 2 &&
    headlineEn.trim().length >= 2 &&
    headlineDe.trim().length >= 2 &&
    /^https?:\/\/\S+$/.test(targetUrl.trim()) &&
    startsOn !== '' &&
    endsOn !== '' &&
    endsOn > startsOn &&
    (price.trim() === '' || /^\d{1,10}(\.\d{1,3})?$/.test(price.trim())) &&
    !busy;

  const advertiserReady = advName.trim().length >= 2 && advCity.trim() !== '' && !busy;

  const panel =
    open === 'advertiser' ? (
      <div className="grid w-full gap-3 rounded-card border border-line bg-field p-3.5">
        <h3 className="text-[13px] font-bold text-text">{c.advTitle}</h3>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className={labelled}>
            {c.advName}
            <input
              value={advName}
              onChange={(e) => setAdvName(e.target.value)}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.advKind}
            <select
              value={advKind}
              onChange={(e) => setAdvKind(e.target.value as AdvertiserKind)}
              className={`cursor-pointer ${field}`}
            >
              {ADVERTISER_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {label(t.enums.advertiserKind, kind)}
                </option>
              ))}
            </select>
          </label>
          <label className={labelled}>
            {c.fCity}
            <input
              value={advCity}
              onChange={(e) => setAdvCity(e.target.value)}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.advEmail}
            <input
              value={advEmail}
              onChange={(e) => setAdvEmail(e.target.value)}
              className={`field-ltr ${field}`}
            />
          </label>
          <label className={labelled}>
            {c.advPhone}
            <input
              value={advPhone}
              onChange={(e) => setAdvPhone(e.target.value)}
              className={`field-ltr ${field}`}
            />
          </label>
        </div>

        {error ? <p className="text-[11.5px] font-semibold text-bad">{error}</p> : null}
        {created ? (
          <p className="text-[11.5px] font-semibold text-gold">
            {c.advCreated.replace('{reference}', created)}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!advertiserReady}
            onClick={() => {
              void (async () => {
                const made = await send('/api/advertisers', {
                  name: advName.trim(),
                  kind: advKind,
                  citySlug: advCity.trim(),
                  /* Both optional in the contract, and `.strict()` refuses an empty string. */
                  ...(advEmail.trim() ? { contactEmail: advEmail.trim() } : {}),
                  ...(advPhone.trim() ? { contactPhone: advPhone.trim() } : {}),
                });

                if (made && typeof made['reference'] === 'string') {
                  /*
                    Straight into the CAMPAIGN form, with the new reference already in it.

                    Leaving this panel open was the first thing driving it in a browser found: the
                    triggers are hidden while a panel is open, so «+ حملة جديدة» was unreachable
                    without pressing «إلغاء» — and pressing it discarded the reference the operator
                    had just been shown and now needed to type. An advertiser is only ever created
                    BECAUSE a campaign needs one, so this is the step that was actually being asked
                    for; the confirmation travels with it and says what was made.
                  */
                  setCreated(made['reference']);
                  setAdvertiser(made['reference']);
                  setAdvCity(advCity.trim());
                  setAdvName('');
                  setAdvEmail('');
                  setAdvPhone('');
                  setCitySlug(advCity.trim());
                  setOpen('campaign');
                  router.refresh();
                }
              })();
            }}
            className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
          >
            {busy ? t.table.working : c.advSubmit}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen('none');
              setError(null);
              setCreated(null);
            }}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-muted lg:min-h-0"
          >
            {c.cancel}
          </button>
        </div>
      </div>
    ) : open === 'campaign' ? (
      <div className="grid w-full gap-3 rounded-card border border-line bg-field p-3.5">
        <h3 className="text-[13px] font-bold text-text">{c.newTitle}</h3>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <label className={labelled}>
            {c.fAdvertiser}
            <input
              value={advertiser}
              onChange={(e) => setAdvertiser(e.target.value)}
              placeholder={c.fAdvertiserPlaceholder}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.fCity}
            <input
              value={citySlug}
              onChange={(e) => setCitySlug(e.target.value)}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.fTargetUrl}
            {/* `field-ltr`: a URL is read left-to-right whatever the page direction. */}
            <input
              value={targetUrl}
              onChange={(e) => setTargetUrl(e.target.value)}
              placeholder={c.fTargetPlaceholder}
              className={`field-ltr ${field}`}
            />
          </label>

          {/*
            Three headlines, all required — exactly as a property needs three names. The customer
            app serves ar, en and de; one headline is the wrong language for two thirds of readers.
          */}
          <label className={labelled}>
            {c.fHeadlineAr}
            <input
              value={headlineAr}
              onChange={(e) => setHeadlineAr(e.target.value)}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.fHeadlineEn}
            <input
              value={headlineEn}
              onChange={(e) => setHeadlineEn(e.target.value)}
              className={`field-ltr ${field}`}
            />
          </label>
          <label className={labelled}>
            {c.fHeadlineDe}
            <input
              value={headlineDe}
              onChange={(e) => setHeadlineDe(e.target.value)}
              className={`field-ltr ${field}`}
            />
          </label>

          {/*
            Three descriptions, none of them required (Bashar, 2026-08-31).

            A campaign is a complete advertisement without one — the card renders a headline, an
            advertiser and a link — so an empty box is a choice rather than an unfinished form.
            A textarea because this is a sentence: a one-line input for it would make an operator
            scroll their own copy sideways to read it back.
          */}
          <label className={labelled}>
            {c.fDescriptionAr}
            <textarea
              value={descriptionAr}
              onChange={(e) => setDescriptionAr(e.target.value)}
              rows={2}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.fDescriptionEn}
            <textarea
              value={descriptionEn}
              onChange={(e) => setDescriptionEn(e.target.value)}
              rows={2}
              className={`field-ltr ${field}`}
            />
          </label>
          <label className={labelled}>
            {c.fDescriptionDe}
            <textarea
              value={descriptionDe}
              onChange={(e) => setDescriptionDe(e.target.value)}
              rows={2}
              className={`field-ltr ${field}`}
            />
          </label>

          <label className={labelled}>
            {c.fBilling}
            <select
              value={billing}
              onChange={(e) => setBilling(e.target.value as AdBillingPeriod)}
              className={`cursor-pointer ${field}`}
            >
              {AD_BILLING_PERIODS.map((period) => (
                <option key={period} value={period}>
                  {period === 'weekly'
                    ? c.billingWeekly
                    : period === 'quarterly'
                      ? c.billingQuarterly
                      : c.billingMonthly}
                </option>
              ))}
            </select>
          </label>
          <label className={labelled}>
            {c.fPrice}
            <input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              inputMode="decimal"
              placeholder="0.00"
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.fCurrency}
            <select
              value={currency}
              onChange={(e) => setCurrency(e.target.value)}
              className={`cursor-pointer ${field}`}
            >
              {currencies.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </label>

          <label className={labelled}>
            {c.fStarts}
            <input
              type="date"
              value={startsOn}
              onChange={(e) => setStartsOn(e.target.value)}
              className={field}
            />
          </label>
          <label className={labelled}>
            {c.fEnds}
            <input
              type="date"
              value={endsOn}
              onChange={(e) => setEndsOn(e.target.value)}
              className={field}
            />
          </label>
        </div>

        {created ? (
          <p className="text-[11.5px] font-semibold text-gold">
            {c.advCreated.replace('{reference}', created)}
          </p>
        ) : null}
        {error ? <p className="text-[11.5px] font-semibold text-bad">{error}</p> : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!campaignReady}
            onClick={() => {
              void (async () => {
                const made = await send('/api/ad-campaigns', {
                  advertiserReference: advertiser.trim(),
                  citySlug: citySlug.trim(),
                  headlineAr: headlineAr.trim(),
                  headlineEn: headlineEn.trim(),
                  headlineDe: headlineDe.trim(),
                  /*
                    Omitted when blank, never sent as ''. The schema is `.nullable().optional()`,
                    so an absent key is «no description» and an empty string would be a description
                    two characters short of the minimum — a refusal for a field nobody filled in.
                  */
                  ...(descriptionAr.trim()
                    ? { descriptionAr: descriptionAr.trim() }
                    : {}),
                  ...(descriptionEn.trim()
                    ? { descriptionEn: descriptionEn.trim() }
                    : {}),
                  ...(descriptionDe.trim()
                    ? { descriptionDe: descriptionDe.trim() }
                    : {}),
                  targetUrl: targetUrl.trim(),
                  billingPeriod: billing,
                  /* A price and its currency travel together, or neither does. */
                  ...(price.trim()
                    ? { priceAmount: price.trim(), priceCurrency: currency }
                    : {}),
                  startsOn,
                  endsOn,
                });

                if (made) {
                  setOpen('none');
                  setCreated(null);
                  setHeadlineAr('');
                  setHeadlineEn('');
                  setHeadlineDe('');
                  setTargetUrl('');
                  setPrice('');

                  /*
                    Straight to the new campaign, with its creative dialog open — Bashar,
                    2026-08-27. A campaign is valid without a picture and stays that way; this
                    only puts the operator in front of the control instead of leaving them to
                    find the row.

                    A LITERAL `/ads`, never a path assembled from anything the server returned,
                    and the reference percent-encoded into the one parameter. Unfiltered and on
                    page one deliberately: the registry is ordered `created_at DESC`, so this is
                    the only view where the new row is guaranteed to be present to open.
                  */
                  const reference = made['reference'];

                  if (typeof reference === 'string' && reference !== '') {
                    router.replace(`/ads?created=${encodeURIComponent(reference)}`);
                  }

                  router.refresh();
                }
              })();
            }}
            className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4.5 py-2 text-xs font-bold text-gold disabled:cursor-not-allowed disabled:opacity-50 lg:min-h-0"
          >
            {busy ? t.table.working : c.submit}
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen('none');
              setError(null);
              setCreated(null);
            }}
            className="min-h-10 cursor-pointer rounded-lg border border-line px-4.5 py-2 text-xs font-bold text-muted lg:min-h-0"
          >
            {c.cancel}
          </button>
        </div>
      </div>
    ) : null;

  return (
    <TableToolbar
      action={action}
      query={query}
      size={size}
      placeholder={placeholder}
      carry={carry}
      end={
        panel === null ? (
          <>
            <button
              type="button"
              onClick={() => setOpen('advertiser')}
              className="min-h-10 cursor-pointer rounded-lg border border-line px-4 py-1.5 text-[12.5px] font-bold text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold lg:min-h-0"
            >
              {c.newAdvertiser}
            </button>
            <button
              type="button"
              onClick={() => setOpen('campaign')}
              className="min-h-10 cursor-pointer rounded-lg border border-[rgba(var(--goldA),0.4)] px-4 py-1.5 text-[12.5px] font-extrabold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)] lg:min-h-0"
            >
              {c.create}
            </button>
          </>
        ) : null
      }
      below={panel}
    />
  );
}
