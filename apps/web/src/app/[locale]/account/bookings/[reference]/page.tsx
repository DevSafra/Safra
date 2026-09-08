import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { confirmationWindowLabel } from '@/lib/operating-rules';

import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';

import { formatMoney } from '@/lib/localise';
import { AccountShell } from '@/components/account-shell';
import { BackLink } from '@/components/back-link';
import { PartnerAds } from '@/components/partner-ads';
import { DateRange } from '@/components/date-range';
import { StatusPill, customerBookingStatus } from '@/components/booking-status-pill';
import { getAccountSummary, getMyBooking } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { isBookingReference } from '@/lib/booking-reference';
import { ltrIsolate } from '@/lib/bidi';
import { localisedName } from '@/lib/localise';
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
  /* The confirmation window as CONFIGURED — never «ساعتان» in the copy (finding 217). */
  const confirmationWindow = await confirmationWindowLabel();

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
  /*
    Nothing has been received yet, and this screen used to say the opposite.

    Read on BKG-2026-450171 while it sat at `pending_payment`: «قيد التأكيد», «الإجمالي المدفوع
    $196.99», «مهلة رد الشريك تنتهي 07:53», and three steps describing SAFRA contacting the partner.
    Four statements, none true — the partner could not see the booking, no money had arrived, and
    07:53 was the customer's OWN payment deadline, after which the sweep cancels the booking and
    releases the dates (EC-001, `system.payment_expired`).

    The console said «تحتاج إجراء» about the same booking on the same data. This is the screen that
    was wrong, and it is the one the person who owes the money reads.
  */
  const unpaid = booking.status === 'pending_payment';

  const query = await searchParams;
  /* `ref` is what lets «رجوع» land on the RECEIPT a reader came from, not on الفواتير. */
  const back = returnTo(locale, query['from'], 'bookings', query['ref']);

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
        <Row label={t('bookingProperty')}>
          {localisedName(booking.property, locale)}
          {' · '}
          <span className="text-muted">{localisedName(booking.unit, locale)}</span>
          {/*
            HOW MANY of that room.

            A booking may hold several identical rooms, and this screen — the one a guest opens to
            check what they paid for — named the type and stopped. The count was written on the
            booking and read by nothing. Shown only above one, because «غرفة واحدة» beside a room
            name is a word that tells nobody anything.
          */}
          {(booking.rooms ?? 1) > 1 ? (
            <>
              {' · '}
              <span className="font-semibold text-gold">
                {t('roomsCount', { count: booking.rooms ?? 1 })}
              </span>
            </>
          ) : null}
        </Row>
        {/*
          Every room TYPE, with its quantity and what it cost.

          The row above names the LEAD type, which is the whole truth for a single-type booking and
          one of several on a mixed one. This is the guest's own record of what they paid for, so a
          basket has to be legible on it — «مزدوجة قياسية × 2 · $288».
        */}
        {booking.lines.length > 1 ? (
          <Row label={t('bookingRoomsHeading')}>
            <ul data-booking-lines className="grid gap-0.5">
              {booking.lines.map((line) => (
                <li key={line.unitId} className="flex flex-wrap gap-x-2">
                  <span className="text-text2">
                    {localisedName(line, locale)} ·{' '}
                    {t('roomsCount', { count: line.rooms })}
                  </span>
                  <span className="tabular-nums text-muted">
                    {formatMoney(
                      line.amount,
                      booking.currency?.code ?? DEFAULT_MONEY_CURRENCY,
                      locale,
                      {
                        exact: true,
                      },
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </Row>
        ) : null}
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
        {/*
          Three labels, because there are three truths and one of them the page cannot know.

          «المطلوب دفعه» while unpaid and «الإجمالي المدفوع» once money is in — one label for both
          called money paid that had not been. The third case is a CANCELLED booking: it may have
          been paid and refunded, or cancelled for non-payment and never paid at all, and this
          payload carries no capture signal to tell them apart. Read on BKG-2026-450171 after the
          EC-001 sweep killed it: «الإجمالي المدفوع $196.99» on a booking cancelled BECAUSE nothing
          was ever paid.

          So a cancelled booking gets the neutral «إجمالي الحجز», which is true either way, and the
          refunds list below says what actually came back when anything did. Naming the state
          precisely would need a captured-at field in the payload — recorded as a follow-up rather
          than guessed at from the status.
        */}
        <Row
          label={t(
            unpaid
              ? 'bookingTotalDue'
              : booking.status === 'cancelled'
                ? 'bookingTotalNeutral'
                : 'bookingTotal',
          )}
        >
          <span dir="ltr">
            {formatMoney(
              booking.totalAmount,
              booking.currency?.code ?? DEFAULT_MONEY_CURRENCY,
              locale,
            )}
          </span>
        </Row>
        {/*
          THE MONEY THAT CAME BACK.

          The platform has issued thousands of refunds and this screen said nothing about any of
          them: not the amount, not when, not whether it had completed. Money moved and the person
          it moved to had no record of it — the same asymmetry the partner's frozen payout had, on
          the other side of the transaction.

          Directly under the total, because that is the figure it modifies. A refund listed at the
          foot of the page, below the wait notice, would be a fact a reader has to go looking for.
        */}
        {booking.refunds.length > 0 ? (
          <Row label={t('refundsHeading')}>
            <ul data-refunds className="grid gap-1.5">
              {booking.refunds.map((refund) => {
                const currency = booking.currency?.code ?? DEFAULT_MONEY_CURRENCY;
                const toWallet = Number(refund.walletAmount) > 0;

                return (
                  <li key={refund.createdAt} className="grid gap-0.5">
                    <span className="font-semibold text-text">
                      {/*
                        `exact`, because this is a figure somebody reconciles against a bank
                        statement. Trimmed it read «أُعيد $330» under «الإجمالي المدفوع $661.99» —
                        two precisions for money on one screen, and the imprecise one is the number
                        a customer will be looking for on their card.
                      */}
                      {toWallet
                        ? t('refundWalletLine', {
                            amount: formatMoney(refund.amount, currency, locale, {
                              exact: true,
                            }),
                            walletAmount: formatMoney(
                              refund.walletAmount,
                              currency,
                              locale,
                              { exact: true },
                            ),
                          })
                        : t('refundLine', {
                            amount: formatMoney(refund.amount, currency, locale, {
                              exact: true,
                            }),
                          })}
                    </span>
                    {/*
                      «قيد التنفيذ» says how long it may take, because that is the question a
                      customer actually has and the reason they would otherwise write to support.
                      A completed one says WHEN, which is what they need to find it on a statement.
                    */}
                    <span className="text-xs text-faint">
                      {refund.completedAt === null
                        ? t('refundPending')
                        : t('refundDone', { date: refund.completedAt.slice(0, 10) })}
                    </span>
                    {/*
                      WHY it was this much — from the cancellation policy, not from somebody's
                      typing. The free-text reason is internal and thousands of them were written
                      before any customer-facing screen read one.
                    */}
                    {refund.percent !== null ? (
                      <span className="text-xs text-faint2">
                        {t('refundPolicy', { percent: refund.percent })}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          </Row>
        ) : null}
        <Row label={t('bookingPlaced')}>
          <span dir="ltr">{booking.createdAt.slice(0, 10)}</span>
        </Row>
        {/*
          ONE column, TWO deadlines, and the label has to say which.

          `confirmation_deadline_at` is the PAYMENT window while a booking is `pending_payment`
          (`BookingCreationService` sets it to `booking.pending_payment_timeout_minutes`) and is
          reset to the partner's confirmation window once payment lands
          (`booking-actions.service.ts`). Labelling it «مهلة رد الشريك» in both states named the
          wrong party for the one deadline that costs the customer their booking.
        */}
        {(awaiting || unpaid) && booking.confirmationDeadlineAt ? (
          <Row label={t(unpaid ? 'bookingPaymentDeadline' : 'bookingDeadline')}>
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
      {/*
        What to DO, on the screen of somebody who still owes money.

        The three steps below describe waiting for a partner; they are correct once SAFRA holds the
        money and describe nothing that is happening before that. So an unpaid booking gets its own
        panel: the reference to quote — derived here rather than carried, since it is
        `SAFRA-<reference>` by construction in `ManualTransferProvider` — and what happens if the
        window closes first.

        `role="status"` and `border-warn`, matching the pill: this is the state the reader has to
        act on, and it is the only thing on the page that asks anything of them.
      */}
      {unpaid ? (
        <section
          role="status"
          className="mt-6 rounded-card border border-warn/40 bg-warn/10 p-5"
        >
          <h2 className="warn-ink text-sm font-bold">{t('unpaidTitle')}</h2>
          <p className="mt-2 text-sm text-muted">{t('unpaidBody')}</p>
        </section>
      ) : null}

      {awaiting ? (
        <>
          <ol className="mt-6 space-y-3">
            {[
              pending('step1', { window: confirmationWindow }),
              pending('step2'),
              pending('step3'),
            ].map((step, index) => (
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

      {/*
        §6.3 step 6 / §6.5 — the voucher, on the screen the customer already opens for this booking.

        Only once the stay is confirmed: before that there is nothing to show a desk, and a voucher
        for a booking the partner has not accepted would be a document that says «مؤكد» about
        something that is not.

        A plain link, not a fetch. The endpoint answers `Content-Disposition: inline`, so a browser
        opens it in a tab and a phone hands it to the PDF viewer — and it works with no JavaScript,
        which is the state the customer is most likely to be in at an airport.

        ## The COLLAPSED state, not a second list of statuses (2026-08-27)

        This read `confirmed || checked_in || completed` — a hand-written list beside the one
        `customerBookingStatus` already keeps, and the two had drifted: that map deliberately treats
        `disputed` as «مؤكد» («a dispute is a complaint about a stay, not a change to whether the
        booking stands»), and this list forgot it. So a guest disputing their room read «مؤكد» on
        this screen and had no voucher — while the API was serving one, its own note saying «a guest
        mid-dispute still has to check in somewhere».

        EC-006 and EC-007 are raised ON ARRIVAL, so that is the ordinary case rather than the edge
        one: the document withdrawn was the one they needed at the desk they were standing at.

        `shown` is the same value the pill renders, so the screen can no longer say «مؤكد» beside a
        withheld voucher. The endpoint keys on `confirmed_at` and remains the control.
      */}
      {shown === 'confirmed' ? (
        <div className="mt-8 rounded-card border border-line bg-card p-4">
          <a
            href={`/${locale}/api/bookings/${encodeURIComponent(booking.reference)}/voucher`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex min-h-10 items-center text-sm font-bold text-gold hover:underline lg:min-h-0"
          >
            {t('voucherOpen')}
          </a>
          <p className="mt-1 text-xs text-muted">{t('voucherHint')}</p>
        </div>
      ) : null}

      {/*
        §9.3 — «موجَّهة حسب مدينة حجز العميل … وتظهر داخل صفحة الحجز».

        BELOW the booking's own facts and the voucher, never above them: this screen exists to
        answer «where am I staying and what do I show at the desk», and an advertisement placed
        before that answer would be selling to somebody who came here for something else.

        The holding page at `/booking/[reference]` deliberately carries none. It performs no lookup
        — a reference alone must never reveal a booking — so it has no city to target by, and
        taking one from the query string would put a caller-chosen parameter behind an impression
        somebody is billed for.

        `booking.city` can legitimately be absent if the API stops sending it; the slot then simply
        does not render.
      */}
      {booking.city ? <PartnerAds citySlug={booking.city.slug} locale={locale} /> : null}

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
