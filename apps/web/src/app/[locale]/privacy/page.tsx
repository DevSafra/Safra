import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { LegalPage } from '@/components/legal-page';
import { isLocale, routing } from '@/i18n/routing';
import { LEGAL_UPDATED } from '@/lib/legal';

/**
 * سياسة الخصوصية — written from the schema, not from a template.
 *
 * ## Why that distinction matters
 *
 * A privacy notice is a factual claim about a system, and a wrong one is a compliance liability
 * rather than bad copy. Every statement here was checked against the code: passwords hashed with
 * Argon2id, two-factor secrets encrypted at rest, contact details masked out of messages and
 * disputes BEFORE storage with no original kept, exports deleted after seven days, unsigned payment
 * callbacks after thirty, photographs retained deliberately as evidence of what a listing claimed.
 *
 * The cookie section names the three cookies this site sets and no others, because that list is
 * verifiable and a generic "we and our partners use cookies" would not be true here — there are no
 * advertising trackers and no third-party analytics to disclose.
 *
 * What is missing is what the system cannot answer: the controller's identity and address, the
 * privacy contact, and the supervisory authority. Those are named in the notice at the top.
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

  return { title: t('privacy.title'), description: t('privacy.intro') };
}

export default async function PrivacyPage({
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
      title={t('privacy.title')}
      intro={t('privacy.intro')}
      updated={t('updated', { date: LEGAL_UPDATED })}
      pending={{ title: t('pendingTitle'), body: t('pendingBody') }}
      backLabel={t('backHome')}
      sections={[
        { heading: t('privacy.whoHeading'), body: t('privacy.whoBody') },
        { heading: t('privacy.collectHeading'), body: t('privacy.collectBody') },
        { heading: t('privacy.whyHeading'), body: t('privacy.whyBody') },
        { heading: t('privacy.shareHeading'), body: t('privacy.shareBody') },
        { heading: t('privacy.keepHeading'), body: t('privacy.keepBody') },
        { heading: t('privacy.rightsHeading'), body: t('privacy.rightsBody') },
        { heading: t('privacy.cookiesHeading'), body: t('privacy.cookiesBody') },
        { heading: t('privacy.contactHeading'), body: t('privacy.contactBody') },
      ]}
    />
  );
}
