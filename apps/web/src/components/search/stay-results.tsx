import { Suspense, type ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';

import { TRIP_ATTRIBUTES } from '@safra/contracts';

import { Breadcrumb } from '@/components/breadcrumb';
import { CollapsibleSearch } from '@/components/search/collapsible-search';
import { FilterPanel, type FilterOption } from '@/components/search/filter-panel';
import { ResultsFeed } from '@/components/search/results-feed';
import { SortControl } from '@/components/search/sort-control';
import { SearchMap } from '@/components/search-map';
import { SearchForm } from '@/components/search-form';
import type { Locale } from '@/i18n/routing';
import {
  savedSlugs,
  searchFacetsSafely,
  searchSafely,
  type SearchFacets,
} from '@/lib/api';
import { BBOX_PLACEHOLDER, type MapBounds } from '@/lib/basemap';
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
  pageHref,
  parseSearch,
  toQueryString,
  toSearchParams,
  type RawQuery,
  type ResultsPage,
  type Sort,
} from '@/lib/search-query';
import { getSession } from '@/lib/session-server';
import { addDays, todayInDamascus } from '@/lib/settings';

/**
 * The results experience, shared by «الإقامات» and every city's own page (Bashar, 2026-10-02:
 * «Every city single page should be very similar to the page الإقامات but specific to the
 * selected city same as booking.com»).
 *
 * One component, not two pages that resemble each other: the search bar, the sidebar with every
 * filter and its live count, the map card, the order, and the list that loads as the reader
 * scrolls. A city page renders it with the city PINNED, which is booking.com's shape for a
 * destination: the place is a fact of the page, so it lives in the path (`/city/damascus`) and
 * every link the page builds keeps the reader there rather than on `/search`. See `pageHref`.
 *
 * What differs between the two is small and named here: the heading is the page's `h1` on
 * «الإقامات» and an `h2` under the city's own name on a city page; the breadcrumb is this
 * component's on «الإقامات» and the city header's on a city page; and a city page, being a door
 * people arrive at without dates, moves its DEFAULT dates past the same-day cutoff instead of
 * opening on a notice and an empty list. Dates a reader typed are never moved.
 */
export async function StayResults({
  locale,
  query,
  page,
  pinnedCitySlug,
  mapWhenEmpty,
}: {
  locale: Locale;
  query: RawQuery;
  page: ResultsPage;
  /** The city a city page is FOR. Overrides any `citySlug` the query carries. */
  pinnedCitySlug?: string;
  /** Where the maps open when no result can be placed: a city page's own city. */
  mapWhenEmpty?: MapBounds | undefined;
}) {
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
  const allowed = new Set(amenities.map((one) => one.code));
  const read = (raw: RawQuery) =>
    parseSearch(pinnedCitySlug ? { ...raw, citySlug: pinnedCitySlug } : raw, allowed);

  let parsed = read(query);
  let searchParamsForApi = toSearchParams(parsed);

  /*
    Started, NOT awaited: the counts stream in behind the results (Bashar, 2026-10-01). Nationwide at
    production volume they cost seconds, and a reader waiting on a sidebar number before seeing a
    single stay is the wrong way round.
  */
  let facetsPromise = searchFacetsSafely(searchParamsForApi);
  let results = await searchSafely(searchParamsForApi);

  /*
    A city page is a door people arrive at without dates, from the home page or a search engine.
    After the same-day cutoff, today cannot be booked, and opening on a notice and an empty list
    every evening is the defect the old city teaser fixed on 2026-08-20. So DEFAULT dates move to
    the first bookable day the API names; dates a reader typed stay, and are told why.
  */
  const firstBookable = results.notice?.firstBookableDate;
  if (pinnedCitySlug && !query['checkIn'] && firstBookable) {
    parsed = read({
      ...query,
      checkIn: firstBookable,
      checkOut: addDays(firstBookable, 2),
    });
    searchParamsForApi = toSearchParams(parsed);
    facetsPromise = searchFacetsSafely(searchParamsForApi);
    results = await searchSafely(searchParamsForApi);
  }

  const landmarks = await getLandmarks(parsed.citySlug);

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
  /* Every link stays on THIS page: `/search`, or the city's own. */
  const link = (overrides: Parameters<typeof toQueryString>[1]) =>
    pageHref(page, parsed, overrides);

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
  /* An `h2` on a city page, where the city's own name is the page's `h1`. */
  const Heading = page.pinnedCity ? 'h2' : 'h1';
  const headingNode = (facets: SearchFacets | null) => (
    <Heading
      id="results-heading"
      className="font-display text-26 font-bold leading-tight text-text text-balance"
    >
      {headingFor(facets)}
    </Heading>
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

  const signInHref = `/${locale}/login?next=${encodeURIComponent(link({}))}`;

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
    page,
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
    whenEmpty: mapWhenEmpty,
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

      {/* On a city page the trail is the city header's; here it is the results page's own. */}
      {page.pinnedCity ? null : (
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
      )}

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
