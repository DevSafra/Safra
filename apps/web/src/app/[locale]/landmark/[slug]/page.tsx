import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { BreadcrumbChevron } from '@/components/icons';
import { PropertyCard } from '@/components/property-card';
import { addDays, todayInDamascus } from '@/lib/settings';
import { getCity, getLandmark, getLandmarks } from '@/lib/catalog';
import { isLocale, routing, type Locale } from '@/i18n/routing';
import { localisedName, localisedText } from '@/lib/localise';
import { searchSafely } from '@/lib/api';

/**
 * «إقامات قرب الجامع الأموي» — a landmark as a destination page.
 *
 * ## What it was, and why that had to change
 *
 * Until 2026-09-28 this route was a 307 to `/search` with the filter applied. The argument for
 * that was sound and is preserved below: rendering stays here risked a SECOND ranking, a second
 * set of filters, and a second place to get the location-privacy rules subtly wrong.
 *
 * What the argument missed is the far end. **`/search` answers `noindex, follow`** — correctly, a
 * results page with an unbounded query space must not be indexed — so all 125 landmark entries in
 * `sitemap.xml` invited a crawler to a page we tell it to ignore. The one surface built so that the
 * most-typed phrase in this business would have somewhere to land could not rank, and a quarter of
 * the sitemap was spending crawl budget to prove it. Recorded as O-seo-1; Bashar chose to solve it
 * by making these real pages (2026-09-28) rather than by dropping them from the sitemap.
 *
 * ## It is STILL not a second search implementation
 *
 * The objection is answered by construction, not by being overruled:
 *
 * - **One ranking.** The stays below come from `searchSafely` — the same function `/search` and the
 *   city page call, against the same API, with `sort: 'distance_asc'`. This file contains no
 *   ordering logic of its own.
 * - **One set of privacy rules.** Nothing here reads a coordinate. `distanceMetres` arrives already
 *   computed and rounded by the API, and `PropertyCard` renders it; the standing constraint that no
 *   exact property location leaves the server before a booking is confirmed is not touched by this
 *   page because this page never has one to leak.
 * - **No second filter set.** There is deliberately no `SearchForm` here. `SearchForm` has no
 *   `nearLandmark` field, so a form on this page would silently DROP the landmark on submit and
 *   drop the reader into an unfiltered city search — the «paging out of a filtered view» failure in
 *   another costume. Filtering lives at `/search`, one link away, with the landmark carried.
 * - **Still no dates in the URL.** `/search` owns the same-day cutoff and the city's timezone. The
 *   sample below asks for today plus two nights and RE-ASKS with the API's own first bookable date
 *   when it refuses — the retry the city page had to learn on 2026-08-20, when every city page in
 *   the product went empty at 17:00 Damascus and stayed empty until midnight.
 *
 * ## Why it stays indexable even with nothing to show
 *
 * An empty result here means «nothing is free for these two nights», not «there is nowhere to stay
 * near this landmark» — availability, not content. A conditional `noindex` would therefore
 * reintroduce the exact defect this change removes, intermittently and invisibly: sitemap entries
 * pointing at pages a crawler is told to skip, flipping with the booking calendar. The page carries
 * the landmark, its city and its neighbours regardless, so it is never contentless.
 */
export const dynamic = 'force-dynamic';

/**
 * Nine, where the city page shows six.
 *
 * This page has to EARN a ranking, and the stays are its indexable content; three rows of three
 * fill the desktop grid exactly. It is one query either way — `limit` caps at 60.
 */
const NEARBY_LIMIT = 9;

/** The occupancy the sample is priced for, and the party carried into each result link. */
const SAMPLE_ADULTS = 2;
const SAMPLE_NIGHTS = 2;

/**
 * The landmark, its city's name, and the neighbours — resolved once for both exports.
 *
 * `generateMetadata` and the page body each need the first two, and Next calls them separately.
 * Both reads are `REFERENCE_TTL`-cached by `@/lib/catalog`, so the second caller is served from
 * the fetch cache rather than the API.
 */
