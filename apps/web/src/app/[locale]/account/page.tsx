import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';

import { SignOutButton } from '@/components/sign-out-button';
import { isLocale } from '@/i18n/routing';
import { getMyBookings, getMyWallet, getMyWalletTransactions } from '@/lib/account';
import { formatMoney } from '@/lib/localise';
import { getSession } from '@/lib/session-server';

/**
 * The customer's account (SRS §2.3, §4).
 *
 * Bookings and the wallet were both built server-side well before anything could
 * reach them — §6.4 has been crediting SLA compensation into wallets since the SLA
 * sweep shipped, with no screen that could show it. This is that screen.
 *
 * Dynamic and never cached: a cached account page is one customer's bookings served
 * to the next.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function AccountPage({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  setRequestLocale(locale);

  const session = await getSession();

  // Middleware already guards this path; the check stays because a page that reads
  // personal data should not depend on a matcher pattern staying correct.
  if (!session)
    redirect(`/${locale}/login?next=${encodeURIComponent(`/${locale}/account`)}`);

  const t = await getTranslations('account');

  /**
   * Three independent reads, issued together. Sequentially they would add two round
   * trips to a page that already has to be dynamic (§3).
   */
  const [bookings, wallet, transactions] = await Promise.all([
    getMyBookings(),
    getMyWallet(),
    getMyWalletTransactions(),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-bold text-gold">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{session.user.email}</p>
        </div>
        <SignOutButton locale={locale} />
      </div>

      {/* ── Wallet (§2.3) ──────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-display text-xl text-text">{t('walletTitle')}</h2>

        {wallet === 'failed' || transactions === 'failed' ? (
          <p className="mt-3 text-sm text-bad">{t('loadFailed')}</p>
        ) : wallet === 'unauthenticated' || transactions === 'unauthenticated' ? (
          <p className="mt-3 text-sm text-muted">{t('sessionExpired')}</p>
        ) : wallet.wallet === null ? (
          /*
           * No wallet is not an error. It is the ordinary state for a customer who
           * has never been compensated, and rendering it as a failure would alarm
           * almost everybody.
           */
          <p className="mt-3 rounded-lg border border-line bg-card p-4 text-sm text-faint">
            {t('walletEmpty')}
          </p>
        ) : (
          <div className="mt-3 rounded-card border border-line bg-card p-5">
            <p className="text-sm text-muted">{t('walletBalance')}</p>
            <p className="mt-1 font-display text-3xl text-gold">
              {formatMoney(wallet.wallet.balance, wallet.wallet.currencyCode, locale)}
            </p>
            <p className="mt-2 text-xs text-faint">{t('walletHint')}</p>

            {/* Already narrowed above: both reads succeeded to reach this branch. */}
            {transactions.items.length > 0 ? (
              <>
                <div className="gold-rule my-4" />
                <h3 className="text-sm text-muted">{t('walletStatement')}</h3>
                <ul className="mt-2 space-y-2 text-sm">
                  {transactions.items.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline justify-between gap-3 border-b border-line/50 pb-2 last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-text">
                          {t(`reason.${entry.reason}`)}
                        </span>
                        <span className="block text-xs text-faint">
                          {entry.createdAt.slice(0, 10)}
                          {entry.bookingReference ? ` · ${entry.bookingReference}` : ''}
                        </span>
                      </span>
                      {/*
                        Signed, because a statement that shows "10.00" for both a
                        credit and a debit is unreadable — the direction is the
                        single most important thing on the line.
                      */}
                      <span
                        className={
                          entry.direction === 'credit'
                            ? 'shrink-0 text-good'
                            : 'shrink-0 text-muted'
                        }
                      >
                        {entry.direction === 'credit' ? '+' : '−'}
                        {formatMoney(
                          entry.amount,
                          wallet.wallet?.currencyCode ?? 'USD',
                          locale,
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        )}
      </section>

      {/* ── Bookings ───────────────────────────────────────────────────────── */}
      <section className="mt-10">
        <h2 className="font-display text-xl text-text">{t('bookingsTitle')}</h2>

        {bookings === 'failed' ? (
          <p className="mt-3 text-sm text-bad">{t('loadFailed')}</p>
        ) : bookings === 'unauthenticated' ? (
          <p className="mt-3 text-sm text-muted">{t('sessionExpired')}</p>
        ) : bookings.items.length === 0 ? (
          <div className="mt-3 rounded-lg border border-line bg-card p-6 text-center">
            <p className="text-sm text-muted">{t('noBookings')}</p>
            <Link
              href={`/${locale}/search`}
              className="mt-3 inline-block rounded-lg bg-gold px-5 py-2.5 text-sm font-semibold text-bg"
            >
              {t('findStay')}
            </Link>
          </div>
        ) : (
          <ul className="mt-3 space-y-3">
            {bookings.items.map((booking) => (
              <li key={booking.reference}>
                <Link
                  href={`/${locale}/booking/${booking.reference}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/50"
                >
                  <span>
                    <span className="block font-mono text-sm text-text">
                      {booking.reference}
                    </span>
                    <span className="block text-xs text-faint">
                      {booking.checkIn} → {booking.checkOut} ·{' '}
                      {t('nights', { count: booking.nights })}
                    </span>
                  </span>
                  <span className="flex items-center gap-3">
                    <StatusPill
                      status={booking.status}
                      label={t(`status.${booking.status}`)}
                    />
                    <span className="text-sm text-gold">{booking.totalAmount}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * Status as a coloured pill.
 *
 * Colour is never the only signal — the label carries the meaning — so the palette
 * is reinforcement for sighted users rather than the information itself (§14.1).
 */
function StatusPill({ status, label }: { status: string; label: string }) {
  const tone =
    status === 'confirmed' || status === 'completed' || status === 'checked_in'
      ? 'border-good/40 bg-good/10 text-good'
      : status === 'cancelled'
        ? 'border-line bg-field text-faint'
        : 'border-sky/40 bg-sky/10 text-sky';

  return (
    <span className={`rounded-full border px-2.5 py-0.5 text-xs ${tone}`}>{label}</span>
  );
}
