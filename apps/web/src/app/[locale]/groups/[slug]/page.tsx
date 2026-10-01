import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Breadcrumb } from '@/components/breadcrumb';
import { JsonLd } from '@/components/json-ld';
import { formatMoney, localisedText } from '@/lib/localise';
import { getGroupTrip, hasFinished, nightsBetween } from '@/lib/group-trips';
import { isLocale, routing } from '@/i18n/routing';
import { breadcrumbGraph, tripGraph } from '@/lib/structured-data';
import { imageUrl } from '@/lib/property';
import { siteOrigin } from '@/lib/site-url';
import { readableDateWithYear } from '@/lib/readable-date';

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
      <Breadcrumb
        label={t('title')}
        items={[{ label: t('backToList'), href: `/${locale}/groups` }, { label: title }]}
      />

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
        need a container, and `dl` is what they are. It collapses to one column on a phone, where
        four columns of Arabic would be unreadable.

        The dates take the width they need and the other three share what is left. Four EQUAL
        columns gave «الأربعاء، 27 كانون الثاني 2027» about 140px at 640–768px, and a date that
        must not wrap then painted over «7 ليالٍ» beside it; the other three are short enough to
        give up the room.
      */}
      <dl className="mt-6 grid gap-4 rounded-card border border-line bg-card p-5 sm:grid-cols-[max-content_repeat(3,minmax(0,1fr))]">
        <div>
          <dt className="text-13 text-faint">{t('labelDates')}</dt>
          <dd className="mt-1 text-14 text-text">
            <DateSpan
              from={readableDateWithYear(trip.startsOn, locale)}
              to={readableDateWithYear(trip.endsOn, locale)}
              sentence={t('dates', {
                from: readableDateWithYear(trip.startsOn, locale),
                to: readableDateWithYear(trip.endsOn, locale),
              })}
            />
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
        {/*
          The trip travels with the reader (Bashar, 2026-09-29), so support staff know which
          announcement produced the enquiry instead of opening with «which trip?».

          The SLUG, not the title: it is the trip's public identifier, it is what the URL already
          says, and it survives a retitle. The support page resolves it against a published trip
          and builds the sentence from the DATABASE's own words — the query only chooses WHICH
          known trip, exactly as `returnHref` limits a console back link to choosing which page of
          a known list. A crafted value resolves to nothing and prefills nothing.
        */}
        <Link
          href={`/${locale}/account/support?trip=${encodeURIComponent(trip.slug)}`}
          className="btn-gold mt-4 inline-flex min-h-10 cursor-pointer items-center rounded-lg px-4 text-sm font-bold"
        >
          {t('enquire')}
        </Link>
      </section>
    </article>
  );
}

/**
 * Departure over return, joined by a rule — the trip read as the short itinerary it is.
 *
 * It replaced one sentence, «{from} ← {to}», in a quarter-width column. Two long Levantine dates
 * do not fit a quarter of the page, so the line broke wherever it ran out, stranding a weekday at
 * the end of one line and its date on the next (Bashar, 2026-09-30). Each date is now its own
 * unbreakable line, and the rule carries the «to» without a glyph whose direction has to be
 * right in three languages.
 *
 * The catalogue sentence stays, for a screen reader: two bare dates announced one after the other
 * say nothing about which is the departure, and the drawing that says it is `aria-hidden`.
 */
function DateSpan({
  from,
  to,
  sentence,
}: {
  from: string;
  to: string;
  sentence: string;
}) {
  return (
    <>
      <span className="sr-only">{sentence}</span>
      <span aria-hidden="true" className="relative grid gap-1.5 ps-4">
        <span className="absolute start-[3.5px] top-[0.5lh] bottom-[0.5lh] w-px bg-line" />
        <span data-trip-date className="relative whitespace-nowrap">
          <span className="absolute -start-4 top-[calc(0.5lh-4px)] size-[8px] rounded-full border border-gold bg-card" />
          {from}
        </span>
        <span data-trip-date className="relative whitespace-nowrap">
          <span className="absolute -start-4 top-[calc(0.5lh-4px)] size-[8px] rounded-full bg-gold" />
          {to}
        </span>
      </span>
    </>
  );
}
