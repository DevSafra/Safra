import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { Breadcrumb } from '@/components/breadcrumb';
import { JsonLd } from '@/components/json-ld';
import { StayResults } from '@/components/search/stay-results';
import { isLocale, type Locale } from '@/i18n/routing';
import { cityBounds } from '@/lib/basemap';
import { getCity } from '@/lib/catalog';
import { localisedDescription, localisedName, localisedText } from '@/lib/localise';
import { imageUrl as cityImageUrl } from '@/lib/property';
import { breadcrumbGraph, cityGraph } from '@/lib/structured-data';
import { siteOrigin } from '@/lib/site-url';
import type { RawQuery } from '@/lib/search-query';
import { localeAlternates } from '@/lib/alternates';

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
    /* The slug the API answered with, not the one in the request: see `localeAlternates`. */
    alternates: localeAlternates(locale, `/city/${city.slug}`),
    openGraph: {
      title: name,
      description: description ?? undefined,
      type: 'website',
    },
  };
}

export default async function CityPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; slug: string }>;
  searchParams: Promise<RawQuery>;
}) {
  const { locale, slug } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const city = await getCity(slug);
  if (!city) notFound();

  const t = await getTranslations('city');
  const tnav = await getTranslations('nav');
  const query = await searchParams;

  const name = localisedName(city, locale);
  const description = localisedDescription(city, locale);
  const tags = pickTags(city, locale);

  /* Hero first, then the first by sort order — the API already returns them in that order. */
  const hero = city.images[0] ?? null;

  /*
    A `TouristDestination`, which says what this page is FOR rather than merely that it names a
    place. No coordinate: the city holds a nullable one that operations have not filled for most
    rows, and a fabricated centroid is worse than none. The stays below carry no graph — each has
    a page of its own that describes it properly.
  */
  const origin = siteOrigin();
  const graphs = [
    cityGraph({
      name,
      description,
      url: `${origin}/${locale}/city/${city.slug}`,
      countryCode: city.country.code,
      images: hero ? [cityImageUrl(hero, 1600, 'webp')] : [],
    }),
    breadcrumbGraph([
      { name: t('backHome'), url: `${origin}/${locale}` },
      { name, url: `${origin}/${locale}/city/${city.slug}` },
    ]),
  ];

  return (
    <>
      {graphs.map((graph, index) => (
        <JsonLd key={index} graph={graph} />
      ))}

      {/*
        §5.4's «أول ثلثها صور عالية الجودة» — the photograph if the city has one.

        It could not have one until 2026-08-30: the pipeline was built, `city_images` and its
        `GEO_MANAGE` controller and the re-encoding worker all existed, and NOTHING CALLED THEM, so
        every city held zero rows and this page said «no image pipeline exists yet». The console
        can upload one now, and this reads it.

        The gradient stays as the fallback rather than a stock photo standing in for real content:
        a city with no photograph looks deliberately unfinished, which is the honest state.
      */}
      <section className="relative border-b border-line">
        {hero ? (
          <>
            {/* AVIF first, WebP as the fallback — both produced by the upload pipeline. */}
            <picture>
              <source srcSet={cityImageUrl(hero, 1600, 'avif')} type="image/avif" />
              <source srcSet={cityImageUrl(hero, 1600, 'webp')} type="image/webp" />
              <img
                src={cityImageUrl(hero, 1600, 'webp')}
                alt={localisedText(hero.alt, locale) ?? ''}
                className="absolute inset-0 h-full w-full object-cover"
                loading="eager"
              />
            </picture>
            {/*
              A scrim, because the copy above sits ON the photograph and a light sky would take the
              breadcrumb with it. `aria-hidden`: it is contrast, not content.
            */}
            <div aria-hidden className="absolute inset-0 bg-bg/70" />
          </>
        ) : (
          <div
            aria-hidden
            className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,color-mix(in_oklab,var(--color-sky)_28%,transparent),transparent_65%)]"
          />
        )}
        <div className="relative mx-auto max-w-7xl px-4 py-10 sm:py-14">
          <Breadcrumb
            label={tnav('breadcrumb')}
            items={[{ label: t('backHome'), href: `/${locale}` }, { label: name }]}
          />

          <p className="mt-4 text-sm tracking-wide text-sky">
            {city.categories.map((c) => localisedName(c, locale)).join(' · ')}
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

      {/*
        The results experience of «الإقامات», pinned to this city (Bashar, 2026-10-02: «very similar
        to the page الإقامات but specific to the selected city same as booking.com»). It replaced a
        six-card teaser and a search bar that sent the reader to `/search` to see the rest. The city
        is in the PATH, so every filter, order and map link keeps the reader on this page, and the
        listings are still server-rendered HTML, which is what makes this page worth indexing.
      */}
      <StayResults
        locale={locale}
        query={query}
        page={{ basePath: `/${locale}/city/${city.slug}`, pinnedCity: true }}
        pinnedCitySlug={city.slug}
        mapWhenEmpty={cityBounds(city.latitude, city.longitude)}
      />
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
