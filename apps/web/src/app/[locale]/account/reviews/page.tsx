import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { DateRange } from '@/components/date-range';
import { getAccountSummary, getMyReviews, getPendingReviews } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { localisedName } from '@/lib/localise';
import { returnParam } from '@/lib/return-to';

/**
 * تقييماتي — handoff §6.
 *
 * What this shows today is the stays a customer may still write about, which is the half the API can
 * answer: `GET /reviews/pending` returns exactly what `POST /reviews` would accept, so the prompt and
 * the endpoint cannot disagree and offer a form that is then refused.
 *
 * What it does NOT yet show is the reviews they have already published. There is no endpoint for a
 * customer's own submitted reviews — `GET /reviews` is the partner's list of reviews ABOUT them — so
 * rather than guess, the section says so. Adding that endpoint is small and is recorded as next work.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountReviewsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/reviews');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const t = await getTranslations('account');
  const reviews = await getTranslations('reviews');
  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';

  const [pending, mineRead] = await Promise.all([
    getPendingReviews(),
    getMyReviews(cursor || undefined),
  ]);

  const mine = mineRead === 'failed' || mineRead === 'unauthenticated' ? null : mineRead;

  return (
    <AccountShell
      locale={locale}
      active="reviews"
      summary={summary}
      title={t('navReviews')}
    >
      {pending === 'failed' ? (
        <p className="text-sm text-bad">{t('loadFailed')}</p>
      ) : pending === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t('sessionExpired')}</p>
      ) : (
        <div className="grid gap-8">
          <section>
            <h2 className="font-display text-xl text-text">{reviews('pendingTitle')}</h2>

            {pending.length === 0 ? (
              <p className="mt-3 rounded-lg border border-line bg-card p-4 text-sm text-faint">
                {t('nothingWaiting')}
              </p>
            ) : (
              <ul className="mt-3 space-y-3">
                {pending.map((stay) => (
                  <li key={stay.bookingReference}>
                    <Link
                      href={`/${locale}/review/${stay.bookingReference}?${returnParam('reviews')}`}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-gold/40 bg-card p-4 transition-colors hover:border-gold"
                    >
                      <span>
                        <span className="block text-sm text-text">
                          {localisedName(stay.property, locale)}
                        </span>
                        <span className="block text-xs text-faint">
                          {localisedName(stay.unit, locale)} ·{' '}
                          <DateRange
                            from={stay.checkIn}
                            to={stay.checkOut}
                            locale={locale}
                          />
                        </span>
                      </span>
                      <span className="text-sm font-semibold text-gold-ink">
                        {reviews('writeReview')}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* The published half — real now that `GET /reviews/mine` exists. */}
          <section>
            <h2 className="font-display text-xl text-text">
              {t('reviewsSubmittedTitle')}
            </h2>

            {mine === null ? (
              <p className="mt-3 text-sm text-bad">{t('loadFailed')}</p>
            ) : mine.items.length === 0 ? (
              <p className="mt-3 rounded-lg border border-line bg-card p-4 text-sm text-faint">
                {t('reviewsNone')}
              </p>
            ) : (
              <>
                <ul className="mt-3 space-y-3">
                  {mine.items.map((review) => (
                    <li
                      key={review.reference}
                      className="rounded-card border border-line bg-card p-4"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm text-text">
                          {localisedName(review.property, locale)}
                        </p>
                        {/* A score is a Latin numeral pair on a line that may be Arabic. */}
                        <p className="text-sm font-bold text-gold-ink" dir="ltr">
                          {review.rating} / 5
                        </p>
                      </div>

                      <p className="mt-0.5 text-xs text-faint">
                        {localisedName(review.unit, locale)} ·{' '}
                        {review.createdAt.slice(0, 10)}
                      </p>

                      <p className="mt-2 text-sm leading-relaxed text-text2">
                        {review.body}
                      </p>

                      {/*
                        A hidden review is shown to its author with the reason. Concealing it would
                        leave them unable to tell removal from a failed save.
                      */}
                      {review.status === 'hidden' ? (
                        <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 p-3 text-xs leading-relaxed text-warn">
                          {reviews('hidden')}
                        </p>
                      ) : null}

                      {review.partnerReply ? (
                        <div className="mt-3 rounded-lg border border-line bg-field p-3">
                          <p className="text-xs text-faint">{reviews('partnerReply')}</p>
                          <p className="mt-1 text-sm text-text2">{review.partnerReply}</p>
                        </div>
                      ) : null}
                    </li>
                  ))}
                </ul>

                {cursor || mine.nextCursor ? (
                  <nav
                    aria-label={t('reviewsSubmittedTitle')}
                    className="mt-5 flex flex-wrap items-center gap-2"
                  >
                    {cursor ? (
                      <Link
                        href={`/${locale}/account/reviews`}
                        className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                      >
                        {t('firstPage')}
                      </Link>
                    ) : null}
                    {mine.nextCursor ? (
                      <Link
                        href={`/${locale}/account/reviews?cursor=${encodeURIComponent(mine.nextCursor)}`}
                        className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                      >
                        {t('loadMore')}
                      </Link>
                    ) : null}
                  </nav>
                ) : null}
              </>
            )}
          </section>
        </div>
      )}
    </AccountShell>
  );
}
