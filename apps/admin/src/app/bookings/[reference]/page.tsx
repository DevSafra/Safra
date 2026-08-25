import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getBooking } from '@/lib/api';
import { BackLink, type BackTarget } from '@/components/back-link';
import { Ltr, StatusPill } from '@/components/admin-table';
import { amount, money, rate } from '@/lib/format';
import { backTarget, detailHref, origin } from '@/lib/search-params';
import { statusTone } from '@/lib/status-tone';
import {
  bookingStatus,
  cancellationReason,
  fill,
  label,
  payloadEntries,
  t,
  plural,
} from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';
import { COMPENSATION_CURRENCIES } from '@safra/contracts';
import { readerPermissions } from '@/lib/gate';
import { BookingActions } from '@/components/booking-actions';
import { BookingNotes } from '@/components/booking-notes';

/**
 * One booking, end to end (SRS §9.4).
 *
 * The screen a support agent works from when a customer calls. Everything is here so
 * the answer comes from one place: who booked, which stay, what was charged, and the
 * append-only timeline of what actually happened.
 *
 * The payment section appears only for callers holding `PAYMENT_READ`. §4 gives
 * support agents bookings and disputes but not payment detail, and the API omits the
 * section entirely rather than redacting it — asterisks would still reveal that
 * payments exist and how many.
 */
export const dynamic = 'force-dynamic';

