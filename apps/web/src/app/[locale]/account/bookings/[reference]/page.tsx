import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
import { BackLink } from '@/components/back-link';
import { DateRange } from '@/components/date-range';
import { StatusPill, customerBookingStatus } from '@/components/booking-status-pill';
import { getAccountSummary, getMyBooking } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { isBookingReference } from '@/lib/booking-reference';
import { ltrIsolate } from '@/lib/bidi';
import { returnTo } from '@/lib/return-to';

/**
 * One booking, as its customer sees it.
 *
 * ## Why this page exists
 *
 * Every row in حجوزاتي used to link to `/booking/[reference]`, which is the POST-PAYMENT holding
 * page: it looks nothing up by design and always reads «تم الدفع — حجزك قيد التأكيد». So a booking
 * completed last summer and one cancelled in March opened the same screen, saying the same thing
 * (Bashar, 2026-08-18). That page is right for what it is — a guest who has just paid and may have
 * no account stands on it — so this is a second, signed-in screen rather than a change to it.
 *
 * ## Not yours is not found
 *
 * The API scopes `GET /bookings/:reference` to the caller as a WHERE clause and answers 404 for
 * somebody else's booking exactly as it does for one that never existed. This page renders
 * `notFound()` for both, so the two remain indistinguishable — references are sequential, and any
 * difference between the answers is a way to walk them.
 *
 * The shape check runs FIRST, for the reason `booking-reference.ts` records: this page prints the
 * segment back under SAFRA's branding, and an unchecked one turned any URL into a content-injection
 * page on our own domain.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function BookingDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: raw, reference } = await params;
  const { locale } = await requireAccount(raw, 'bookings');

  if (!isBookingReference(reference)) notFound();

  const t = await getTranslations('account');
  const pending = await getTranslations('bookingPending');

  const [summaryRead, booking] = await Promise.all([
    getAccountSummary(),
    getMyBooking(reference),
  ]);

  /* A shell that cannot read the sidebar counters still renders the booking. */
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  if (booking === 'unauthenticated') {
    return (
      <AccountShell
        locale={locale}
        active="bookings"
        title={t('bookingDetailTitle')}
        summary={summary}
      >
        <p className="text-sm text-muted">{t('sessionExpired')}</p>
      </AccountShell>
    );
  }

  /*
    'failed' covers a real fetch failure AND a 404, and they deliberately agree — the same call
    الفواتير makes for the same reason. A page that distinguished "this booking is not yours" from
    "no such booking" would walk the sequential references one 404 at a time; and "could not load,
    please refresh" would invite somebody to retry for ever over a booking that will never load.
  */
  if (booking === 'failed') notFound();

  const shown = customerBookingStatus(booking.status);
  /* The steps and the guarantee describe a wait. Past that, they would describe nothing. */
  const awaiting = shown === 'pending_confirmation';

  const back = returnTo(locale, (await searchParams)['from'], 'bookings');

  return (
    <AccountShell
      locale={locale}
      active="bookings"
      title={t('bookingDetailTitle')}
      summary={summary}
    >
      {/* The shell prints the heading; this row carries the state beside it. */}
      <div className="flex flex-wrap items-center gap-3">
        <StatusPill status={shown} label={dynamicMessage(t, `status.${shown}`, shown)} />
      </div>

      <dl className="mt-6 divide-y divide-line rounded-card border border-line bg-card px-5">
        <Row label={t('bookingReference')}>
          <span className="font-mono">{ltrIsolate(booking.reference)}</span>
        </Row>
        <Row label={t('bookingStay')}>
          <DateRange from={booking.checkIn} to={booking.checkOut} locale={locale} /> ·{' '}
          {t('nights', { count: booking.nights })}
        </Row>
        <Row label={t('bookingGuests')}>
          {t('bookingGuestsValue', {
            adults: String(booking.guestsAdults),
            children: String(booking.guestsChildren ?? 0),
          })}
        </Row>
        <Row label={t('bookingTotal')}>
          <span dir="ltr">{booking.totalAmount}</span>
        </Row>
        <Row label={t('bookingPlaced')}>
          <span dir="ltr">{booking.createdAt.slice(0, 10)}</span>
        </Row>
        {awaiting && booking.confirmationDeadlineAt ? (
          <Row label={t('bookingDeadline')}>
            <span dir="ltr">
              {booking.confirmationDeadlineAt.slice(0, 16).replace('T', ' ')}
            </span>
          </Row>
        ) : null}
      </dl>

      {/*
        The wait, explained — but only while there IS one.

        This copy is `bookingPending`'s, reused rather than re-written: it is the same promise the
        holding page makes, and two wordings of one guarantee are two things to keep in step.
      */}
      {awaiting ? (
        <>
          <ol className="mt-6 space-y-3">
            {[pending('step1'), pending('step2'), pending('step3')].map((step, index) => (
              <li
                key={step}
                className="flex gap-3 rounded-card border border-line bg-card p-4"
              >
                <span
                  aria-hidden
                  className="grid size-7 shrink-0 place-items-center rounded-full border border-gold/40 text-sm text-gold"
                >
                  {index + 1}
                </span>
                <span className="text-sm text-muted">{step}</span>
              </li>
            ))}
          </ol>

          <p className="mt-4 rounded-card border border-ok/30 bg-ok/10 p-4 text-sm text-ok">
            {pending('guarantee')}
          </p>
        </>
      ) : null}

      <div className="mt-8">
        <BackLink href={back} locale={locale} />
      </div>
    </AccountShell>
  );
}

/** One labelled fact. A description list, because that is what these pairs are. */
function Row({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-3">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm text-text">{children}</dd>
    </div>
  );
}
