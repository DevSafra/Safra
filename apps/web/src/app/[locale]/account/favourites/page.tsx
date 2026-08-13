import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { SaveButton } from '@/components/save-button';
import { getAccountSummary, getMyFavourites } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { localisedName } from '@/lib/localise';
import { getCurrencyCatalogue } from '@/lib/catalog';
import { convertForDisplay, displayCurrency } from '@/lib/currency';

/**
 * المفضلة — the listings this customer has saved (handoff §6).
 *
 * ## An unavailable listing is shown, not dropped
 *
 * A property the partner has since suspended stays on the list, marked. Removing it silently would
 * look like the save had failed, and the reader would have no way to tell the difference.
 *
 * ## The remove control is the same button as the save one
 *
 * `SaveButton` names the ACTION rather than reporting the state, so on this screen — where everything
 * is saved — it reads «إزالة من المفضلة». One component, so the two paths cannot disagree about what
 * pressing it does.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountFavouritesPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/favourites');

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';

  const t = await getTranslations('account');

  /*
    A saved listing is a BROWSE surface — somebody comparing what they shortlisted — so its price
    converts like a search card's. Cached and request-deduplicated, so this adds no round trip.
  */
  const [{ rates }, target] = await Promise.all([
    getCurrencyCatalogue(),
    displayCurrency(),
  ]);
  const property = await getTranslations('property');

  const [summaryRead, favouritesRead] = await Promise.all([
    getAccountSummary(),
    getMyFavourites(cursor || undefined),
  ]);

  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;
  const favourites =
    favouritesRead === 'failed' || favouritesRead === 'unauthenticated'
      ? null
      : favouritesRead;

  return (
    <AccountShell
      locale={locale}
      active="favourites"
      title={t('navFavourites')}
      summary={summary}
    >
      {favourites === null ? (
        <p className="text-sm text-bad">{t('loadFailed')}</p>
      ) : favourites.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-card p-6 text-center">
          <p className="text-sm text-muted">{t('favouritesNone')}</p>
          <Link
            href={`/${locale}/search`}
            className="mt-3 inline-block rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-bg"
          >
            {t('findStay')}
          </Link>
        </div>
      ) : (
        <>
          <ul className="grid gap-3 sm:grid-cols-2">
            {favourites.items.map((item) => (
              <li
                key={item.slug}
                data-favourite={item.slug}
                className="flex h-full flex-col gap-2 rounded-card border border-line bg-card p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <h2 className="font-display text-lg text-text">
                    <Link
                      href={`/${locale}/property/${item.slug}`}
                      className="inline-flex min-h-10 items-center hover:text-gold lg:min-h-0"
                    >
                      {localisedName(item.property, locale)}
                    </Link>
                  </h2>
                  {item.rating ? (
                    <span
                      dir="ltr"
                      className="shrink-0 rounded-lg border border-line bg-field px-2 py-1 text-sm text-gold"
                    >
                      ★ {item.rating}
                    </span>
                  ) : null}
                </div>

                <p className="text-sm text-muted">{localisedName(item.city, locale)}</p>

                {/* An unavailable listing says so rather than quietly disappearing. */}
                {!item.isAvailable ? (
                  <p className="w-fit rounded-full border border-warn/40 bg-warn/10 px-2.5 py-0.5 text-xs text-warn">
                    {t('favouriteUnavailable')}
                  </p>
                ) : item.fromPrice && item.currencyCode ? (
                  <p className="text-sm text-gold">
                    {t('favouriteFrom')}{' '}
                    <span dir="ltr">
                      {
                        convertForDisplay(
                          item.fromPrice,
                          item.currencyCode,
                          locale,
                          target,
                          rates,
                        ).text
                      }
                    </span>
                  </p>
                ) : null}

                <div className="mt-auto pt-2">
                  <SaveButton
                    slug={item.slug}
                    initiallySaved
                    labels={{
                      save: property('save'),
                      saved: t('favouriteRemove'),
                      failed: property('saveFailed'),
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>

          {cursor || favourites.nextCursor ? (
            <nav
              aria-label={t('navFavourites')}
              className="mt-6 flex flex-wrap items-center gap-2"
            >
              {cursor ? (
                <Link
                  href={`/${locale}/account/favourites`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                >
                  {t('firstPage')}
                </Link>
              ) : null}
              {favourites.nextCursor ? (
                <Link
                  href={`/${locale}/account/favourites?cursor=${encodeURIComponent(favourites.nextCursor)}`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                >
                  {t('loadMore')}
                </Link>
              ) : null}
            </nav>
          ) : null}
        </>
      )}
    </AccountShell>
  );
}
