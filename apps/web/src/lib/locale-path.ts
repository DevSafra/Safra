import { isLocale, routing, type Locale } from '@/i18n/routing';

/**
 * The same page, in another language.
 *
 * ## Why this is not `/${code}`
 *
 * The language switcher used to link at each locale's HOME page, which is a switcher that loses
 * the reader's place. On a property page — the page somebody arrives at from a search engine and
 * the one where language matters most — pressing "English" threw away the property.
 *
 * ## Why the first segment is REPLACED rather than prefixed
 *
 * Every customer route is `/{locale}/…`, so the locale is the first segment and swapping it is the
 * whole job. Prefixing would produce `/en/ar/search`, which 404s.
 *
 * A path whose first segment is NOT a locale — nothing routes that way today, but a middleware
 * change could — gets the locale prefixed instead of a wrong segment overwritten. Losing the page
 * is better than landing on a different one.
 *
 * The query string is deliberately dropped: `?checkIn=` and friends are safe to keep, but `?next=`
 * on the sign-in page is a path this function would be carrying across a language change without
 * validating, and a switcher is not the place to reason about that.
 */
export function swapLocale(pathname: string, code: Locale): string {
  const segments = pathname.split('/').filter(Boolean);
  const [first, ...rest] = segments;

  if (first !== undefined && isLocale(first)) {
    return `/${[code, ...rest].join('/')}`;
  }

  return `/${[code, ...segments].join('/')}`;
}

/** The locale a path is under, or the default when it names none. */
export function localeOfPath(pathname: string): Locale {
  const [first] = pathname.split('/').filter(Boolean);

  return first !== undefined && isLocale(first) ? first : routing.defaultLocale;
}
