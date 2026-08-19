import 'server-only';

import { notFound, redirect } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';

import { isLocale, type Locale } from '@/i18n/routing';
import { getSession } from '@/lib/session-server';

/**
 * The guard every account section repeats: a real locale, and a signed-in customer.
 *
 * One helper rather than eight copies. Middleware already guards `/account`, and the session check
 * stays anyway — a page that reads personal data should not depend on a matcher pattern staying
 * correct, which is the reasoning the original single page recorded and it applies eight times over
 * now.
 *
 * `next` carries the SECTION the reader was trying to reach, not `/account`, so signing in returns
 * them to الفواتير rather than to the overview.
 */
export async function requireAccount(
  locale: string,
  section = '',
): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  locale: Locale;
}> {
  return requireSignedIn(locale, `/account${section}`);
}

/**
 * The same guard for a signed-in page that is NOT under `/account`.
 *
 * «انضم كشريك» is the first of them (Bashar, 2026-08-19): applying is only for people who already
 * have an account, but the page itself is not one of the customer's own records and does not live
 * in that section.
 *
 * @param path The destination BELOW the locale, e.g. `/partners/join`. A literal from the caller,
 *   never anything from a request — it is interpolated into the `next` parameter, and a path taken
 *   from the URL would make the sign-in redirect an open redirect.
 */
export async function requireSignedIn(
  locale: string,
  path: string,
): Promise<{
  session: NonNullable<Awaited<ReturnType<typeof getSession>>>;
  locale: Locale;
}> {
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const session = await getSession();

  if (!session) {
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}${path}`)}`);
  }

  /*
    The NARROWED locale travels back to the caller.

    `isLocale` is a type guard, but narrowing does not cross a function boundary — so every page
    would otherwise hold a bare `string` and `formatMoney` (which takes `'ar' | 'en' | 'de'`) would
    reject it. Returning it here means the check happens once and the type survives it.
  */
  return { session, locale };
}

/** Every account page is personal, so none of them may be indexed or cached. */
export const ACCOUNT_METADATA = {
  robots: { index: false, follow: false },
} as const;
