import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { BreadcrumbChevron } from '@/components/icons';
import { JsonLd } from '@/components/json-ld';
import { formatMoney, localisedText } from '@/lib/localise';
import { getGroupTrip, hasFinished, nightsBetween } from '@/lib/group-trips';
import { isLocale, routing } from '@/i18n/routing';
import { breadcrumbGraph, tripGraph } from '@/lib/structured-data';
import { imageUrl } from '@/lib/property';
import { siteOrigin } from '@/lib/site-url';
import { readableDate } from '@/lib/readable-date';

/**
 * One announced trip.
 *
 * ## A draft is a 404, and that is deliberate
 *
 * The API refuses an unpublished slug exactly as it refuses one nobody ever used, so this page
 * cannot tell the difference either. «Being prepared» and «does not exist» must read the same to a
 * stranger, or the difference announces that a trip is coming under a name they can now guess.
 *
 * ## Enquiring is the support inbox, not a booking
 *
 * This version has no seats to sell. «استفسر عن هذه الرحلة» opens the three-party conversation that
 * already exists and already lands in the console — the same route a customer uses for any other
 * question. Building a booking path for a demand nobody has evidenced is the weeks of work this
 * version exists to defer.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}): Promise<Metadata> {
  const { locale, slug } = await params;

  if (!isLocale(locale)) return {};

  const trip = await getGroupTrip(slug);

  if (!trip) return { robots: { index: false } };

  const title = localisedText(trip.title, locale);
  const description = localisedText(trip.summary, locale);

  /*
    The cover, for the card a link turns into when somebody pastes it into WhatsApp or Telegram
    (Bashar, 2026-09-29: «in social sharing previews where applicable»).

    WEBP rather than AVIF, and 1600 rather than the card's 400: scrapers want a wide image and
    WebP is the widest-supported format this pipeline produces. `imageUrl` returns an absolute URL
    already — it is built from `NEXT_PUBLIC_MEDIA_URL`, the object store's own origin — so this one
    does not pass through `metadataBase`, and it must not: the image is not served from the site.

    A trip with no cover sends no `images` key at all rather than a placeholder. A link that
    previews a generic graphic is worse than one that previews none: it looks like the content, and
    it is not.
  */
  const cover = trip.cover
    ? {
        images: [
          {
            url: imageUrl(trip.cover, 1600, 'webp'),
            ...(trip.cover.width !== null && trip.cover.height !== null
              ? { width: trip.cover.width, height: trip.cover.height }
              : {}),
            alt: localisedText(trip.cover.alt, locale) || title,
          },
        ],
      }
    : {};

  return {
    title,
    description,
    alternates: {
      canonical: `/${locale}/groups/${slug}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}/groups/${slug}`]),
      ),
    },
    openGraph: { title, description, type: 'article', ...cover },
    /* Without this a large photograph is cropped to a 120px square thumbnail on X. */
    twitter: {
      card: trip.cover ? 'summary_large_image' : 'summary',
      title,
      description,
      ...cover,
    },
  };
}

