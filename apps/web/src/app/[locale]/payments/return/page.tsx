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

  const method = first(query['method']);
  const remittance = first(query['remittance']);
  const status = first(query['status']);

  /**
   * The reference is read from the remittance value the provider echoed back, not
   * trusted as an identifier — it only ever labels the page. Nothing here queries a
   * booking, because a query keyed on a guessable reference would leak a stranger's
   * details (§13.2 makes references sequential).
   */
  const reference = remittance?.replace(/^SAFRA-/, '');

  if (method === 'bank_transfer' && remittance) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <h1 className="font-display text-2xl font-bold text-gold sm:text-3xl">
          {t('title')}
        </h1>
        <p className="mt-3 text-muted">{t('intro')}</p>

        <div className="mt-6 rounded-card border border-gold/40 bg-card p-5">
          <p className="text-xs text-faint">{t('remittanceLabel')}</p>
          {/* Selectable and monospaced: the customer has to copy this accurately. */}
          <p className="mt-1 select-all font-mono text-lg text-text">{remittance}</p>
          <p className="mt-2 text-xs text-faint">{t('remittanceHint')}</p>
        </div>

        <p className="mt-6 rounded-card border border-sky/30 bg-sky/10 p-4 text-sm text-sky">
          {t('nextSteps')}
        </p>

        {reference ? (
          <div className="mt-8">
            <p className="text-xs text-faint">{t('referenceLabel')}</p>
            <p className="font-display text-lg text-text">{reference}</p>
            <Link
              href={`/${locale}/booking/${reference}`}
              className="mt-4 inline-block rounded-lg border border-line px-5 py-2.5 text-sm text-muted transition-colors hover:border-gold hover:text-gold"
            >
              {t('viewBooking')}
            </Link>
          </div>
        ) : null}
      </div>
    );
  }

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
          className="mt-6 inline-block rounded-lg border border-line px-5 py-2.5 text-sm text-muted transition-colors hover:border-gold hover:text-gold"
        >
          {t('viewBooking')}
        </Link>
      ) : null}
    </div>
  );
}
