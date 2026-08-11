import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { DateRange } from '@/components/date-range';
import { StatusPill } from '@/components/booking-status-pill';
import {
  getAccountSummary,
  getMyBookings,
  getMyWallet,
  getPendingReviews,
  type CustomerBooking,
} from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { formatMoney, localisedName } from '@/lib/localise';
import { returnParam } from '@/lib/return-to';
import type { Locale } from '@/i18n/routing';

/**
 * نظرة عامة — the account overview (handoff §6).
 *
 * §6 gives this section the greeting as its title («أهلاً رامي») rather than a section name, which
 * tells you what it is for: the first thing after signing in, answering "what needs me?" before
 * "what did I do". So it carries the next stay, the balance and anything awaiting a review — each a
 * doorway into the section that owns it, not a second copy of that section.
 *
 * Dynamic and never cached: a cached account page is one customer's bookings served to the next.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountOverviewPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested);

  const t = await getTranslations('account');
  const reviews = await getTranslations('reviews');

  /* Three independent reads, issued together — sequentially they would add two round trips. */
  const [summaryRead, bookings, wallet, pendingReviews] = await Promise.all([
    getAccountSummary(),
    getMyBookings(),
    getMyWallet(),
    getPendingReviews(),
  ]);

  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const list = bookings === 'failed' || bookings === 'unauthenticated' ? null : bookings;
  const balance =
    wallet === 'failed' || wallet === 'unauthenticated' ? null : wallet.wallet;
  const pending =
    pendingReviews === 'failed' || pendingReviews === 'unauthenticated'
      ? null
      : pendingReviews;

  /*
    The next stay: the earliest booking whose check-in has not passed and which is still live.

    Derived here rather than asked of the API because the first page of bookings is already loaded —
    and a "next stay" that disagreed with the list underneath it would be worse than none.
  */
  const today = new Date().toISOString().slice(0, 10);
  const nextStay = list?.items
    .filter((b) => b.checkIn >= today && b.status !== 'cancelled')
    .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];

  return (
    <AccountShell
      locale={locale}
      active="overview"
      /*
        §6 titles this section with the greeting rather than a section name. By NAME when there is one:
        that is what the handoff shows («أهلاً رامي»), and the name only became reachable with
        `GET /auth/me/profile` — no session claim carries it. Falls back to a name-free welcome rather
        than greeting an empty string.
      */
      title={
        summary?.fullName
          ? t('greeting', { name: summary.fullName })
          : t('greetingGeneric')
      }
      summary={summary}
    >
      <div className="grid gap-6">
        {/* إقامتك القادمة */}
        <section>
          <h2 className="font-display text-xl text-text">{t('overviewNextStay')}</h2>

          {nextStay ? (
            <BookingRow booking={nextStay} locale={locale} t={t} />
          ) : (
            <p className="mt-3 rounded-lg border border-line bg-card p-4 text-sm text-faint">
              {t('nothingWaiting')}
            </p>
          )}
        </section>

        {/*
          The wallet, as a doorway. The full §6.1 panel lives in محفظتي; repeating it here would be
          two places to change when the design does.
        */}
        {balance ? (
          <section>
            <h2 className="font-display text-xl text-text">{t('walletTitle')}</h2>
            <Link
              href={`/${locale}/account/wallet`}
              className="mt-3 flex flex-wrap items-baseline justify-between gap-3 rounded-card border border-line bg-card p-5 transition-colors hover:border-gold/50"
            >
              <span className="text-sm text-muted">{t('walletCurrentTitle')}</span>
              <span className="font-display text-2xl text-gold" dir="ltr">
                {formatMoney(balance.balance, balance.currencyCode, locale)}
              </span>
            </Link>
          </section>
        ) : null}

        {/*
          قيّم إقامتك — absent entirely when there is nothing to review, rather than an empty box.
          This is an invitation, and an empty invitation is clutter.
        */}
        {pending && pending.length > 0 ? (
          <section>
            <h2 className="font-display text-xl text-text">{reviews('pendingTitle')}</h2>
            <ul className="mt-3 space-y-3">
              {pending.map((stay) => (
                <li key={stay.bookingReference}>
                  <Link
                    href={`/${locale}/review/${stay.bookingReference}?${returnParam('account')}`}
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
                    <span className="text-sm font-semibold text-gold">
                      {reviews('writeReview')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </AccountShell>
  );
}

/** One booking, in the row shape حجوزاتي uses too. */
function BookingRow({
  booking,
  locale,
  t,
}: {
  readonly booking: CustomerBooking;
  readonly locale: Locale;
  readonly t: Awaited<ReturnType<typeof getTranslations<'account'>>>;
}) {
  return (
    <Link
      href={`/${locale}/booking/${booking.reference}?${returnParam('account')}`}
      className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/50"
    >
      <span>
        <span className="block font-mono text-sm text-text">{booking.reference}</span>
        <span className="block text-xs text-faint">
          <DateRange from={booking.checkIn} to={booking.checkOut} locale={locale} /> ·{' '}
          {t('nights', { count: booking.nights })}
        </span>
      </span>
      <span className="flex items-center gap-3">
        <StatusPill
          status={booking.status}
          label={dynamicMessage(t, `status.${booking.status}`, booking.status)}
        />
        <span className="text-sm text-gold" dir="ltr">
          {booking.totalAmount}
        </span>
      </span>
    </Link>
  );
}
