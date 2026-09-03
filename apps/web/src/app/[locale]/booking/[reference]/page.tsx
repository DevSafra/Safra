import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { getTranslations } from 'next-intl/server';

import { BackLink } from '@/components/back-link';
import { isLocale } from '@/i18n/routing';
import { isBookingReference } from '@/lib/booking-reference';
import { returnTo } from '@/lib/return-to';

/**
 * Post-payment holding page (SRS §6.3 steps 5–8).
 *
 * §6.1 is emphatic that booking is not instant, so this page's job is to make the
 * wait legible rather than leave the customer wondering: the money has been taken,
 * the partner has two hours, and if they do not answer the customer is refunded and
 * compensated.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function BookingPendingPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale, reference } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  /*
    The reference is echoed onto the page, so its SHAPE is checked even though nothing is looked up.

    Anything that cannot name a booking gets the not-found page rather than a confirmation for something
    that does not exist. `isBookingReference` carries the reasoning and the regression tests — the short
    version is that this page renders the segment as an official «Booking reference» under real branding,
    which made any URL a phishing page on our own domain.
  */
  if (!isBookingReference(reference)) notFound();

  /*
    Back to wherever the reader came from — their bookings list, the overview, or the home page.

    `home` is the fallback rather than the account, and deliberately: this page performs NO booking
    lookup and is not behind the auth middleware, so a guest who has just paid can be standing on it.
    Sending them to `/account` would bounce them into a sign-in they may not have.
  */
  const back = returnTo(locale, (await searchParams)['from'], 'home');

  const t = await getTranslations('bookingPending');

  // Deliberately no booking lookup. A reference alone must not reveal a booking's
  // details to anyone who guesses one — references are sequential (§13.2). The
  // customer's own bookings are readable through the ownership-scoped API once they
  // sign in; this page only confirms what they just did.
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p aria-hidden className="text-4xl text-gold">
        ⏳
      </p>
      <h1 className="mt-4 font-display text-2xl font-bold text-gold sm:text-3xl">
        {t('title')}
      </h1>
      <p className="mt-3 text-muted">{t('body')}</p>

      <div className="mt-6 inline-block rounded-card border border-line bg-card px-6 py-4">
        <p className="text-xs text-faint">{t('referenceLabel')}</p>
        <p className="mt-1 font-display text-xl text-text">{reference}</p>
      </div>

      <ol className="mt-8 space-y-3 text-start">
        {[t('step1'), t('step2'), t('step3')].map((step, index) => (
          <li
            key={step}
            className="flex gap-3 rounded-card border border-line bg-card p-4"
          >
            <span
              aria-hidden
              className="grid size-7 shrink-0 place-items-center rounded-full border border-gold/40 text-sm text-gold-ink"
            >
              {index + 1}
            </span>
            <span className="text-sm text-muted">{step}</span>
          </li>
        ))}
      </ol>

      <p className="mt-6 rounded-card border border-ok/30 bg-ok/10 p-4 text-sm text-ok">
        {t('guarantee')}
      </p>

      <div className="mt-8 flex justify-center">
        <BackLink href={back} locale={locale} />
      </div>
    </div>
  );
}
