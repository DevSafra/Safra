import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { StayResults } from '@/components/search/stay-results';
import { isLocale } from '@/i18n/routing';
import type { RawQuery } from '@/lib/search-query';

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

  return (
    <StayResults
      locale={locale}
      query={await searchParams}
      page={{ basePath: `/${locale}/search`, pinnedCity: false }}
    />
  );
}
