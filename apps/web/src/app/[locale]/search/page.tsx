import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PropertyCard } from '@/components/property-card';
import { SearchForm } from '@/components/search-form';
import { isLocale } from '@/i18n/routing';
import { getCities } from '@/lib/catalog';
import { searchSafely } from '@/lib/api';
import { todayInDamascus } from '@/lib/settings';

/**
 * Results page (§5.5).
 *
 * Dynamic by necessity — results depend on live availability, so nothing here can
 * be cached. `noindex` because a parameterised search URL is not content worth
 * indexing; the CITY pages are the SEO surface (§5.4), and letting crawlers loose
 * on date permutations would burn budget on near-duplicate pages.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: true },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] | undefined {
  if (value === undefined) return undefined;
  return Array.isArray(value) ? value : [value];
}

/** A whole number inside its bounds, or the fallback — never NaN, never negative. */
function whole(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);

  if (!Number.isFinite(value)) return fallback;

  return Math.min(Math.max(Math.trunc(value), 0), max);
}

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

  const cities = await getCities();

  const checkIn = first(query['checkIn']) ?? todayInDamascus();
  const checkOut = first(query['checkOut']) ?? addDays(checkIn, 2);
  const adults = Number(first(query['adults']) ?? 2);
  /*
    §5.2's other two. Clamped here rather than trusted: the API bounds them again, but an
    unclamped `?children=abc` would reach `searchSafely` as NaN and lose the whole result set to a
    validation error on a page the reader arrived at by editing a URL.
  */
  const children = whole(first(query['children']), 0, 20);
  const infants = whole(first(query['infants']), 0, 10);
  const citySlug = first(query['citySlug']) || undefined;
  const sort = first(query['sort']) ?? 'recommended';

  const results = await searchSafely({
    checkIn,
    checkOut,
    adults: Number.isFinite(adults) && adults > 0 ? adults : 2,
    children,
    infants,
    citySlug,
    propertyTypeCode: first(query['propertyTypeCode']) || undefined,
    attributes: many(query['attributes']),
    amenityCodes: many(query['amenityCodes']),
    sort,
    limit: 24,
  });

  /*
    What the reader asked for, carried into every result link.

    Built from the values parsed and clamped ABOVE, never from the raw query string — see the note
    on `PropertyCard`'s `stay` prop. `URLSearchParams` encodes, so nothing here can break out of
    the query into the path.
  */
  const stay = `?${new URLSearchParams({
    checkIn,
    checkOut,
    adults: String(adults),
    children: String(children),
    infants: String(infants),
  }).toString()}`;

  const sortOptions = [
    { value: 'recommended', label: t('sortRecommended') },
    { value: 'price_asc', label: t('sortPriceAsc') },
    { value: 'price_desc', label: t('sortPriceDesc') },
    { value: 'rating_desc', label: t('sortRatingDesc') },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <SearchForm
        locale={locale}
        cities={cities}
        minDate={results.firstBookableDate ?? todayInDamascus()}
        defaults={{ citySlug, checkIn, checkOut, adults, children, infants }}
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
          {t('cutoffNotice', { hour: '17:00', date: results.notice.firstBookableDate })}
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

      <div className="mt-8 flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="font-display text-2xl text-text">
          {t('resultsTitle', { count: results.items.length })}
        </h1>

        {/* Sort as links, so the choice stays in the URL and remains shareable. */}
        <nav aria-label={t('sortLabel')} className="flex flex-wrap gap-1.5 text-sm">
          {sortOptions.map((option) => {
            const next = new URLSearchParams();
            for (const [key, value] of Object.entries(query)) {
              if (value === undefined || key === 'sort') continue;
              for (const item of Array.isArray(value) ? value : [value]) {
                next.append(key, item);
              }
            }
            next.set('sort', option.value);

            return (
              <a
                key={option.value}
                href={`/${locale}/search?${next.toString()}`}
                aria-current={sort === option.value ? 'true' : undefined}
                className={
                  sort === option.value
                    ? 'inline-flex min-h-10 items-center rounded-lg border border-gold/50 bg-card px-3 py-1.5 text-gold'
                    : 'inline-flex min-h-10 items-center rounded-lg border border-line px-3 py-1.5 text-muted transition-colors hover:text-gold'
                }
              >
                {option.label}
              </a>
            );
          })}
        </nav>
      </div>

      {results.items.length > 0 ? (
        <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {results.items.map((item) => (
            <li key={item.propertyReference}>
              <PropertyCard item={item} locale={locale} stay={stay} />
            </li>
          ))}
        </ul>
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
  );
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
