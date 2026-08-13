import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LegalPage } from '@/components/legal-page';
import { isLocale, routing } from '@/i18n/routing';
import { LEGAL_UPDATED } from '@/lib/legal';

/**
 * شروط الاستخدام — what SAFRA provides and what each side agrees to.
 *
 * ## Every clause here is something the code actually does
 *
 * The 120-minute confirmation window, the 17:00 same-day cutoff, the 50% refund floor, the
 * compensation when a partner does not answer, reviews being hidden rather than deleted, a dispute
 * freezing a payout — all of those are behaviours with tests behind them, not aspirations. Terms
 * that describe a system nobody built are the ones that get quoted back at you.
 *
 * What is NOT here is the governing law, which is a decision rather than a fact about the code. The
 * page says so where it belongs instead of guessing.
 *
 * Statically rendered per locale: this is the same document for everybody and depends on nothing
 * about the reader.
 */
export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'legal' });

  return { title: t('terms.title'), description: t('terms.intro') };
}

export default async function TermsPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('legal');

  return (
    <LegalPage
      locale={locale}
      title={t('terms.title')}
      intro={t('terms.intro')}
      updated={t('updated', { date: LEGAL_UPDATED })}
      pending={{ title: t('pendingTitle'), body: t('pendingBody') }}
      backLabel={t('backHome')}
      sections={[
        { heading: t('terms.roleHeading'), body: t('terms.roleBody') },
        { heading: t('terms.bookingHeading'), body: t('terms.bookingBody') },
        { heading: t('terms.noResponseHeading'), body: t('terms.noResponseBody') },
        { heading: t('terms.priceHeading'), body: t('terms.priceBody') },
        { heading: t('terms.cancelHeading'), body: t('terms.cancelBody') },
        { heading: t('terms.reviewsHeading'), body: t('terms.reviewsBody') },
        { heading: t('terms.disputesHeading'), body: t('terms.disputesBody') },
        { heading: t('terms.changesHeading'), body: t('terms.changesBody') },
        { heading: t('terms.lawHeading'), body: t('terms.lawBody') },
      ]}
    />
  );
}