async function resolve(slug: string, locale: Locale) {
  const landmark = await getLandmark(slug);

  if (!landmark) return null;

  const [city, siblings] = await Promise.all([
    getCity(landmark.citySlug),
    getLandmarks(landmark.citySlug),
  ]);

  return {
    landmark,
    /*
      The slug is the last resort, not a design choice: a landmark cannot exist without its city, so
      a null here is a failed reference read rather than a missing row. Rendering the slug keeps the
      sentence intact during that failure instead of leaving a hole in the middle of it.
    */
    cityName: city ? localisedName(city, locale) : landmark.citySlug,
    name: localisedText(landmark.name, locale) || landmark.slug,
    siblings: siblings.filter((one) => one.slug !== landmark.slug),
  };
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;

  if (!isLocale(locale)) return {};

  const resolved = await resolve(slug, locale);

  if (!resolved) return {};

  const t = await getTranslations({ locale, namespace: 'landmark' });
  const title = t('title', { landmark: resolved.name });
  const description = t('description', {
    landmark: resolved.name,
    city: resolved.cityName,
  });

  return {
    title,
    description,
    /*
      Both were missing while this was a redirect, and neither is optional now. Without `canonical`
      a crawler that reaches `?utm_source=…` indexes a second address for the same page; without
      `languages` the three locales compete with each other for the same query instead of each
      serving its own reader — which is the failure the group-trip pages already guard against.

      Built from `resolved.landmark.slug`, the value the API answered with — NEVER from the `slug`
      in the request. Two reasons and both matter: a canonical assembled from request text is
      request text reflected into a `<link>` on our own page, and a canonical that merely repeats
      whatever address was asked for cannot do the one job the tag has. If the API ever resolves a
      slug loosely, this still names the one address we mean.
    */
    alternates: {
      canonical: `/${locale}/landmark/${resolved.landmark.slug}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}/landmark/${resolved.landmark.slug}`]),
      ),
    },
    openGraph: { title, description, type: 'website' },
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

  const resolved = await resolve(slug, locale);

  /* Unknown, retired, or a city nobody publishes any more — all the same answer. */
  if (!resolved) notFound();

  const { landmark, cityName, name, siblings } = resolved;

  const t = await getTranslations('landmark');
  const tnav = await getTranslations('nav');
  const ts = await getTranslations('search');

  const checkIn = todayInDamascus();
  const query = {
    checkIn,
    checkOut: addDays(checkIn, SAMPLE_NIGHTS),
    adults: SAMPLE_ADULTS,
    citySlug: landmark.citySlug,
    nearLandmark: landmark.slug,
    sort: 'distance_asc',
    limit: NEARBY_LIMIT,
  };

  const today = await searchSafely(query, { cached: true });

  /*
    Past the same-day cutoff the API refuses an arrival of today and names the first date that
    works. This block asks «what can somebody stay in», not «can somebody arrive tonight», so a
    refusal answers a question it did not mean to ask. The date comes from the API's own reply
    rather than from arithmetic repeated here over a setting this app does not read.
  */
  const reopened = today.notice?.firstBookableDate;
  const stay = {
    checkIn: reopened ?? checkIn,
    checkOut: addDays(reopened ?? checkIn, SAMPLE_NIGHTS),
  };

  const results = reopened
    ? await searchSafely({ ...query, ...stay }, { cached: true })
    : today;

  /*
    The dates and party this page actually priced, carried into every result link — built from the
    values above rather than from the request, for the reason `PropertyCard`'s `stay` prop records.
    Without it a card opened after the cutoff would hand the property page dates it cannot book.
  */
  const stayQuery = `?${new URLSearchParams({
    checkIn: stay.checkIn,
    checkOut: stay.checkOut,
    adults: String(SAMPLE_ADULTS),
  }).toString()}`;

  /* Where filtering lives. Exactly the address this route used to 307 to. */
  const searchHref = `/${locale}/search?${new URLSearchParams({
    citySlug: landmark.citySlug,
    nearLandmark: landmark.slug,
    sort: 'distance_asc',
  }).toString()}`;

  const kind = localisedText(landmark.kindName, locale);

  return (
    <>
      {/*
        The city page's hero, minus the photograph: a landmark carries coordinates and a name, and
        no image pipeline of its own. The gradient is that page's own fallback rather than a new
        treatment, so the two read as the siblings they are.
      */}
      <section className="relative border-b border-line">
        <div
          aria-hidden
          className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-20%,color-mix(in_oklab,var(--color-sky)_28%,transparent),transparent_65%)]"
        />
        <div className="relative mx-auto max-w-7xl px-4 py-14 sm:py-20">
          <nav
            aria-label={tnav('breadcrumb')}
            className="flex flex-wrap items-center text-sm text-faint"
          >
            {/* A breadcrumb link is a CONTROL, so it carries the 40px floor below `lg`. */}
            <Link
              href={`/${locale}`}
              className="inline-flex min-h-10 items-center hover:text-gold-read lg:min-h-0"
            >
              {tnav('home')}
            </Link>
            <span aria-hidden className="mx-2 inline-flex items-center">
              <BreadcrumbChevron />
            </span>
            {/*
              A real link, not a label. The city page is this page's parent in the crawl and the
              reader's most likely next step when nothing here is free.
            */}
            <Link
              href={`/${locale}/city/${landmark.citySlug}`}
              className="inline-flex min-h-10 items-center hover:text-gold-read lg:min-h-0"
            >
              {cityName}
            </Link>
            <span aria-hidden className="mx-2 inline-flex items-center">
              <BreadcrumbChevron />
            </span>
            <span className="text-muted">{name}</span>
          </nav>

          {/* Staff author the kinds, so a landmark may have none — then the line is absent. */}
          {kind ? <p className="mt-4 text-sm tracking-wide text-sky">{kind}</p> : null}

          {/*
            The H1 is the PHRASE, «إقامات قرب سوق الحميدية», not the landmark's name alone. That
            phrase is what somebody types, and a heading naming only the landmark would rank this
            page against encyclopaedia entries it cannot beat and has no business beating.

            `max-w-4xl` because this heading is a sentence where the city page's is one word: at
            1440px an uncapped display line runs past a comfortable measure.
          */}
          <h1
            className={`${kind ? 'mt-2' : 'mt-4'} max-w-4xl font-display text-4xl font-bold text-gold sm:text-5xl`}
          >
            {t('title', { landmark: name })}
          </h1>

          <p className="mt-4 max-w-3xl text-muted">
            {t('description', { landmark: name, city: cityName })}
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 py-10">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
          <h2 className="font-display text-2xl text-text">
            {t('staysNearby', { landmark: name })}
          </h2>
          <Link
            href={searchHref}
            className="inline-flex min-h-10 items-center text-sm text-gold-read hover:underline lg:min-h-0"
          >
            {t('viewAll')}
          </Link>
        </div>

        {results.items.length > 0 ? (
          <ul className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {results.items.map((item) => (
              <li key={item.propertyReference}>
                {/*
                  `nearLandmarkName` is what turns each card into «على بعد ٤٠٠ م من سوق الحميدية».
                  Resolved once for the page: the card would otherwise repeat the lookup per result
                  to answer a question this page already knows the answer to.
                */}
                <PropertyCard
                  item={item}
                  locale={locale}
                  stay={stayQuery}
                  nearLandmarkName={name}
                />
              </li>
            ))}
          </ul>
        ) : (
          <div className="mt-6 rounded-card border border-line bg-card p-6">
            <p className="text-text">{ts('noResults')}</p>
            <p className="mt-1 text-sm text-muted">{ts('noResultsHint')}</p>
          </div>
        )}
      </section>

      {/*
        The neighbours. A city's landmarks are the one set of pages a reader of THIS page is most
        likely to want next, and they are how a crawler reaches the other 124 without going back
        through the sitemap every time — the internal linking that was missing while every one of
        these addresses bounced.
      */}
      {siblings.length > 0 ? (
        <section className="mx-auto max-w-7xl px-4 pb-16">
          <h2 className="font-display text-2xl text-text">
            {t('otherLandmarks', { city: cityName })}
          </h2>
          <ul className="mt-6 flex flex-wrap gap-2">
            {siblings.map((one) => (
              <li key={one.slug}>
                <Link
                  href={`/${locale}/landmark/${one.slug}`}
                  className="inline-flex min-h-10 items-center rounded-full border border-line bg-card px-4 text-sm text-muted transition-colors duration-150 hover:border-gold hover:text-gold-read lg:min-h-0 lg:py-1.5"
                >
                  {localisedText(one.name, locale) || one.slug}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
