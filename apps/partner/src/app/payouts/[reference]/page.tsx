import Link from 'next/link';
import { notFound } from 'next/navigation';

import { statusTone } from '@safra/ui';

import { getMyPayoutBookings, getMyPayouts } from '@/lib/api';
import { requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { amount, count } from '@/lib/format';
import { TONES } from '@/lib/tones';
import { payoutStatus, t } from '@/lib/strings';

/**
 * One payout, and the bookings it is made of.
 *
 * ## Why this reads the LIST rather than a detail endpoint
 *
 * `GET /partner/payouts` is scoped to the signed-in partner and returns their payouts; finding one
 * in it is a filter over a list that is bounded by the partner's own history. Adding a detail route
 * would be a second endpoint enforcing the same scoping rule, and two places that must agree about
 * who may see what is one more than necessary. The covered bookings DO come from their own
 * endpoint, because that is the unbounded part.
 *
 * A reference belonging to another partner simply is not in the list, so it renders as not found —
 * which is also what the API answers if the bookings endpoint is called directly.
 */
export const dynamic = 'force-dynamic';

export default async function PayoutPage({
  params,
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;

  const [profile, payouts, bookings] = await Promise.all([
    requireVerifiedPartner(),
    getMyPayouts(),
    getMyPayoutBookings(reference),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (payouts === 'unauthenticated' || payouts === 'failed') {
    return (
      <Shell title={t.payouts.title} partnerName={name} active="payouts">
        <p className="text-sm text-muted">
          {payouts === 'unauthenticated'
            ? t.dashboard.sessionExpired
            : t.dashboard.loadFailed}
        </p>
      </Shell>
    );
  }

  const payout = payouts.find((row) => row.reference === reference);

  if (!payout) notFound();

  /*
    A failed load is NOT an empty payout.

    This was `Array.isArray(bookings) ? bookings : []`, so a request that failed — an expired
    session, an API restart, a schema the API had stopped satisfying — rendered «لا حجوزات على هذه
    الفترة بعد»: a partner being told with confidence that their transfer covers nothing. Found
    exactly that way on 2026-09-07, when adding a required field to the response made the parse
    fail against a running API that predated it.

    The payout's own total is read from a different endpoint and kept showing the real figure, so
    the screen contradicted itself and the wrong half was the one that mentioned bookings.
  */
  const coveredFailed = bookings === 'failed' || bookings === 'unauthenticated';
  const covered = Array.isArray(bookings) ? bookings : [];

  return (
    <Shell title={t.payouts.title} partnerName={name} active="payouts">
      <div className="grid gap-4">
        <Link
          href="/payouts"
          className="inline-flex min-h-10 w-fit items-center gap-2 rounded-lg border border-line px-3 text-[12.5px] text-muted lg:min-h-0 lg:py-1.5"
        >
          {/* The arrow is its own flex item so `dir="rtl"` places it rather than the bidi algorithm. */}
          <span aria-hidden="true">→</span>
          {t.payouts.back}
        </Link>

        <header className="flex flex-wrap items-center gap-3">
          <Ltr className="text-[15px] font-bold text-sky">{payout.reference}</Ltr>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[statusTone(payout.status)]}`}
          >
            {payoutStatus(payout.status)}
          </span>
        </header>

        <section className="grid gap-2 sm:grid-cols-2">
          <Row
            label={t.payouts.gross}
            value={amount(payout.grossAmount, payout.currencyCode)}
          />
          <Row
            label={t.payouts.fine}
            value={amount(payout.fineAmount, payout.currencyCode)}
          />
          <Row
            label={t.payouts.net}
            value={amount(payout.netAmount, payout.currencyCode)}
            strong
          />
          <Row
            label={t.payouts.colPeriod}
            value={`${payout.periodStart} ← ${payout.periodEnd}`}
          />
          {payout.scheduledFor ? (
            <Row label={t.payouts.scheduledFor} value={payout.scheduledFor} />
          ) : null}
          {payout.paidAt ? (
            <Row label={t.payouts.paidAt} value={payout.paidAt.slice(0, 10)} />
          ) : null}
          {/*
            The bank's reference, shown to the partner deliberately. It is what lets them find the
            transfer on their own statement instead of asking SAFRA to confirm its own claim.
          */}
          {payout.paidReference ? (
            <Row label={t.payouts.paidReference} value={payout.paidReference} />
          ) : null}
          {payout.holdReason ? (
            <Row label={t.payouts.holdReason} value={payout.holdReason} ltr={false} />
          ) : null}
        </section>

        <section>
          <h2 className="mb-2 text-[14px] font-extrabold text-gold">
            {/* No count on a failed load: «(٠)» is the same false claim as «no bookings». */}
            {t.payouts.coveredBookings}
            {coveredFailed ? '' : ` (${count(covered.length)})`}
          </h2>

          {coveredFailed ? (
            <p className="text-[12.5px] text-warn">
              {bookings === 'unauthenticated'
                ? t.dashboard.sessionExpired
                : t.dashboard.loadFailed}
            </p>
          ) : covered.length === 0 ? (
            <p className="text-[12.5px] text-faint">{t.payouts.noBookings}</p>
          ) : (
            <ul className="grid gap-2">
              {/*
                `bg-card`, matching the summary tiles above and the review rows on التقييمات.
                Bashar asked for white on 2026-08-17; `card` IS `#ffffff` in the light theme,
                where `field` is `#f1f3f8` against a `#f5f6fa` page — near enough to vanish into
                it. Not `bg-white`, which would stay white in the dark theme and glare off
                `#0c0a1c`.
              */}
              {covered.map((booking) => (
                <li
                  key={booking.bookingReference}
                  className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-card border border-line bg-card px-3.5 py-3"
                >
                  <Ltr className="text-[12.5px] font-semibold text-sky">
                    {booking.bookingReference}
                  </Ltr>
                  <span className="text-[12px] text-muted">{booking.property ?? ''}</span>
                  <Ltr className="text-[11.5px] text-faint">
                    {booking.checkIn} ← {booking.checkOut}
                  </Ltr>
                  <span className="ms-auto grid justify-items-end gap-0.5">
                    <Ltr className="text-[13px] font-bold text-gold">
                      {amount(booking.amount, payout.currencyCode)}
                    </Ltr>
                    {/*
                      Why this line is worth less than the stay was.

                      Deliberately NOT a colour. Every semantic tone is spoken for on this screen
                      by the payout's own status pill — `pending_release` IS warn and `on_hold` IS
                      orange — so painting an annotation in one of them makes a colour mean two
                      things in one view, which is the thing `statusTone` exists to prevent. And
                      the light theme's warn measures 4.47:1 at this size, under the 4.5 floor,
                      so it would have been unreadable as well as ambiguous.

                      The meaning is carried by POSITION and NOTATION instead: directly under the
                      figure it explains, with a leading minus. The minus sits inside the LTR
                      isolate rather than in the catalogue sentence, because a sign belongs to the
                      number it negates — outside the isolate the bidi algorithm reorders it to
                      the far side of the amount and it reads as a dash between two words.
                    */}
                    {Number(booking.refunded) > 0 ? (
                      <span className="text-[11px] text-muted">
                        <Ltr>−{amount(booking.refunded, payout.currencyCode)}</Ltr>{' '}
                        {t.payouts.refundedToGuest}
                      </span>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/*
          Said once under the table rather than on every reduced line, and only when there is a
          reduced line to explain. The rule itself — a refund takes the partner's share down in
          proportion — is not something a partner can infer from a smaller number.
        */}
        {covered.some((one) => Number(one.refunded) > 0) ? (
          <p className="rounded-lg border border-line bg-field px-3 py-2 text-[11.5px] leading-relaxed text-muted">
            {t.payouts.refundedNote}
          </p>
        ) : null}

        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] leading-relaxed text-faint">
          {t.payouts.readOnly}
        </p>
      </div>
    </Shell>
  );
}

function Row({
  label,
  value,
  strong,
  ltr = true,
}: {
  readonly label: string;
  readonly value: string;
  readonly strong?: boolean;
  readonly ltr?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-card border border-line bg-card px-3.5 py-2.5">
      <span className="text-[11.5px] text-faint">{label}</span>
      <span
        className={`text-[13px] ${strong ? 'font-extrabold text-gold' : 'text-text'}`}
      >
        {ltr ? <Ltr>{value}</Ltr> : value}
      </span>
    </div>
  );
}
