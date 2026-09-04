import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TRIP_ATTRIBUTES } from '@safra/contracts';

import { PropertyCard } from '@/components/property-card';
import { SearchFilters } from '@/components/search-filters';
import { SearchForm } from '@/components/search-form';
import { isLocale, type Locale } from '@/i18n/routing';
import {
  getAmenities,
  getCities,
  getPropertyTypes,
  getPublicSettings,
} from '@/lib/catalog';
import { searchSafely } from '@/lib/api';
import { todayInDamascus } from '@/lib/settings';

/**
 * Results page (§5.5).
 *
 * Dynamic by necessity — results depend on live availability, so nothing here can
 * be cached. `noindex` because a parameterised search URL is not content worth
 * indexing; the CITY pages are the SEO surface (§5.4), and letting crawlers loose
 * on date permutations would burn budget on near-duplicate pages.
 *
 * ## Three things it could not do until 2026-09-02
 *
 * **It could not be paged.** It asked for 24 results and rendered them, and the twenty-fifth stay
 * was unreachable by any means — not by scrolling, not by a control, not by editing the URL, since
 * `limit` caps at 60 and no cursor was ever sent. §2 makes pagination mandatory on every list a
 * customer reads and cursor the only permitted mechanism. It now sends the cursor the API returns
 * and renders links in both directions.
 *
 * **It could not be filtered.** `searchQuerySchema` accepts a price range, a property type, trip
 * attributes, amenity codes and a free-cancellation switch; the screen offered a sort order. Every
 * one of those was live in the API and reachable only by hand-writing a query string.
 *
 * **Its sort links reflected the query string.** They were built by iterating `Object.entries` over
 * whatever the URL happened to carry, which put arbitrary caller-chosen parameters into four links
 * on our own page. `URLSearchParams` encodes, and the base path is a literal, so this was not an
 * open redirect or an injection — but it is the shape `returnQuery` was written to forbid, and the
 * fix is the same one: build the link from the values this page PARSED and CLAMPED, never from the
 * request. A parameter nobody here understands is now dropped rather than carried forward.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** A whole number inside its bounds, or the fallback — never NaN, never negative. */
