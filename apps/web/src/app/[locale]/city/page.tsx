import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { CityCard } from '@/components/city-card';
import { getCities } from '@/lib/catalog';
import { isLocale } from '@/i18n/routing';

/**
 * المدن — every destination SAFRA sells, on one page.
 *
 * ## Why it exists
 *
 * Bashar asked for المدن in the navbar (2026-09-27). Individual city pages have existed since the
 * geography work; there was no INDEX, so the only route to a destination was the landing page's
 * carousel — which shows three and a half cards and is not a list. A navbar item pointing at a
 * page that does not exist is a 404 on the most-pressed control on the site, and `tools/page-links`
 * fails the build for exactly that, so the page comes with the link rather than after it.
 *
 * ## It is the same card the landing page draws
 *
 * `CityCard` moved out of `page.tsx` for this, unchanged. Two cards for one thing is how two
 * screens end up disagreeing about what a destination looks like — and this one already carries
 * decisions that were argued over once: the 3:2 ratio, the ornament where staff have uploaded no
 * photograph, the category pill under the name rather than beside it, and no hover state on the
 * title.
 *
 * ## A grid, not the carousel
 *
 * The carousel on the landing page is a TEASER: its half-visible fourth card is the thing that says
 * «there is more», and the more is here. A reader who followed المدن wants the set, so this is a
 * plain responsive grid with no horizontal scrolling — the one thing `.claude/CLAUDE.md` forbids
 * outright on a page.
 *
 * ## Rendered per request, with the cities cached
 *
 * It was `force-static`, and that ran no script at all (2026-10-02): the security policy gives every
 * response a fresh nonce, a page built once carries a stale one, and the browser refused all forty
 * scripts, so the menu, the theme and the language switch were dead here. The cities list is still
 * reference data cached behind `CATALOGUE_TAG`, which is where the saving was; the HTML is not
 * cacheable under a nonce policy and `no-force-static.test.ts` keeps it so.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;

  if (!isLocale(locale)) return {};

  const t = await getTranslations({ locale, namespace: 'cities' });

  return { title: t('title'), description: t('subtitle') };
}

export default async function CitiesPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!isLocale(locale)) notFound();

  setRequestLocale(locale);

  const t = await getTranslations('cities');
  const th = await getTranslations('home');
  const cities = await getCities();

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:py-12">
      <h1 className="font-display text-3xl font-bold text-text sm:text-4xl">
        {t('title')}
      </h1>
      <p className="mt-3 max-w-[65ch] text-16 leading-relaxed text-muted">
        {t('subtitle')}
      </p>

      {cities.length === 0 ? (
        /*
          An empty catalogue is a real state, not an error: `getCities` answers `[]` rather than
          throwing when the read fails, so this page stays up and says so. A blank grid under a
          heading reads as a page that broke.
        */
        <p className="mt-8 text-16 text-faint">{t('empty')}</p>
      ) : (
        <ul className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cities.map((city) => (
            <li key={city.slug}>
              <CityCard city={city} locale={locale} stays={th} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
