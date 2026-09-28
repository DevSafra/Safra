import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { BreadcrumbChevron } from '@/components/icons';
import { formatMoney, localisedText } from '@/lib/localise';
import { getGroupTrip, hasFinished, nightsBetween } from '@/lib/group-trips';
import { isLocale, routing } from '@/i18n/routing';
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

  return {
    title: localisedText(trip.title, locale),
    description: localisedText(trip.summary, locale),
    alternates: {
      canonical: `/${locale}/groups/${slug}`,
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, `/${l}/groups/${slug}`]),
      ),
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

  return (
    <article className="mx-auto max-w-4xl px-4 py-8">
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