export default async function BookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  /*
    The list position the reader came from, so «رجوع» returns to the page and filter they
    left rather than to the top of the registry (Bashar, 2026-08-05). Absent when the booking was
    reached from a bookmark, the dashboard or the reference lookup — then the link goes to the
    plain registry, which is the right answer for a reader who was never in a list.
  */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('bookings', t.nav.bookings);

  if (refused) return refused;

  const { reference } = await params;
  const query = await searchParams;
  const back = backTarget('/bookings', query, reference);
  /*
    What this reader may DO, as opposed to which section they may open.

    Read alongside the booking rather than after it: two round trips in sequence for two things
    the screen needs together is a wasted one. `booking.cancel` and `booking.update_status` are
    read separately because they ARE separate — §4 gives operations both and neither to support,
    and the API refuses either way. This only decides whether a control that would be refused is
    offered at all.
  */
  const [booking, permissions] = await Promise.all([
    getBooking(reference),
    readerPermissions(),
  ]);

  if (booking === 'unauthenticated') {
    return (
      <Shell back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  if (booking === 'failed') notFound();

  return (
    <Shell back={back}>
      <header>
        <p className="font-mono text-xs text-faint">{booking.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{booking.property.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {booking.stay.children > 0
            ? plural(t.sections.bookingDetail.stayWithChildren, {
                checkIn: booking.stay.checkIn,
                checkOut: booking.stay.checkOut,
                nights: booking.stay.nights,
                adults: booking.stay.adults,
                children: booking.stay.children,
              })
            : plural(t.sections.bookingDetail.stay, {
                checkIn: booking.stay.checkIn,
                checkOut: booking.stay.checkOut,
                nights: booking.stay.nights,
                adults: booking.stay.adults,
              })}
        </p>
        {/*
          The registry's pill, not a second one built here. Both the WORD and the COLOUR come from
          the shared lookups, so the الحجوزات table and this screen cannot disagree about a status
          — they did, in both (Bashar, 2026-08-05): the word was the raw enum and the colour was a
          local three-branch guess that painted «بانتظار الدفع» gold where the table paints it amber.
        */}
        <p className="mt-3">
          <StatusPill tone={statusTone(booking.status)}>
            {bookingStatus(booking.status)}
          </StatusPill>
        </p>
      </header>

      {/*
        The three parties, each linking to its own record where one exists. A support
        call rarely stops at the booking — the next question is about the partner or
        the listing — and retyping a reference into another screen is where the wrong
        record gets opened.
      */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Party
          title={t.sections.bookingDetail.customer}
          name={booking.customer.name}
          reference={booking.customer.reference}
          lines={[
            <Ltr key="email">{booking.customer.email}</Ltr>,
            <Ltr key="phone">{booking.customer.phone}</Ltr>,
            booking.customer.isGuest
              ? t.sections.bookingDetail.bookedAsGuest
              : t.sections.bookingDetail.hasAccount,
          ]}
        />
        <Party
          title={t.sections.bookingDetail.partner}
          name={booking.partner.name}
          reference={booking.partner.reference}
          lines={[<Ltr key="phone">{booking.partner.phone}</Ltr>]}
          href={detailHref(
            '/partners',
            booking.partner.reference,
            origin('bookings', booking.reference),
            query,
          )}
        />
        <Party
          title={t.sections.bookingDetail.property}
          name={booking.property.name}
          reference={booking.property.reference}
          lines={[booking.property.unit, booking.property.city]}
          href={detailHref(
            '/properties',
            booking.property.reference,
            origin('bookings', booking.reference),
            query,
          )}
        />
      </section>

      {/* ── The clock (§6.4, EC-001) ──────────────────────────────────────── */}
      <Section title={t.sections.bookingDetail.dates}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Stamp
            title={t.sections.bookingDetail.booked}
            value={booking.dates.createdAt}
          />
          <Stamp title={t.sections.bookingDetail.paid} value={booking.dates.paidAt} />
          {/*
            The confirmation deadline is on the screen even once it has passed. "Was
            the partner actually late?" is the first question in an SLA dispute, and
            hiding a spent deadline makes it unanswerable without the timeline.
          */}
          <Stamp
            title={t.sections.bookingDetail.confirmationDue}
            value={booking.dates.confirmationDeadlineAt}
          />
          <Stamp
            title={t.sections.bookingDetail.confirmed}
            value={booking.dates.confirmedAt}
          />
          {booking.dates.cancelledAt ? (
            <Stamp
              title={t.sections.bookingDetail.cancelled}
              value={booking.dates.cancelledAt}
            />
          ) : null}
        </dl>
      </Section>

      {/* ── Money (§13.3) ─────────────────────────────────────────────────── */}
      <Section title={t.sections.bookingDetail.money}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Amount
            title={t.sections.bookingDetail.base}
            value={booking.money.baseAmount}
            currency={booking.money.currencyCode}
          />
          <Amount
            title={t.sections.bookingDetail.serviceFee}
            value={booking.money.customerFeeAmount}
            currency={booking.money.currencyCode}
          />
          {booking.money.walletAmount !== '0.00' ? (
            <Amount
              title={t.sections.bookingDetail.paidFromWallet}
              value={booking.money.walletAmount}
              currency={booking.money.currencyCode}
            />
          ) : null}
          <Amount
            title={t.sections.bookingDetail.customerTotal}
            value={booking.money.totalAmount}
            currency={booking.money.currencyCode}
          />
          <Amount
            title={t.sections.bookingDetail.partnerCommission}
            value={booking.money.partnerCommissionAmount}
            currency={booking.money.currencyCode}
          />
          <Amount
            title={t.sections.bookingDetail.partnerPayable}
            value={booking.money.partnerPayableAmount}
            currency={booking.money.currencyCode}
          />
        </dl>
        {/*
          The SYP figure and its rate, shown together. §1.4 makes SYP the accounting
          currency, and a total with no rate beside it cannot be reconciled against
          the books months later.
        */}
        {/*
          Both figures through the formatters. The column types reached the screen raw —
          `2625870.00` ungrouped and `13000.00000000` with the full `numeric(18,8)` tail
          (Bashar, 2026-08-06). `rate()` drops trailing zeros without ROUNDING, because these two
          numbers have to multiply out by hand for the booking to reconcile.
        */}
        <p className="mt-3 text-xs text-faint">
          {fill(t.sections.bookingDetail.fxSnapshot, {
            amount: money(booking.money.totalSyp),
            rate: rate(booking.money.fxRateToSyp),
          })}
        </p>
      </Section>

      {/* ── Payments, finance only (§4, §7.2) ─────────────────────────────── */}
      {booking.payments ? (
        <Section title={t.sections.bookingDetail.payments}>
          {booking.payments.attempts.length === 0 ? (
            <p className="text-sm text-faint">{t.sections.bookingDetail.noPayments}</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {booking.payments.attempts.map((attempt) => (
                <li
                  key={attempt.reference}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-4 py-3"
                >
                  <span className="font-mono text-xs text-faint">
                    <Ltr>{attempt.reference}</Ltr>
                  </span>
                  <span className="text-text">
                    <Ltr>{amount(attempt.amount, booking.money.currencyCode)}</Ltr>
                  </span>
                  {/*
                    All three through the enum maps, which already existed and were simply not
                    read here: the line rendered «simulator · requires_action عبر visa» on an
                    Arabic screen (Bashar, 2026-08-06). Brands keep their names; `simulator` is
                    ours, not a brand.
                  */}
                  <span className="text-xs text-muted">
                    {fill(t.sections.bookingDetail.attemptVia, {
                      method: label(t.enums.paymentMethod, attempt.method),
                      provider: label(t.enums.paymentProvider, attempt.provider),
                      status: label(t.enums.paymentStatus, attempt.status),
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {booking.payments.refunds.length > 0 ? (
            <ul className="mt-3 grid gap-2 text-sm">
              {booking.payments.refunds.map((refund) => (
                <li
                  key={refund.createdAt}
                  className="rounded-lg border border-line bg-card px-4 py-3"
                >
                  <span className="text-text">
                    {refund.walletAmount === '0.00'
                      ? fill(t.sections.bookingDetail.refunded, {
                          amount: money(refund.amount),
                          currency: booking.money.currencyCode,
                        })
                      : fill(t.sections.bookingDetail.refundedToWallet, {
                          amount: money(refund.amount),
                          currency: booking.money.currencyCode,
                          walletAmount: money(refund.walletAmount),
                        })}
                  </span>
                  {/*
                    The status is an enum and is translated; the reason is what a person TYPED
                    when issuing the refund, so it is shown as written. Translating a human's own
                    sentence is not something this console can do, and paraphrasing one on a
                    money record would be worse than leaving it.
                  */}
                  <span className="block text-xs text-faint">
                    {label(t.enums.paymentStatus, refund.status)} · {refund.reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {/* ── The timeline (§9.4) ───────────────────────────────────────────── */}
      <Section title={t.sections.bookingDetail.timeline}>
        {booking.timeline.length === 0 ? (
          <p className="text-sm text-faint">{t.sections.bookingDetail.nothingRecorded}</p>
        ) : (
          <ol className="grid gap-2">
            {booking.timeline.map((event) => (
              <li
                key={`${event.eventType}-${event.createdAt}`}
                className="rounded-lg border border-line bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  {/*
                    The event through the catalogue, not `replace(/[._]/g, ' ')` — that printed the
                    raw key, so the Arabic timeline read «booking payment expired»
                    (Bashar, 2026-08-06). The KEY stays untranslated in the database: it is part of
                    an append-only record, like `audit_log.action`.
                  */}
                  <span className="text-sm text-text">
                    {label(t.enums.timelineEvent, event.eventType)}
                  </span>
                  {/* `Ltr`, or the trailing UTC is reordered to lead: «UTC 21:49:33 2026-08-05». */}
                  <span className="text-xs text-faint">
                    <Ltr>{event.createdAt.slice(0, 19).replace('T', ' ')} UTC</Ltr>
                  </span>
                </div>
                {/*
                  A staff actor is named by EMAIL, which is an identity and stays as written. With
                  no email the actor is a type — `system`, `partner`, `customer` — and that is a
                  word, so it is translated.
                */}
                <p className="mt-0.5 text-xs text-muted">
                  {fill(t.sections.bookingDetail.actorLine, {
                    who: event.actorEmail ?? label(t.enums.actorType, event.actorType),
                  })}
                </p>
                {/*
                  Every payload field, as label and value. A timeline that SUMMARISES loses the
                  detail a dispute turns on — which fine was applied, which occurrence number — so
                  nothing is dropped. But that argues against dropping fields, not for printing
                  `{"reason":"EC-001"}` at a support agent, which is what it did (Bashar,
                  2026-08-06).
                */}
                {payloadEntries(event.payload).length > 0 ? (
                  <dl className="mt-2 grid gap-1 rounded border border-line bg-field p-2 text-xs">
                    {payloadEntries(event.payload).map((entry) => (
                      <div key={entry.key} className="flex flex-wrap gap-x-2">
                        <dt className="text-faint">{entry.label}</dt>
                        <dd className="min-w-0 text-muted">{entry.value}</dd>
                      </div>
                    ))}
                  </dl>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {booking.cancellationReason ? (
        <Section title={t.sections.bookingDetail.cancellation}>
          {/*
            A `system.*` code resolves to Arabic; anything else is what a person typed and is
            shown as written. See the note on `bookings.cancellation_reason`.
          */}
          <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
            {cancellationReason(booking.cancellationReason)}
          </p>
        </Section>
      ) : null}

      {/*
        ── Where the rest of this booking lives ──────────────────────────────

        Links to the sections that already own these records, not an inbox rebuilt here (Bashar,
        2026-08-25). Each registry's search already matches a booking reference — `messaging.ts`
        matches `b.reference` for both conversations and notifications, and النزاعات searches by
        booking too — so the link is the existing screen with this booking as its filter.

        The counts come from the payload and are what makes a link honest: «لا محادثات» is an
        answer, where a link that silently lands on an empty list is not.

        The cross-link used to run one way only. النزاعات has linked to its booking since it was
        built; nothing led back, so an agent on a disputed booking had to go and find it.
      */}
      <Section title={t.sections.bookingDetail.elsewhere}>
        <ul className="grid gap-2 sm:grid-cols-3">
          <Elsewhere
            href={`/disputes?q=${encodeURIComponent(booking.reference)}`}
            section={t.nav.disputes}
            count={plural(t.sections.bookingDetail.relatedDisputes, {
              n: booking.related.disputes,
            })}
          />
          <Elsewhere
            href={`/messages?q=${encodeURIComponent(booking.reference)}`}
            section={t.nav.messages}
            count={plural(t.sections.bookingDetail.relatedConversations, {
              n: booking.related.conversations,
            })}
            /*
              §6.4's «اعرض عقارات مشابهة» lives here rather than on this screen (Bashar,
              2026-08-25): الرسائل already owns a thread, a reply box and the redaction every
              stored message passes through, and a composer here would be a second messaging
              surface to keep in step with it.
            */
            note={t.sections.bookingDetail.sendAlternatives}
          />
          <Elsewhere
            href={`/comms?q=${encodeURIComponent(booking.reference)}`}
            section={t.nav.whatsapp}
            count={plural(t.sections.bookingDetail.relatedNotifications, {
              n: booking.related.notifications,
            })}
          />
        </ul>
      </Section>

      {/*
        Absent, not empty, for a reader without `booking.add_internal_note` — the API omits the
        key rather than sending `[]`, so «لا ملاحظات» is never shown to somebody who simply may
        not see them. The two facts are different and the screen keeps them different.
      */}
      {booking.notes ? (
        <BookingNotes reference={booking.reference} notes={booking.notes} />
      ) : null}

      {/*
        The state's answer AND this reader's, and both have to be true.

        `booking.actions` says what the booking permits, from the API's own transition table;
        `permissions` says what this person may do. Neither is the security boundary — the
        endpoints re-check both — they decide what is worth offering.
      */}
      <BookingActions
        reference={booking.reference}
        available={booking.actions}
        can={{
          cancel: permissions.includes('booking.cancel'),
          /*
            One capability covers confirming, completing and confirming receipt of a transfer —
            all three are `booking.update_status` on the API, because all three are SAFRA moving a
            booking through its own lifecycle. Checking a guest in is `booking.check_in`, the same
            capability the partner's front desk holds, because it is the same act.
          */
          updateStatus: permissions.includes('booking.update_status'),
          checkIn: permissions.includes('booking.check_in'),
          /*
            Three more, and each is a DIFFERENT authority — §4 is explicit that a support agent
            investigates disputes and must escalate a refund to finance. Reading them separately is
            what keeps that true on the screen as well as at the endpoint.
          */
          manageDisputes: permissions.includes('dispute.manage'),
          refund: permissions.includes('refund.create'),
          adjustWallet: permissions.includes('wallet.adjust'),
        }}
        /*
          The booking's own currency first — a compensation for this stay is almost always in the
          money the customer paid — then the rest, so an operator can still credit in SYP.
        */
        currencies={[
          booking.money.currencyCode,
          ...COMPENSATION_CURRENCIES.filter(
            (code) => code !== booking.money.currencyCode,
          ),
        ]}
      />
    </Shell>
  );
}

/**
 * One link out to the section that owns a related record.
 *
 * The COUNT is the second line rather than a badge: it is the thing that decides whether the link
 * is worth following, and a reader scanning three cards reads the section name first.
 */
function Elsewhere({
  href,
  section,
  count,
  note,
}: {
  href: string;
  section: string;
  count: string;
  /** What else this destination is for, where the link answers more than one need. */
  note?: string;
}) {
  return (
    <li>
      {/*
        `min-h-10` and `inline-flex`: an anchor styled as a control is an inline element, and
        `min-height` does nothing to one — the 40px floor below `lg` needs both.
      */}
      <Link
        href={href}
        className="flex min-h-10 flex-col justify-center rounded-lg border border-line bg-card px-4 py-3 hover:border-gold/50 lg:min-h-0"
      >
        <span className="text-sm text-sky">{section}</span>
        <span className="mt-0.5 text-xs text-faint">{count}</span>
        {note ? <span className="mt-0.5 text-xs text-faint2">{note}</span> : null}
      </Link>
    </li>
  );
}

function Shell({ back, children }: { back: BackTarget; children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.bookings} />
      <div className="mt-4 grid gap-8">{children}</div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg text-text">{title}</h2>
      {children}
    </section>
  );
}

function Party({
  title,
  name,
  reference,
  lines,
  href,
}: {
  title: string;
  name: string;
  reference: string;
  /**
   * Nodes rather than strings, so a Latin run can be wrapped in `Ltr`.
   *
   * A phone number is the case that forced it: `+963900000001` rendered as `963900000001+` on an
   * Arabic line, because `+` is bidi-neutral and a neutral leading a digit run gets pushed to the
   * far end (Bashar, 2026-08-06). The number was right and unreadable.
   */
  lines: ReactNode[];
  href?: string;
}) {
  const body = (
    <>
      <p className="text-xs text-faint">{title}</p>
      <p className="mt-0.5 text-sm text-text">{name}</p>
      <p className="font-mono text-xs text-faint">{reference}</p>
      {/*
        Keyed by position, not by content. Two parties can legitimately share a line —
        an empty phone, the same city — and a content key would silently drop one.
      */}
      {lines.map((line, index) => (
        <p key={index} className="text-xs text-muted">
          {line}
        </p>
      ))}
    </>
  );

  return href ? (
    <Link
      href={href}
      className="rounded-lg border border-line bg-card p-4 transition-colors hover:border-gold/50"
    >
      {body}
    </Link>
  ) : (
    <div className="rounded-lg border border-line bg-card p-4">{body}</div>
  );
}

/**
 * One money row.
 *
 * Through `amount()` and `Ltr`, like every other figure in the console. It used to interpolate
 * `{value} {currency}` straight from the API, which meant no thousands separator — a six-figure
 * SYP total read as `2625870.00` — and a trailing ISO code that the bidi algorithm moves to the
 * FRONT of an RTL line, so `201.99 USD` rendered as `USD 201.99` and read as a label.
 */
function Amount({
  title,
  value,
  currency,
}: {
  title: string;
  value: string;
  currency: string;
}) {
  return (
    <div className="flex justify-between rounded-lg border border-line bg-card px-4 py-2.5">
      <dt className="text-muted">{title}</dt>
      <dd className="text-text">
        <Ltr>{amount(value, currency)}</Ltr>
      </dd>
    </div>
  );
}

/** A timestamp, or an explicit "not yet" — never a blank cell. */
function Stamp({ title, value }: { title: string; value: string | null }) {
  return (
    <div className="flex justify-between rounded-lg border border-line bg-card px-4 py-2.5">
      <dt className="text-muted">{title}</dt>
      <dd className={value ? 'text-text' : 'text-faint'}>
        {value ? (
          <Ltr>{`${value.slice(0, 19).replace('T', ' ')} UTC`}</Ltr>
        ) : (
          t.admin.noData
        )}
      </dd>
    </div>
  );
}
