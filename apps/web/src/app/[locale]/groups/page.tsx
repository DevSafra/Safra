import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { SectionPlaceholder } from '@/components/section-placeholder';
import { isLocale } from '@/i18n/routing';

/**
 * جروبات — trips SAFRA puts together, and there are none yet.
 *
 * Bashar, 2026-09-27: «only the admin can create a group trip for this». That is the shape — a
 * group trip is AUTHORED by staff in the console rather than assembled by a customer — and none of
 * it exists yet: no entity, no console screen, no public listing. The booking engine books one unit
 * with a quantity, which is a different thing.
 *
 * So the page is honest about being empty and says whose trips these will be. The entity and its
 * console screens are recorded in `docs/FUTURE-WORK.md`; building them behind a navbar item nobody
 * has specified would be inventing a product.
 */
export const dynamic = 'force-static';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'groups' });

  /*
    Not indexed while it is empty. A page with no content that Google has crawled is a result that
    disappoints somebody who searched for exactly this, and it stays in the index long after the
    section fills. `robots` comes off the day there is something here.
  */
  return { title: t('title'), description: t('body'), robots: { index: false } };
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

  return (
    <SectionPlaceholder
      locale={locale}
      ornamentId="groups"
      title={t('title')}
      body={t('body')}
      browseLabel={t('browse')}
      citiesLabel={t('cities')}
    />
  );
}
