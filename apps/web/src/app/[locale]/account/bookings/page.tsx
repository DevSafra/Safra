import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { DateRange } from '@/components/date-range';
import { StatusPill, customerBookingStatus } from '@/components/booking-status-pill';
import { getAccountSummary, getMyBookings } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { returnParam } from '@/lib/return-to';

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

  const t = await getTranslations('account');
  const bookings = await getMyBookings(cursor || undefined);

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
                        label={dynamicMessage(t, `status.${shown}`, shown)}
                      />
                      <span className="text-sm text-gold" dir="ltr">
                        {booking.totalAmount}
                      </span>
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>

          {cursor || bookings.nextCursor ? (
            <nav
              aria-label={t('navBookings')}
              className="mt-6 flex flex-wrap items-center gap-2"
            >
              {cursor ? (
                <Link
                  href={`/${locale}/account/bookings`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                >
                  {t('firstPage')}
                </Link>
              ) : null}

              {bookings.nextCursor ? (
                <Link
                  href={`/${locale}/account/bookings?cursor=${encodeURIComponent(bookings.nextCursor)}`}
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
