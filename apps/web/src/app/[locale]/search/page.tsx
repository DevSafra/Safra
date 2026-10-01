import type { Metadata } from 'next';
import { Suspense, type ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { TRIP_ATTRIBUTES } from '@safra/contracts';

import { Breadcrumb } from '@/components/breadcrumb';
import { CollapsibleSearch } from '@/components/search/collapsible-search';
import { FilterPanel, type FilterOption } from '@/components/search/filter-panel';
import { ResultsFeed } from '@/components/search/results-feed';
import { SortControl } from '@/components/search/sort-control';
import { SearchMap } from '@/components/search-map';
import { SearchForm } from '@/components/search-form';
import { isLocale } from '@/i18n/routing';
import {
  savedSlugs,
  searchFacetsSafely,
  searchSafely,
  type SearchFacets,
} from '@/lib/api';
import { BBOX_PLACEHOLDER } from '@/lib/basemap';
import {
  getAmenities,
  getCities,
  getLandmarks,
  getPropertyTypes,
  getPublicSettings,
} from '@/lib/catalog';
import { dynamicMessage } from '@/lib/dynamic-message';
import { formatMoney, localisedName, localisedText } from '@/lib/localise';
import { readableDate } from '@/lib/readable-date';
import { toCardModels } from '@/lib/search-cards';
import {
  parseSearch,
  toQueryString,
  toSearchParams,
  type RawQuery,
  type Sort,
} from '@/lib/search-query';
import { getSession } from '@/lib/session-server';
import { todayInDamascus } from '@/lib/settings';

/**
 * «الإقامات» — the results page (§5.5), rebuilt as booking.com's (Bashar, 2026-10-01: «make it
 * very similar … implement a lazy loading when I scroll to the bottom. Do not use pagination.
 * implement all filter»).
 *
 * ## The shape
 *
 * The search bar, a breadcrumb, and a heading that states the TRUE total — «دمشق: وجدنا ١٢ مكان
 * إقامة» — from the facet query, which counts the same set the list pages through. Beside it the
 * order. Down the reading start, the map card and every filter with its live count; on a phone
 * those collapse into a sticky «الترتيب · التصفية · الخريطة» bar. Then the results, twenty at a time,
 * the next twenty fetched before the reader reaches the end.
 *
 * ## What it inherits and keeps
 *
 * Dynamic and `noindex`, because results depend on live availability and a parameterised search
 * is not content worth indexing — the city pages are the SEO surface (§5.4). Every link on the
 * page is rebuilt from the PARSED query by `toQueryString`, so a parameter nobody here understands
 * is dropped rather than reflected (the rule `returnQuery` states for the console). The same-day
 * cutoff stays a notice, not an error.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

export default async function SearchPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<RawQuery>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const query = await searchParams;
  const t = await getTranslations('search');
  const tr = await getTranslations('search.results');
  const ta = await getTranslations('attributes');
  const tt = await getTranslations('propertyTypes');
  const tm = await getTranslations('amenities');
  const tnav = await getTranslations('nav');

  const [cities, propertyTypes, amenities, publicSettings] = await Promise.all([
    getCities(),
    getPropertyTypes(),
    getAmenities(),
    getPublicSettings(),
  ]);

  /*
    Every filterable amenity is an allowed code, and the live counts decide which are SHOWN. The
    old allow-list used the catalogue's `propertyCount`, which counts room-level links only — so a
    pool declared on the BUILDING never appeared as a filter at all, while the search itself would
    have found it.
  */
  const parsed = parseSearch(query, new Set(amenities.map((one) => one.code)));
  const landmarks = await getLandmarks(parsed.citySlug);
  const searchParamsForApi = toSearchParams(parsed);

  /*
    Started, NOT awaited: the counts stream in behind the results (Bashar, 2026-10-01). Nationwide at
    production volume they cost seconds, and a reader waiting on a sidebar number before seeing a
    single stay is the wrong way round.
  */
  const facetsPromise = searchFacetsSafely(searchParamsForApi);
  const results = await searchSafely(searchParamsForApi);

  const session = await getSession();
  const saved = session
    ? await savedSlugs(
        session.accessToken,
        results.items.map((item) => item.slug),
      )
    : new Set<string>();

  const nearLandmark = landmarks.find((one) => one.slug === parsed.nearLandmark);
  const nearLandmarkName = nearLandmark
    ? localisedText(nearLandmark.name, locale) || undefined
    : undefined;

  /* The party and dates every stay link carries, built from PARSED values. */
  const stay = `?${new URLSearchParams({
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    adults: String(parsed.adults),
    children: String(parsed.children),
    infants: String(parsed.infants),
  }).toString()}`;

  const cards = await toCardModels(results.items, {
    locale,
    stay,
    adults: parsed.adults,
    nearLandmarkName,
    amenities,
    saved,
  });

  const view = toQueryString(parsed);
  const link = (overrides: Parameters<typeof toQueryString>[1]) =>
    `/${locale}/search?${toQueryString(parsed, overrides)}`;

  const sortOptions: { value: Sort; label: string; href: string }[] = [
    { value: 'recommended' as const, label: t('sortRecommended') },
    { value: 'price_asc' as const, label: t('sortPriceAsc') },
    { value: 'price_desc' as const, label: t('sortPriceDesc') },
    { value: 'rating_desc' as const, label: t('sortRatingDesc') },
    /* Offered only with a landmark to measure from; the contract refuses it otherwise. */
    ...(parsed.nearLandmark
      ? [{ value: 'distance_asc' as const, label: t('sortDistance') }]
      : []),
  ].map((option) => ({ ...option, href: link({ sort: option.value }) }));

  const city = cities.find((one) => one.slug === parsed.citySlug);
  const cityName = city ? localisedName(city, locale) : undefined;

  const headingFor = (facets: SearchFacets | null) =>
    facets
      ? cityName
        ? tr('headingCity', { city: cityName, count: facets.total })
        : tr('headingAll', { count: facets.total })
      : tr('headingNoCount');
  const headingNode = (facets: SearchFacets | null) => (
    <h1
      id="results-heading"
      className="font-display text-26 font-bold leading-tight text-text text-balance"
    >
      {headingFor(facets)}
    </h1>
  );
  /* The centre filter needs a placed centre; a card that carries the figure proves one. */
  const cardsHaveCentre = results.items.some((item) => item.cityCentreMetres !== null);

  const option = (code: string, label: string): FilterOption => ({ code, label });
  const amenityOptions = (category: string) =>
    amenities
      .filter((one) => one.category === category)
      .map((one) =>
        option(one.code, dynamicMessage(tm, one.code, localisedName(one, locale))),
      );

  const signInHref = `/${locale}/login?next=${encodeURIComponent(`/${locale}/search?${view}`)}`;

  const mapStays = results.items
    .filter((item) => item.publicLatitude && item.publicLongitude)
    .map((item) => ({
      slug: item.slug,
      name: localisedName(item, locale),
      latitude: item.publicLatitude ?? '',
      longitude: item.publicLongitude ?? '',
      price: formatMoney(item.nightlyFrom, item.currencyCode, locale),
      staysHere: 1,
    }));

  const filterProps = {
    facets: facetsPromise,
    locale,
    parsed,
    options: {
      hasCentre: cardsHaveCentre,
      cityName,
      propertyTypes: propertyTypes.map((type) =>
        option(type.code, dynamicMessage(tt, type.code, localisedName(type, locale))),
      ),
      facilities: amenityOptions('facilities'),
      houseRules: amenityOptions('rules'),
      accessibility: amenityOptions('accessibility'),
      attributes: TRIP_ATTRIBUTES.map((code) => option(code, ta(code))),
      landmarks: landmarks.map((mark) =>
        option(mark.slug, localisedText(mark.name, locale) || mark.slug),
      ),
      landmarkKinds: [
        ...new Map(
          landmarks.map((mark) => [
            mark.kind,
            option(mark.kind, localisedText(mark.kindName, locale) || mark.kind),
          ]),
        ).values(),
      ],
    },
  };

  const mapProps = {
    hrefPrefix: `/${locale}/property/`,
    bboxActive: parsed.bbox !== undefined,
    bboxUrlTemplate: link({ bbox: BBOX_PLACEHOLDER }),
    urlWithoutBbox: link({ bbox: null }),
    stays: mapStays,
    hrefSuffix: stay,
    signInHref,
    /* The list's box is the map's opening view, never a limit on what the map may show. */
    mapFeedUrl: `/${locale}/api/search/map?${toQueryString(parsed, { bbox: null })}`,
    pageBbox: parsed.bbox,
    filtersSlot: (
      <FilterPanel
        {...filterProps}
        layout="column"
        sortSlot={null}
        mapThumbnailSlot={null}
        mapButtonSlot={null}
      />
    ),
  };

  const cutoff = cutoffHour(publicSettings);

  const adultsText = t('guestsCount', { count: parsed.adults });
  const summary = tr('searchSummary', {
    place: cityName ?? t('allCities'),
    from: readableDate(parsed.checkIn, locale),
    to: readableDate(parsed.checkOut, locale),
    party:
      parsed.children > 0
        ? tr('partyWithChildren', {
            adults: adultsText,
            children: t('childrenCount', { count: parsed.children }),
          })
        : adultsText,
  });

  const panel = (
    <FilterPanel
      {...filterProps}
      sortSlot={
        <SortControl
          compact
          label={tr('sortBy')}
          value={parsed.sort}
          options={sortOptions}
        />
      }
      mapThumbnailSlot={<SearchMap variant="thumbnail" {...mapProps} />}
      mapButtonSlot={<SearchMap variant="compact" {...mapProps} />}
    />
  );

  return (
    <div className="mx-auto max-w-7xl px-4 pb-16 pt-6">
      {/*
        No trip-attribute chips here: «صفات الرحلة» is a group in the sidebar, and the same control in
        two places is two states that can disagree.
      */}
      <CollapsibleSearch summary={summary} editLabel={tr('editSearch')}>
        <SearchForm
          locale={locale}
          cities={cities}
          propertyTypes={propertyTypes}
          minDate={results.firstBookableDate ?? todayInDamascus()}
          attributesLabel={t('attributes')}
          defaults={{
            citySlug: parsed.citySlug,
            /* The value the PAGE parsed, so the bar and the sidebar cannot disagree. */
            propertyTypeCode: parsed.propertyTypeCode,
            checkIn: parsed.checkIn,
            checkOut: parsed.checkOut,
            adults: parsed.adults,
            children: parsed.children,
            infants: parsed.infants,
            bedrooms: parsed.bedrooms,
            attributes: parsed.attributes,
          }}
        />
      </CollapsibleSearch>

      <Breadcrumb
        label={tr('breadcrumb')}
        className="mt-5"
        items={[
          { label: tnav('home'), href: `/${locale}` },
          ...(cityName
            ? [
                {
                  label: tnav('stays'),
                  href: link({
                    citySlug: null,
                    maxCentreKm: null,
                    nearLandmark: null,
                    nearKind: null,
                  }),
                },
                { label: cityName },
              ]
            : [{ label: tnav('stays') }]),
        ]}
      />

      {/* §5.3: a closed same-day cutoff is a normal outcome, explained rather than shown as empty. */}
      {results.notice ? (
        <p
          role="status"
          className="mt-4 rounded-card border border-warn/40 bg-warn/10 p-4 text-14 text-warn"
        >
          {t('cutoffNotice', {
            hour: `${String(cutoff).padStart(2, '0')}:00`,
            date: results.notice.firstBookableDate,
          })}
        </p>
      ) : null}

      {results.failed ? (
        <p
          role="alert"
          className="mt-4 rounded-card border border-bad/40 bg-bad/10 p-4 text-14 text-bad"
        >
          {t('noResults')}
        </p>
      ) : null}

      <div className="mt-4 grid items-start gap-6 lg:grid-cols-[18rem_minmax(0,1fr)]">
        <aside>{panel}</aside>

        <section aria-labelledby="results-heading" className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Suspense fallback={headingNode(null)}>
              <Counted promise={facetsPromise}>{headingNode}</Counted>
            </Suspense>
            <div className="hidden w-72 lg:block">
              <SortControl
                label={tr('sortBy')}
                value={parsed.sort}
                options={sortOptions}
              />
            </div>
          </div>

          <div className="mt-5">
            {cards.length > 0 ? (
              <ResultsFeed
                /* A new search is a new list: remount, so nothing from the old one survives. */
                key={view}
                initialCards={cards}
                initialNextCursor={results.nextCursor}
                initialTruncated={results.truncated}
                query={view}
                locale={locale}
                signInHref={signInHref}
                labels={{
                  loading: tr('loading'),
                  end: tr('end'),
                  loadFailed: tr('loadFailed'),
                  retry: tr('retry'),
                }}
              />
            ) : !results.notice && !results.failed ? (
              <div className="rounded-card border border-line bg-card p-8 text-center">
                <p className="font-display text-18 font-bold text-text">
                  {t('noResults')}
                </p>
                <p className="mt-2 text-14 text-muted">{t('noResultsHint')}</p>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

/**
 * The configured cutoff hour, or 17 when the setting cannot be read as one — never «NaN:00» in a
 * sentence explaining a rule to a customer.
 */
function cutoffHour(settings: Record<string, unknown>): number {
  const hour = Number(settings['booking.same_day_cutoff_hour']);
  return Number.isInteger(hour) && hour >= 0 && hour <= 23 ? hour : 17;
}

/**
 * Renders `children` once the counts arrive, inside a Suspense boundary whose fallback is the same
 * markup without them. A server component, so the render function never crosses to the client.
 */
async function Counted({
  promise,
  children,
}: {
  promise: Promise<SearchFacets | null>;
  children: (facets: SearchFacets | null) => ReactNode;
}) {
  return children(await promise);
}
