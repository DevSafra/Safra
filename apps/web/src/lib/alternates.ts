import type { Metadata } from 'next';

import { routing, type Locale } from '@/i18n/routing';

/**
 * One page's canonical address and its language alternates, as one answer (audit 2026-10-06).
 *
 * ## Why it is a function rather than a line per page
 *
 * Each indexable page wrote its own `alternates` object, and four did not write one at all: the
 * home page, the partner application, the privacy page and the terms. Those inherited the locale
 * layout's default, which named the HOME page in three languages as their alternates and declared
 * no canonical, so a crawler was told that «الشروط» in Arabic was the English home page. Every page
 * that is meant to be found now asks this one function, and `alternates.test.ts` holds each of them
 * to it.
 *
 * ## What it emits
 *
 * - `canonical`: this locale's own address. RELATIVE on purpose: the layout's `metadataBase`, read
 *   from `NEXT_PUBLIC_SITE_URL` through `siteUrl()`, turns it absolute, so no domain is written
 *   anywhere in the app and the origin is decided once, by the deployment.
 * - `languages`: every locale SAFRA serves, plus `x-default`, which points at the default locale
 *   (Arabic): the page a searcher whose language is none of the three should land on.
 *
 * `path` is the part after the locale, starting with `/`, or `''` for the home page. Callers build
 * it from what the API ANSWERED (a resolved slug), never from the request, so a canonical can never
 * reflect request text into a `<link>` on our own page.
 */
export function localeAlternates(
  locale: Locale,
  path: string,
): NonNullable<Metadata['alternates']> {
  return {
    canonical: `/${locale}${path}`,
    languages: {
      ...Object.fromEntries(routing.locales.map((one) => [one, `/${one}${path}`])),
      'x-default': `/${routing.defaultLocale}${path}`,
    },
  };
}
