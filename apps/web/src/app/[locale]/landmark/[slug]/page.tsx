import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { getLandmark } from '@/lib/catalog';
import { isLocale } from '@/i18n/routing';
import { localisedText } from '@/lib/localise';

/**
 * «إقامات قرب الجامع الأموي» — a landmark as a way in.
 *
 * ## Why this page exists
 *
 * Landmarks were reachable only as a filter somebody had already found: you had to be on the
 * search results, open the panel, and pick one. Nothing linked to them, nothing named them
 * outside a property page, and `sitemap.xml` was a 404 — so the most searched phrase in this
 * business («hotels near the Umayyad Mosque») had no page to land on.
 *
 * ## It is a REDIRECT, not a second search implementation
 *
 * The obvious build is a page that fetches stays near the landmark and renders them. That would
 * be a second ranking, a second set of filters and a second place for the privacy rules to be
 * got subtly wrong. This resolves the landmark, then sends the reader to the search results
 * with the filter already applied — one search, one set of rules, one surface to maintain.
 *
 * It names no dates either: `/search` already falls back to today plus two nights, and that
 * fallback is where the same-day cutoff and the city's timezone are decided. A second answer
 * here would be the wrong one the first time somebody searched across midnight in Damascus.
 */
export const revalidate = 3600;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;

  if (!isLocale(locale)) return {};

  const landmark = await getLandmark(slug);

  if (!landmark) return {};

  const t = await getTranslations({ locale, namespace: 'search' });
  const name = localisedText(landmark.name, locale) || landmark.slug;

  return {
    title: t('nearTitle') + ' ' + name,
    /*
      No `robots: noindex`. This page exists to BE found — it is the one surface that answers a
      search anybody would actually type, and the redirect target carries the same content.
    */
  };
}

export default async function LandmarkPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const landmark = await getLandmark(slug);

  /* Unknown, retired, or a city nobody publishes any more — all the same answer. */
  if (!landmark) notFound();

  /*
    NO DATES. `/search` already falls back to today plus two nights when a visit carries none,
    and that fallback is where the same-day cutoff and the city's timezone are decided. Naming
    dates here would be a second answer to a question one page already answers — and the wrong
    one the first time somebody searched across midnight in Damascus.
  */
  const query = new URLSearchParams({
    citySlug: landmark.citySlug,
    nearLandmark: landmark.slug,
    sort: 'distance_asc',
  });

  redirect(`/${locale}/search?${query.toString()}`);
}