export default async function GroupTripPage({
  params,
}: {
  params: Promise<{ locale: string; slug: string }>;
}) {
  const { locale, slug } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const trip = await getGroupTrip(slug);

  if (!trip) notFound();

  const t = await getTranslations('groups');
  const title = localisedText(trip.title, locale);
  const summary = localisedText(trip.summary, locale);
  const description = localisedText(trip.description, locale);
  const city = localisedText(trip.city.name, locale);
  const nights = nightsBetween(trip.startsOn, trip.endsOn);
  const finished = hasFinished(trip.endsOn);

  /*
    A `TouristTrip` — dates, a destination and, when there is one, a price with its currency.

    Deliberately NO `availability` and no seat count in the offer: this version announces trips and
    does not sell them, so a graph implying a bookable inventory would assert to Google the booking
    engine the product decision defers. `structured-data.test.ts` holds that.
  */
  const origin = siteOrigin();
  const graphs = [
    tripGraph({
      name: title,
      description: summary,
      url: `${origin}/${locale}/groups/${trip.slug}`,
      cityName: city,
      countryCode: trip.city.countryCode,
      startsOn: trip.startsOn,
      endsOn: trip.endsOn,
      images: trip.cover ? [imageUrl(trip.cover, 1600, 'webp')] : [],
      priceFrom:
        trip.priceFrom && trip.currencyCode
          ? { amount: trip.priceFrom, currency: trip.currencyCode }
          : null,
    }),
    breadcrumbGraph([
      { name: t('title'), url: `${origin}/${locale}/groups` },
      { name: title, url: `${origin}/${locale}/groups/${trip.slug}` },
    ]),
  ];

  return (
    <article className="mx-auto max-w-4xl px-4 py-8">
      {graphs.map((graph, index) => (
        <JsonLd key={index} graph={graph} />
      ))}

      {/* The same breadcrumb shape the property page uses — one chevron, drawn, following the page. */}
      <nav
        aria-label={t('title')}
        className="flex flex-wrap items-center text-sm text-faint"
      >
        <Link
          href={`/${locale}/groups`}
          className="inline-flex min-h-10 items-center hover:text-gold-read lg:min-h-0"
        >
          {t('backToList')}
        </Link>
        <span aria-hidden className="mx-2 inline-flex items-center">
          <BreadcrumbChevron />
        </span>
        <span className="text-muted">{title}</span>
      </nav>

      {/*
        The photograph, between the breadcrumb and the title.

        `loading="eager"` and `fetchPriority="high"`, deliberately against the card's lazy default:
        this is the LARGEST element above the fold, so it IS the LCP, and a lazily-loaded LCP is
        the classic way to lose a second on a slow connection — the audience this product is built
        for. 16:9 rather than the card's 3:2 because 3:2 at this width is 597px of photograph
        before the reader reaches the trip's name.

        No ornament fallback here. On the card the band holds the grid's rhythm and must be filled;
        on a page of its own, an empty decorative box above the title is furniture.
      */}
      {trip.cover ? (
        <div className="mt-6 aspect-[16/9] overflow-hidden rounded-card border border-line bg-band">
          <picture>
            <source srcSet={imageUrl(trip.cover, 1600, 'avif')} type="image/avif" />
            <source srcSet={imageUrl(trip.cover, 1600, 'webp')} type="image/webp" />
            <img
              src={imageUrl(trip.cover, 1600, 'webp')}
              alt={localisedText(trip.cover.alt, locale)}
              {...(trip.cover.width !== null && trip.cover.height !== null
                ? { width: trip.cover.width, height: trip.cover.height }
                : {})}
              className="size-full object-cover"
              loading="eager"
              fetchPriority="high"
            />
          </picture>
        </div>
      ) : null}

      <header className="mt-6">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/${locale}/city/${trip.city.slug}`}
            className="text-sm text-sky hover:underline"
          >
            {city}
          </Link>
          <span
            className={
              finished
                ? 'rounded-full border border-line px-2 py-0.5 text-12 text-faint'
                : 'rounded-full border border-gold/40 bg-gold/10 px-2 py-0.5 text-12 text-gold-read'
            }
          >
            {finished ? t('past') : t('upcoming')}
          </span>
        </div>

        <h1 className="mt-2 font-display text-3xl font-bold text-gold sm:text-4xl">
          {title}
        </h1>
        <p className="mt-3 text-muted">{summary}</p>
      </header>

      {/*
        The facts, as a definition list rather than a row of cards: four short values do not each
        need a container, and `dl` is what they are. `sm:grid-cols-4` collapses to one column on a
        phone, where four columns of Arabic would be unreadable.
      */}
      <dl className="mt-6 grid gap-4 rounded-card border border-line bg-card p-5 sm:grid-cols-4">
        <div>
          <dt className="text-13 text-faint">{t('labelDates')}</dt>
          <dd className="mt-1 text-14 text-text">
            {t('dates', {
              from: readableDate(trip.startsOn, locale),
              to: readableDate(trip.endsOn, locale),
            })}
          </dd>
        </div>
        {nights > 0 ? (
          <div>
            <dt className="text-13 text-faint">{t('labelDuration')}</dt>
            <dd className="mt-1 text-14 text-text">{t('nights', { n: nights })}</dd>
          </div>
        ) : null}
        {trip.seats !== null ? (
          <div>
            <dt className="text-13 text-faint">{t('labelSeats')}</dt>
            <dd className="mt-1 text-14 text-text">{t('seats', { n: trip.seats })}</dd>
          </div>
        ) : null}
        <div>
          <dt className="text-13 text-faint">{t('labelPrice')}</dt>
          <dd className="mt-1 text-14 font-bold text-gold-read">
            {trip.priceFrom && trip.currencyCode
              ? t('priceFrom', {
                  amount: formatMoney(trip.priceFrom, trip.currencyCode, locale),
                })
              : t('priceOnRequest')}
          </dd>
        </div>
      </dl>

      <section className="mt-8">
        <h2 className="font-display text-xl text-text">{t('about')}</h2>
        {/* `whitespace-pre-line` so the paragraphs staff typed survive; everything else collapses. */}
        <p className="mt-3 whitespace-pre-line leading-relaxed text-muted">
          {description}
        </p>
      </section>

      <section className="mt-8 rounded-card border border-line bg-card p-5">
        <h2 className="font-display text-lg text-text">{t('enquire')}</h2>
        <p className="mt-2 text-sm text-muted">{t('enquireNote')}</p>
        <Link
          href={`/${locale}/account/support`}
          className="btn-gold mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-lg px-4 text-sm font-bold"
        >
          {t('enquire')}
        </Link>
      </section>
    </article>
  );
}
