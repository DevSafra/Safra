import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { ListMore } from '@/components/list-more';
import { DateRange } from '@/components/date-range';
import { StatusPill, customerBookingStatus } from '@/components/booking-status-pill';
import { DEFAULT_MONEY_CURRENCY, readShown, shownCount } from '@safra/contracts';
import { formatMoney } from '@/lib/localise';
import { getAccountSummary, getMyBookings } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { returnParam } from '@/lib/return-to';
import { localStatus } from '@/lib/status-word';

/**
 * حجوزاتي — every booking, not the first twenty (handoff §6).
 *
 * The list this replaced asked for `?limit=20` and dropped the `nextCursor` the API returned, so a
 * customer with twenty-one bookings could not reach the twenty-first by any route. The cursor is in
 * the URL now, which also makes a page shareable and reload-safe.
 *
 * A cursor moves FORWARD only, so the way back is offered explicitly — the same dead end the partner
 * calendars had: without it, "show more" is a one-way door.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountBookingsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/bookings');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';
  /* How much of the list to show: «عرض المزيد» adds fifteen (see @safra/contracts/show-more). */
  const shown = shownCount(query['shown']);

  const t = await getTranslations('account');
  const bookings = await readShown(
    (limit, after) => getMyBookings(after, limit),
    shown,
    cursor || undefined,
  );

  return (
    <AccountShell
      locale={locale}
      active="bookings"
      summary={summary}
      title={t('navBookings')}
    >
      {bookings === 'failed' ? (
        <p className="text-sm text-bad">{t('loadFailed')}</p>
      ) : bookings === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t('sessionExpired')}</p>
      ) : bookings.items.length === 0 ? (
        <div className="rounded-lg border border-line bg-card p-6 text-center">
          <p className="text-sm text-muted">{t('noBookings')}</p>
          <Link
            href={`/${locale}/search`}
            className="mt-3 inline-block rounded-lg btn-gold px-5 py-2.5 text-sm font-semibold"
          >
            {t('findStay')}
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {bookings.items.map((booking) => {
              /* The three states a customer is shown — see `customerBookingStatus`. */
              const shown = customerBookingStatus(booking.status);

              return (
                <li key={booking.reference}>
                  <Link
                    href={`/${locale}/account/bookings/${booking.reference}?${returnParam('bookings')}`}
                    className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/50"
                  >
                    <span>
                      <span className="block font-mono text-sm text-text">
                        {booking.reference}
                      </span>
                      <span className="block text-xs text-faint">
                        <DateRange
                          from={booking.checkIn}
                          to={booking.checkOut}
                          locale={locale}
                        />{' '}
                        · {t('nights', { count: booking.nights })}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <StatusPill
                        status={shown}
                        label={localStatus('bookingStatus', shown, locale)}
                      />
                      {/* Money, not a bare decimal — see the note on the schema's `currency`. */}
                      <span className="text-sm font-semibold text-gold-read" dir="ltr">
                        {formatMoney(
                          booking.totalAmount,
                          booking.currency?.code ?? DEFAULT_MONEY_CURRENCY,
                          locale,
                        )}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          <ListMore
            path={`/${locale}/account/bookings`}
            cursor={cursor || undefined}
            shown={shown}
            nextCursor={bookings.nextCursor}
            labels={{
              more: t('loadMore'),
              loading: t('loadingMore'),
              first: t('firstPage'),
            }}
          />
        </>
      )}
    </AccountShell>
  );
}