function whole(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

/**
 * A price bound, or nothing at all.
 *
 * Distinct from `whole` because absence is meaningful here: `minPrice` omitted means "no floor",
 * and coercing a missing or unparseable value to 0 would turn an empty box into a filter. The
 * schema refuses `min > max`, so an inverted pair is dropped rather than sent — a 400 on the
 * results page would replace somebody's search with an error for a typo in a number field.
 */
function money(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;

  const value = Number(raw);

  if (!Number.isFinite(value) || value < 0) return undefined;

  return Math.min(Math.trunc(value), 1_000_000);
}

const SORTS = ['recommended', 'price_asc', 'price_desc', 'rating_desc'] as const;

type Sort = (typeof SORTS)[number];

function isSort(value: string | undefined): value is Sort {
  return SORTS.includes((value ?? '') as Sort);
}

/** How many results a page holds. Under the contract's 60 ceiling, and a multiple of the grid. */
const PAGE_SIZE = 24;

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const query = await searchParams;
  const t = await getTranslations('search');
  const ta = await getTranslations('attributes');

  const [cities, propertyTypes, amenities] = await Promise.all([
    getCities(),
    getPropertyTypes(),
    getAmenities(),
  ]);

  /*
    A date, or nothing — and `??` alone could not tell the difference.

    `first(query['checkIn']) ?? todayInDamascus()` fell back only on `undefined`, and an EMPTY
    string is not nullish. So `?checkIn=` put `''` into every date path below: the page answered
    **500** on the server, and `?checkOut=` got through to the browser and threw
    `RangeError: Invalid time value` — a blank «Application error» on the busiest page of the site,
    from a link that had merely lost its query string. `?checkIn=not-a-date` did the same.

    Validated by SHAPE rather than parsed: `YYYY-MM-DD` or nothing. A shape test is an allow-list,
    it cannot pass through something that is not a date, and it leaves the API as the authority on
    whether the date is bookable — which it already is, and re-checks.

    Checkout has answered this correctly since it was written (`if (!slug || !unitId || !checkIn
    || !checkOut)`); it refuses and says so, because a checkout with no dates is a broken link. A
    SEARCH with no dates is an ordinary first visit, so this falls back instead.
  */
  const asDate = (value: string | undefined): string | undefined =>
    value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;

  const checkIn = asDate(first(query['checkIn'])) ?? todayInDamascus();
  const checkOut = asDate(first(query['checkOut'])) ?? addDays(checkIn, 2);
  const adultsRaw = Number(first(query['adults']) ?? 2);
  const adults = Number.isFinite(adultsRaw) && adultsRaw > 0 ? Math.trunc(adultsRaw) : 2;
  /*
    §5.2's other two. Clamped here rather than trusted: the API bounds them again, but an
    unclamped `?children=abc` would reach `searchSafely` as NaN and lose the whole result set to a
    validation error on a page the reader arrived at by editing a URL.
  */
  const children = whole(first(query['children']), 0, 20);
  const infants = whole(first(query['infants']), 0, 10);
  /*
    A REQUIREMENT, not a party size, and it floors at ONE (Bashar, 2026-09-03).

    One filters nothing today — every unit in the database has at least one bedroom — so a plain
    search is unchanged, and the form can show «غرفة» instead of a zero the reader has to decode.
    Clamped rather than trusted: the API bounds it again, but an unclamped `?bedrooms=abc` would
    reach `searchSafely` as NaN and lose the whole result set on a page somebody reached by editing
    a URL.
  */
  const bedrooms = whole(first(query['bedrooms']), 1, 10);
  const citySlug = first(query['citySlug']) || undefined;
  const sortParam = first(query['sort']);
  const sort: Sort = isSort(sortParam) ? sortParam : 'recommended';

  const propertyTypeCode = first(query['propertyTypeCode']) || undefined;
  /*
    Filtered against the enum the contract states, not passed through. An unknown attribute is a
    400 from the API — which would answer a hand-edited URL with an error page instead of a search,
    and would let a crafted link put an arbitrary string into the checkbox state of our own form.
  */
  const attributes = many(query['attributes']).filter((code): code is string =>
    (TRIP_ATTRIBUTES as readonly string[]).includes(code),
  );
  /*
    Against the amenities that can actually return something, which is the same set the panel
    renders — see the note on the `/amenities` endpoint. Filtering against the whole catalogue
    instead would let a bookmarked `?amenityCodes=wifi` reach the API and empty the page while no
    checkbox on screen explained why, which is the untagged-catalogue defect wearing a URL.
  */
  const known = new Set(
    amenities.filter((one) => one.propertyCount > 0).map((one) => one.code),
  );
  const amenityCodes = many(query['amenityCodes']).filter((code) => known.has(code));

  const minPrice = money(first(query['minPrice']));
  const maxPrice = money(first(query['maxPrice']));
  /* An inverted range is refused by the schema, so it is dropped here rather than sent. */
  const rangeOk =
    minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice;

  /*
    The star classification filter, CLAMPED to the five values that exist.

    Parsed here rather than forwarded, for the reason the amenity filter records: a bookmarked
    `?starRatings=9` would otherwise reach the API, be refused by the schema, and empty the page
    with no explanation. Anything that is not 1-5 is simply not a filter, and `Set` drops a repeat
    so `?starRatings=4&starRatings=4` narrows once.
  */
  const starRatings = [
    ...new Set(
      many(query['starRatings'])
        .map((value) => Number(value))
        .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5),
    ),
  ].sort((a, b) => a - b);

  const freeCancellationOnly = first(query['freeCancellationOnly']) === 'true';
  const cursor = first(query['cursor']) || undefined;

  /*
    The cutoff hour as the customer reads it — «17:00» — from the setting rather than a literal.
    Padded rather than formatted with `Intl`: it is a clock hour on the 24-hour dial, the same
    string in all three locales, and `Intl.DateTimeFormat` would drag a real date into it.
  */
  const publicSettings = await getPublicSettings();
  const cutoffHourLabel = `${String(cutoffHour(publicSettings)).padStart(2, '0')}:00`;

  const results = await searchSafely({
    checkIn,
    checkOut,
    adults,
    children,
    infants,
    bedrooms,
    citySlug,
    propertyTypeCode,
    attributes,
    amenityCodes,
    starRatings,
    minPrice: rangeOk ? minPrice : undefined,
    maxPrice: rangeOk ? maxPrice : undefined,
    freeCancellationOnly,
    sort,
    limit: PAGE_SIZE,
    cursor,
  });

  /**
   * Every parameter this page understands, rebuilt from the values it parsed.
   *
   * The allow-list IS this function. Nothing reaches a link on this page that did not survive the
   * clamping above, so a crafted `?whatever=…` is dropped rather than reflected — the rule
   * `returnQuery` states for the console, applied here.
   */
  const link = (overrides: { sort?: Sort; cursor?: string | null } = {}) => {
    const next = new URLSearchParams({
      checkIn,
      checkOut,
      adults: String(adults),
      children: String(children),
      infants: String(infants),
      sort: overrides.sort ?? sort,
    });

    /*
      Only when it narrows something. `bedrooms=1` in every URL would be noise in a shared link and
      is the default anyway — but it MUST be carried above one, or paging past the first page of a
      «three bedrooms» search quietly returns one-bedroom flats.
    */
    if (bedrooms > 1) next.set('bedrooms', String(bedrooms));

    if (citySlug) next.set('citySlug', citySlug);
    if (propertyTypeCode) next.set('propertyTypeCode', propertyTypeCode);
    for (const code of attributes) next.append('attributes', code);
    for (const code of amenityCodes) next.append('amenityCodes', code);
    /* Carried, or paging out of a «5 stars» search quietly returns everything. */
    for (const value of starRatings) next.append('starRatings', String(value));
    if (rangeOk && minPrice !== undefined) next.set('minPrice', String(minPrice));
    if (rangeOk && maxPrice !== undefined) next.set('maxPrice', String(maxPrice));
    if (freeCancellationOnly) next.set('freeCancellationOnly', 'true');

    /*
      `cursor: null` means "back to the first page" — what changing the SORT must do. Keeping an
      offset across a reorder lands the reader on page three of a differently ordered list, which
      shows them results they have not seen while claiming to be where they were.
    */
    const target = overrides.cursor === undefined ? cursor : overrides.cursor;

    if (target) next.set('cursor', target);

    return `/${locale}/search?${next.toString()}`;
  };

  /*
    What the reader asked for, carried into every result link. Built from the parsed values, never
    from the raw query string — see the note on `PropertyCard`'s `stay` prop.
  */
  const stay = `?${new URLSearchParams({
    checkIn,
    checkOut,
    adults: String(adults),
    children: String(children),
    infants: String(infants),
  }).toString()}`;

  const sortOptions: { value: Sort; label: string }[] = [
    { value: 'recommended', label: t('sortRecommended') },
    { value: 'price_asc', label: t('sortPriceAsc') },
    { value: 'price_desc', label: t('sortPriceDesc') },
    { value: 'rating_desc', label: t('sortRatingDesc') },
  ];

  /*
    «# نتيجة» is the whole answer only when there is no page after this one. With more to come it
    would be a count of what this page happens to hold presented as a total, which is the kind of
    number somebody quotes back at you.
  */
  const heading = results.nextCursor
    ? t('resultsOnPage', { count: results.items.length })
    : t('resultsTitle', { count: results.items.length });

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <SearchForm
        locale={locale}
        cities={cities}
        minDate={results.firstBookableDate ?? todayInDamascus()}
        attributes={TRIP_ATTRIBUTES.map((code) => ({ code, label: ta(code) }))}
        attributesLabel={t('attributes')}
        defaults={{
          citySlug,
          checkIn,
          checkOut,
          adults,
          children,
          infants,
          bedrooms,
          attributes,
        }}
      />

      {/*
        §5.3: a closed same-day cutoff is a normal outcome, not an error. The API
        returns the next bookable date and the page explains it in the customer's
        language rather than showing an empty result set with no reason.
      */}
      {results.notice ? (
        <p
          role="status"
          className="mt-6 rounded-card border border-warn/40 bg-warn/10 p-4 text-sm text-warn"
        >
          {t('cutoffNotice', {
            /*
              The CONFIGURED hour, not a literal.

              This said «17:00» whatever the setting was, so an operator who moved the cutoff to
              20:00 left every customer reading a sentence that named the wrong hour — and since
              2026-09-04 the rule can be switched off entirely, at which point this notice cannot
              appear at all. A message that states a rule has to read the rule.
            */
            hour: cutoffHourLabel,
            date: results.notice.firstBookableDate,
          })}
        </p>
      ) : null}

      {results.failed ? (
        <p
          role="alert"
          className="mt-6 rounded-card border border-bad/40 bg-bad/10 p-4 text-sm text-bad"
        >
          {t('noResults')}
        </p>
      ) : null}

      {/*
        Filters at the reading START — the right of an Arabic page — which is where booking.com
        puts them and where `ps`/`pe` logical properties place them without a second stylesheet.
        Below `lg` the aside comes FIRST in the DOM but collapses to its summary, so a phone lands
        on one line of controls and then the results, rather than on a column of checkboxes.
      */}
      <div className="mt-8 grid items-start gap-6 lg:grid-cols-[17rem_1fr]">
        <aside>
          <SearchFilters
            locale={locale}
            propertyTypes={propertyTypes}
            amenities={amenities}
            carried={{
              citySlug,
              checkIn,
              checkOut,
              adults,
              children,
              infants,
              bedrooms,
              sort,
            }}
            active={{
              propertyTypeCode,
              attributes,
              starRatings,
              amenityCodes,
              minPrice: rangeOk ? minPrice : undefined,
              maxPrice: rangeOk ? maxPrice : undefined,
              freeCancellationOnly,
            }}
          />
        </aside>

        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h1 className="font-display text-2xl text-text">{heading}</h1>

            {/* Sort as links, so the choice stays in the URL and remains shareable. */}
            <nav aria-label={t('sortLabel')} className="flex flex-wrap gap-1.5 text-sm">
              {sortOptions.map((option) => (
                <a
                  key={option.value}
                  href={link({ sort: option.value, cursor: null })}
                  aria-current={sort === option.value ? 'true' : undefined}
                  className={
                    sort === option.value
                      ? 'inline-flex min-h-10 items-center rounded-lg border border-gold/50 bg-card px-3 py-1.5 text-gold sm:min-h-11'
                      : 'inline-flex min-h-10 items-center rounded-lg border border-line px-3 py-1.5 text-muted transition-colors duration-200 ease-out-strong hover:border-gold/50 hover:bg-gold/10 hover:text-text sm:min-h-11'
                  }
                >
                  {option.label}
                </a>
              ))}
            </nav>
          </div>

          {results.items.length > 0 ? (
            <>
              <ul className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {results.items.map((item) => (
                  <li key={item.propertyReference}>
                    <PropertyCard item={item} locale={locale} stay={stay} />
                  </li>
                ))}
              </ul>

              <Paging
                locale={locale}
                previousHref={
                  results.previousCursor === null
                    ? null
                    : link({ cursor: results.previousCursor })
                }
                nextHref={
                  results.nextCursor === null
                    ? null
                    : link({ cursor: results.nextCursor })
                }
                labels={{
                  previous: t('previousPage'),
                  next: t('nextPage'),
                }}
              />
            </>
          ) : (
            !results.notice &&
            !results.failed && (
              <div className="mt-6 rounded-card border border-line bg-card p-8 text-center">
                <p className="font-display text-lg text-text">{t('noResults')}</p>
                <p className="mt-2 text-sm text-muted">{t('noResultsHint')}</p>
              </div>
            )
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Previous and next, as links.
 *
 * Anchors rather than buttons because each one is a DESTINATION: it can be opened in a new tab,
 * copied, and read by a crawler following `follow` — which this page is marked for even though it
 * is `noindex`. A disabled button at either end would be a control that says "there is more here"
 * and refuses; an absent link says the truth.
 *
 * The arrows are NOT mirrored for RTL by the component — they are drawn pointing at the reading
 * direction of travel by `rtl:` variants, which is the same decision `ImageSlider` records: an
 * arrow beside «التالي» means "onward through the list", and onward on an Arabic page is leftward.
 */
function Paging({
  locale,
  previousHref,
  nextHref,
  labels,
}: {
  locale: Locale;
  previousHref: string | null;
  nextHref: string | null;
  labels: { previous: string; next: string };
}) {
  if (!previousHref && !nextHref) return null;

  const control =
    'inline-flex min-h-10 items-center gap-2 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-text transition-colors duration-200 ease-out-strong hover:border-gold/60 hover:bg-gold/10 sm:min-h-11';

  return (
    <nav
      aria-label={labels.next}
      className="mt-8 flex items-center justify-between gap-3 border-t border-line pt-6"
    >
      {previousHref ? (
        <a href={previousHref} rel="prev" className={control}>
          <Arrow direction="back" />
          {labels.previous}
        </a>
      ) : (
        <span />
      )}

      {nextHref ? (
        <a href={nextHref} rel="next" className={`${control} ms-auto`} hrefLang={locale}>
          {labels.next}
          <Arrow direction="forward" />
        </a>
      ) : null}
    </nav>
  );
}

function Arrow({ direction }: { direction: 'back' | 'forward' }) {
  return (
    <svg
      aria-hidden
      width="1.05em"
      height="1.05em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      /*
        One glyph, flipped by direction and by writing mode. `rtl:-scale-x-100` is what makes
        «التالي» point left on an Arabic page and right on a German one, from a single path.
      */
      className={
        direction === 'forward'
          ? 'shrink-0 -scale-x-100 rtl:scale-x-100'
          : 'shrink-0 rtl:-scale-x-100'
      }
    >
      <path d="M19 12H5m0 0 6-6m-6 6 6 6" />
    </svg>
  );
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * The configured cutoff hour, or 17 when the setting cannot be read as one.
 *
 * `Number(undefined)` and `Number('evening')` are both `NaN`, and `NaN` here does not fail — it
 * renders «NaN:00» into a sentence explaining a rule to a customer. The API validates this key as
 * `hourOfDay` on write, so the guard is for the value arriving some other way: an unseeded row, a
 * hand-edited one, or a future change to what `publicSettings` returns. Same discipline as
 * `SettingsService.getNumber`, on the other side of the wire.
 */
function cutoffHour(settings: Record<string, unknown>): number {
  const hour = Number(settings['booking.same_day_cutoff_hour']);

  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 17;
}
