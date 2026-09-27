import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SectionPlaceholder } from '@/components/section-placeholder';
import { isLocale } from '@/i18n/routing';

/**
 * سياحة علاجية — in the navbar, and deliberately empty.
 *
 * Bashar asked for the item and chose «keep it empty» when asked what it should open (2026-09-27).
 * There is no medical-tourism property type, no trip attribute and no curated content behind it —
 * and this is a page about people's health, which is the last place to invent a claim. So it says
 * what the section is for and nothing it cannot stand behind.
 *
 * **When it fills**, the cheapest real version is a trip attribute partners tag their listings
 * with, like بحر and جبل, so the item opens a filtered search. That was offered and deferred; it
 * is recorded in `docs/FUTURE-WORK.md` rather than half-built here.
 */
export const dynamic = 'force-static';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'medicalTourism' });

  /*
    Not indexed while it is empty. A page with no content that Google has crawled is a result that
    disappoints somebody who searched for exactly this, and it stays in the index long after the
    section fills. `robots` comes off the day there is something here.
  */
  return { title: t('title'), description: t('body'), robots: { index: false } };
}

export default async function MedicalTourismPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('medicalTourism');

  return (
    <SectionPlaceholder
      locale={locale}
      ornamentId="medical-tourism"
      title={t('title')}
      body={t('body')}
      browseLabel={t('browse')}
      citiesLabel={t('cities')}
    />
  );
}
