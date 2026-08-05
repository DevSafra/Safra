import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { PropertyCard } from '@/components/property-card';
import { SearchForm } from '@/components/search-form';
import { isLocale, routing, type Locale } from '@/i18n/routing';
import { getCities, getCity } from '@/lib/catalog';
import { localisedDescription, localisedName } from '@/lib/localise';
import { searchSafely } from '@/lib/api';
import { todayInDamascus } from '@/lib/settings';
import { dynamicMessage } from '@/lib/dynamic-message';

/**
 * City page (SRS §5.4).
 *
 * Server-rendered and revalidated, because the spec makes this page an explicit
 * SEO target. Rendering the stays on the client would leave a crawler with an
 * empty shell — the listings ARE the indexable content.
 */
export const revalidate = 300;

/** Pre-render every city in every language at build time. */
export async function generateStaticParams() {
  const cities = await getCities();
  return routing.locales.flatMap((locale) =>
    cities.map((city) => ({ locale, slug: city.slug })),
  );
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLocale(locale)) return {};

  const city = await getCity(slug);
  if (!city) return {};

  const name = localisedName(city, locale);
  const description = localisedDescription(city, locale);

  return {
    title: name,
    description: description ?? undefined,
    alternates: {
      canonical: `/${locale}/city/${slug}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}/city/${slug}`]),
      ),
    },
    openGraph: {
      title: name,
      description: description ?? undefined,
      type: 'website',
    },
  };
}

export default async function CityPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const city = await getCity(slug);
  if (!city) notFound();

  const t = await getTranslations('city');
  const tnav = await getTranslations('nav');
  const tc = await getTranslations('cityCategories');
  const ts = await getTranslations('search');

  const cities = await getCities();
  const checkIn = todayInDamascus();
  const checkOut = addDays(checkIn, 2);

  /**
   * A representative sample of what is bookable, so the page is never empty.
   *
   * `cached: true` keeps this page statically renderable — see searchForDisplay.
   * This block is a teaser; /search is the live, authoritative query.
   */
  const results = await searchSafely(
    { checkIn, checkOut, adults: 2, citySlug: slug, limit: 6 },
    { cached: true },
  );

  const name = localisedName(city, locale);
  const description = localisedDescription(city, locale);
  const tags = pickTags(city, locale);

  return (
    <>
      {/*
        §5.4 asks for the top third of the page to be city photography. No image
        pipeline exists yet (roadmap item 73), so this is a token-driven gradient
        placeholder rather than a stock photo standing in for real content.
      */}
      <section className="relative border-b border-line">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,color-mix(in_oklab,var(--color-sky)_28%,transparent),transparent_65%)]"
        />
        <div className="relative mx-auto max-w-6xl px-4 py-14 sm:py-20">
          <nav aria-label={tnav('breadcrumb')} className="text-sm text-faint">
            <Link href={`/${locale}`} className="hover:text-gold">
              {t('backHome')}
            </Link>
            <span aria-hidden className="mx-2">
              ←
            </span>
            <span className="text-muted">{name}</span>
          </nav>

          <p className="mt-4 text-sm tracking-wide text-sky">
            {city.categories.map((c) => dynamicMessage(tc, c, c)).join(' · ')}
          </p>
          <h1 className="mt-2 font-display text-4xl font-bold text-gold sm:text-5xl">
            {name}
          </h1>

          {description ? (
            <p className="mt-4 max-w-3xl text-muted">{description}</p>
          ) : null}

          {tags.length > 0 ? (
            <>
              <h2 className="sr-only">{t('highlights')}</h2>
              <ul className="mt-6 flex flex-wrap gap-2">
                {tags.map((tag) => (
                  <li
                    key={tag}
                    className="rounded-full border border-line bg-card px-3 py-1 text-sm text-muted"
                  >
                    {tag}
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-10">
        <SearchForm
          locale={locale}
          cities={cities}
          minDate={checkIn}
          defaults={{ citySlug: slug, checkIn, checkOut, adults: 2 }}
        />
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-16">
        <h2 className="font-display text-2xl text-text">
          {t('availableStays', { city: name })}
        </h2>

        {results.items.length > 0 ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.items.map((item) => (
              <li key={item.propertyReference}>
                <PropertyCard item={item} locale={locale} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-6 rounded-card border border-line bg-card p-6 text-muted">
            {ts('noResults')} — {ts('noResultsHint')}
          </p>
        )}
      </section>
    </>
  );
}

function pickTags(
  city: { tagsAr: string[]; tagsEn: string[]; tagsDe: string[] },
  locale: Locale,
): string[] {
  // Arabic is the authored language; fall back to it when a translation is absent.
  if (locale === 'en') return city.tagsEn.length > 0 ? city.tagsEn : city.tagsAr;
  if (locale === 'de') return city.tagsDe.length > 0 ? city.tagsDe : city.tagsAr;
  return city.tagsAr;
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
