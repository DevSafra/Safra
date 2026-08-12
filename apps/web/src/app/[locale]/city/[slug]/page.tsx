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
 * Server-rendered, because the spec makes this page an explicit SEO target: rendering the stays on the
 * client would leave a crawler with an empty shell, and the listings ARE the indexable content. That
 * still holds — every request returns complete HTML.
 *
 * ## Why it is NOT pre-rendered at build time
 *
 * It used to declare `generateStaticParams`, and every city page answered **500** in production as a
 * result. Two reasons, and either alone is enough:
 *
 * 1. **The layout reads a request.** `ThemeScript` pulls the CSP nonce out of the response header with
 *    `headers()`, because the script is inlined by hand and Next cannot nonce it automatically. A
 *    prerender has no request, so `headers()` throws `DYNAMIC_SERVER_USAGE` — which Next tolerates on a
 *    route it may render dynamically, and cannot on one that `generateStaticParams` has committed to
 *    static output. The symptom was a 500 with the message omitted, which is why it survived a green
 *    `pnpm verify` and a green `pnpm e2e`: nothing in either suite requests a city page.
 *
 * 2. **The layout renders per-VISITOR chrome.** `SiteHeader` shows «حسابي» or «تسجيل الدخول» depending
 *    on the session cookie. A statically generated page bakes one of those in and serves it to
 *    everybody — the same staleness Bashar reported on the navbar, made permanent.
 *
 * The caching that actually mattered is untouched: `getCity`, `getCities` and `searchForDisplay` each
 * carry `next: { revalidate: 300 }`, so the API is hit once per five minutes per query rather than once
 * per visitor. What is given up is HTML assembly, not data.
 *
 * `docs/FUTURE-WORK.md` records what making these pages genuinely static would take.
 */
export const dynamic = 'force-dynamic';

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
