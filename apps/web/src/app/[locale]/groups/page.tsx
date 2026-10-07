import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { GroupTripCard } from '@/components/group-trip-card';
import { SectionPlaceholder } from '@/components/section-placeholder';
import { getGroupTrips } from '@/lib/group-trips';
import { isLocale } from '@/i18n/routing';
import { localeAlternates } from '@/lib/alternates';

/**
 * جروبات — the trips SAFRA puts together (Bashar, 2026-09-27; built 2026-09-28).
 *
 * *«only the admin can create a group trip for this»*: every trip here is authored by staff in the
 * console. This page announces them; it does not sell them. Interest is routed to the support inbox
 * that already exists, from the trip's own page.
 *
 * ## It keeps the placeholder for the empty case
 *
 * A section with nothing in it is a real state, not a failure — and the placeholder already says
 * what جروبات is and offers somewhere to go. Replacing it with «no results» would be a worse
 * version of a screen that already exists. The `noindex` comes OFF the moment there is a trip,
 * which is the condition the original page said it was waiting for.
 */
export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'groups' });
  const trips = await getGroupTrips();

  /*
    Indexed once there is something to find, and not before. A crawled page with no content is a
    search result that disappoints the person who searched for exactly this, and it outlives the
    emptiness by weeks.
  */
  return {
    title: t('title'),
    description: t('body'),
    ...(trips.length === 0 ? { robots: { index: false } } : {}),
    alternates: localeAlternates(locale, '/groups'),
  };
}

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('groups');
  const trips = await getGroupTrips();

  if (trips.length === 0) {
    return (
      <SectionPlaceholder
        locale={locale}
        ornamentId="groups"
        title={t('title')}
        body={t('empty')}
        browseLabel={t('browse')}
      />
    );
  }

  return (
    <article className="mx-auto max-w-7xl px-4 py-10">
      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-bold text-text sm:text-4xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-muted">{t('body')}</p>
      </header>

      {/*
        A grid rather than a row of equal cards in a slider: a trip is read, not browsed past, and
        the set is small enough that everything fits on one screen at desktop. `min-width: 0` is
        handled globally, so a long Arabic title cannot push the column wider than its track.
      */}
      <ul className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {trips.map((trip) => (
          <GroupTripCard
            key={trip.slug}
            trip={trip}
            locale={locale}
            labels={{
              priceFrom: (amount) => t('priceFrom', { amount }),
              priceOnRequest: t('priceOnRequest'),
              nights: (n) => t('nights', { n }),
              seats: (n) => t('seats', { n }),
              past: t('past'),
            }}
          />
        ))}
      </ul>
    </article>
  );
}
