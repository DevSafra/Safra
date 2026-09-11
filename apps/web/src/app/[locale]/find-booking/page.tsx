import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { FindBookingForm } from '@/components/find-booking-form';
import { isLocale } from '@/i18n/routing';

/**
 * EC-010 tier 1 — recovering a lost booking reference (SRS §16).
 *
 * `noindex`, like every other recovery screen: a page that accepts an address and sends mail has
 * no business in a search result, and indexing it invites exactly the traffic the throttle exists
 * to bound.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function FindBookingPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const t = await getTranslations('auth');

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      {/*
        Centred (Bashar, 2026-09-11).

        On the heading and the line under it, not on the wrapper: the form below keeps its own
        alignment, and `text-center` on the container would drag the field labels and the button's
        text to the middle with it — which is the change nobody asked for and the one people notice.
      */}
      <h1 className="text-center font-display text-3xl font-bold text-gold">
        {t('findTitle')}
      </h1>
      <p className="mt-2 text-center text-sm text-muted">{t('findSubtitle')}</p>

      <div className="mt-8 rounded-card border border-line bg-card p-6">
        <FindBookingForm locale={locale} />
      </div>
    </div>
  );
}
