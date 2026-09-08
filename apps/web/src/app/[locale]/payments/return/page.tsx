import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { isLocale } from '@/i18n/routing';

/**
 * Where a payment provider returns the customer (§6.3 step 4).
 *
 * Three arrivals land here, and they need different pages:
 *
 *  1. **Bank transfer** — the customer has not paid yet and must be told exactly
 *     what to transfer and what reference to quote. This is the live rail for
 *     `Safra Technologies GmbH`; see ADR 0002.
 *  2. **Card, succeeded** — the gateway redirected back, but the money is only
 *     confirmed once the webhook arrives. The page says "checking", never
 *     "confirmed": trusting a redirect the customer's browser performed would let
 *     anyone mark a booking paid by visiting a URL.
 *  3. **Card, failed** — nothing was charged, the dates are still held, retry.
 *
 * Dynamic and `noindex`: it carries a booking reference and nothing worth crawling.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

type SearchParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export default async function PaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const query = await searchParams;
  const t = await getTranslations('paymentReturn');

  const status = first(query['status']);
  /*
    The reference a provider echoes back, if it echoes one.

    Read straight from the query rather than parsed out of a remittance value, which is what this
    did while the bank-transfer branch existed. It only ever LABELS the page and builds a link:
    `/booking/[reference]` is gated on the access token minted at creation, so a crafted reference
    reaches a page that refuses rather than a stranger's details — which is why linking on it is
    safe and querying a booking here would not be.
  */
  const reference = first(query['reference']);

  /*
    The bank-transfer block is GONE (Bashar, 2026-09-08).

    «Please remove the manual bank-transfer payment flow from the customer journey.» This page's
    only content for it was a remittance reference — it promised «حوّل المبلغ التالي» and rendered
    neither the amount nor an account to pay into (finding 219), because it deliberately queries no
    booking: references are sequential (§13.2) and a lookup keyed on one would leak a stranger's
    details. That was the right security call and the reason the page could not do its job.

    Nothing routes here for an offline rail now: the checkout form does not follow an offline
    redirect. What remains is what a REAL provider will need — a failure branch and a generic
    «we are checking your payment» — and the customer's own booking page carries the state.
  */
  if (status === 'failed') {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="font-display text-2xl font-bold text-bad">{t('failedTitle')}</h1>
        <p className="mt-3 text-muted">{t('failedBody')}</p>
        <Link
          href={`/${locale}/search`}
          className="mt-6 inline-block rounded-lg btn-gold px-5 py-2.5 font-semibold"
        >
          {t('retry')}
        </Link>
      </div>
    );
  }

  /**
   * Default: the gateway sent them back but only the webhook decides. Deliberately
   * non-committal — a redirect is a claim by the customer's browser, not evidence
   * that money moved.
   */
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 text-center">
      <p aria-hidden className="text-4xl text-gold">
        ⏳
      </p>
      <h1 className="mt-4 font-display text-2xl font-bold text-gold">
        {t('genericTitle')}
      </h1>
      <p className="mt-3 text-muted">{t('genericBody')}</p>

      {reference ? (
        <Link
          href={`/${locale}/booking/${reference}`}
          className="mt-6 inline-block rounded-lg border border-line px-5 py-2.5 text-sm text-muted transition-colors hover:border-gold hover:text-gold-read"
        >
          {t('viewBooking')}
        </Link>
      ) : null}
    </div>
  );
}
