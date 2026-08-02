import Link from 'next/link';
import { notFound } from 'next/navigation';

import { getBooking } from '@/lib/api';

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
}: {
  params: Promise<{ reference: string }>;
}) {
  const { reference } = await params;
  const booking = await getBooking(reference);

  if (booking === 'unauthenticated') {
    return (
      <Shell>
        <p className="text-sm text-muted">Your session expired. Sign in again.</p>
      </Shell>
    );
  }

  if (booking === 'failed') notFound();

  return (
    <Shell>
      <header>
        <p className="font-mono text-xs text-faint">{booking.reference}</p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{booking.property.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {booking.stay.checkIn} → {booking.stay.checkOut} · {booking.stay.nights} night
          {booking.stay.nights === 1 ? '' : 's'} · {booking.stay.adults} adult
          {booking.stay.adults === 1 ? '' : 's'}
          {booking.stay.children > 0 ? `, ${booking.stay.children} children` : ''}
        </p>
        <StatusPill status={booking.status} />
      </header>

      {/*
        The three parties, each linking to its own record where one exists. A support
        call rarely stops at the booking — the next question is about the partner or
        the listing — and retyping a reference into another screen is where the wrong
        record gets opened.
      */}
      <section className="grid gap-3 sm:grid-cols-3">
        <Party
          title="Customer"
          name={booking.customer.name}
          reference={booking.customer.reference}
          lines={[
            booking.customer.email,
            booking.customer.phone,
            booking.customer.isGuest ? 'Booked as a guest' : 'Has an account',
          ]}
        />
        <Party
          title="Partner"
          name={booking.partner.name}
          reference={booking.partner.reference}
          lines={[booking.partner.phone]}
          href={`/partners/${booking.partner.reference}`}
        />
        <Party
          title="Property"
          name={booking.property.name}
          reference={booking.property.reference}
          lines={[booking.property.unit, booking.property.citySlug]}
          href={`/properties/${booking.property.reference}`}
        />
      </section>

      {/* ── The clock (§6.4, EC-001) ──────────────────────────────────────── */}
      <Section title="Dates">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Stamp label="Booked" value={booking.dates.createdAt} />
          <Stamp label="Paid" value={booking.dates.paidAt} />
          {/*
            The confirmation deadline is on the screen even once it has passed. "Was
            the partner actually late?" is the first question in an SLA dispute, and
            hiding a spent deadline makes it unanswerable without the timeline.
          */}
          <Stamp label="Confirmation due" value={booking.dates.confirmationDeadlineAt} />
          <Stamp label="Confirmed" value={booking.dates.confirmedAt} />
          {booking.dates.cancelledAt ? (
            <Stamp label="Cancelled" value={booking.dates.cancelledAt} />
          ) : null}
        </dl>
      </Section>

      {/* ── Money (§13.3) ─────────────────────────────────────────────────── */}
      <Section title="Money">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <Amount
            label="Base"
            value={booking.money.baseAmount}
            currency={booking.money.currencyCode}
          />
          <Amount
            label="Service fee"
            value={booking.money.customerFeeAmount}
            currency={booking.money.currencyCode}
          />
          {booking.money.walletAmount !== '0.00' ? (
            <Amount
              label="Paid from wallet"
              value={booking.money.walletAmount}
              currency={booking.money.currencyCode}
            />
          ) : null}
          <Amount
            label="Customer total"
            value={booking.money.totalAmount}
            currency={booking.money.currencyCode}
          />
          <Amount
            label="Partner commission"
            value={booking.money.partnerCommissionAmount}
            currency={booking.money.currencyCode}
          />
          <Amount
            label="Partner payable"
            value={booking.money.partnerPayableAmount}
            currency={booking.money.currencyCode}
          />
        </dl>
        {/*
          The SYP figure and its rate, shown together. §1.4 makes SYP the accounting
          currency, and a total with no rate beside it cannot be reconciled against
          the books months later.
        */}
        <p className="mt-3 text-xs text-faint">
          {booking.money.totalSyp} SYP at a rate of {booking.money.fxRateToSyp},
          snapshotted when the booking was made.
        </p>
      </Section>

      {/* ── Payments, finance only (§4, §7.2) ─────────────────────────────── */}
      {booking.payments ? (
        <Section title="Payments">
          {booking.payments.attempts.length === 0 ? (
            <p className="text-sm text-faint">No payment attempts.</p>
          ) : (
            <ul className="grid gap-2 text-sm">
              {booking.payments.attempts.map((attempt) => (
                <li
                  key={attempt.reference}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-card px-4 py-3"
                >
                  <span className="font-mono text-xs text-faint">
                    {attempt.reference}
                  </span>
                  <span className="text-text">
                    {attempt.amount} {booking.money.currencyCode}
                  </span>
                  <span className="text-xs text-muted">
                    {attempt.method} via {attempt.provider} · {attempt.status}
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
                    Refunded {refund.amount} {booking.money.currencyCode}
                    {refund.walletAmount !== '0.00'
                      ? ` (${refund.walletAmount} to wallet)`
                      : ''}
                  </span>
                  <span className="block text-xs text-faint">
                    {refund.status} · {refund.reason}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Section>
      ) : null}

      {/* ── The timeline (§9.4) ───────────────────────────────────────────── */}
      <Section title="Timeline">
        {booking.timeline.length === 0 ? (
          <p className="text-sm text-faint">Nothing recorded yet.</p>
        ) : (
          <ol className="grid gap-2">
            {booking.timeline.map((event) => (
              <li
                key={`${event.eventType}-${event.createdAt}`}
                className="rounded-lg border border-line bg-card px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm text-text">
                    {event.eventType.replace(/[._]/g, ' ')}
                  </span>
                  <span className="text-xs text-faint">
                    {event.createdAt.slice(0, 19).replace('T', ' ')} UTC
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-muted">
                  by {event.actorEmail ?? event.actorType}
                </p>
                {/*
                  The payload verbatim. A timeline that summarises loses the detail a
                  dispute turns on — which fine was applied, which occurrence number.
                */}
                {event.payload && Object.keys(event.payload).length > 0 ? (
                  <pre className="mt-2 overflow-x-auto rounded border border-line bg-field p-2 text-xs text-faint">
                    {JSON.stringify(event.payload)}
                  </pre>
                ) : null}
              </li>
            ))}
          </ol>
        )}
      </Section>

      {booking.cancellationReason ? (
        <Section title="Cancellation">
          <p className="rounded-lg border border-line bg-card p-4 text-sm text-muted">
            {booking.cancellationReason}
          </p>
        </Section>
      ) : null}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <Link href="/" className="text-sm text-muted hover:text-gold">
        ← Queues
      </Link>
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
  lines: string[];
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

function Amount({
  label,
  value,
  currency,
}: {
  label: string;
  value: string;
  currency: string;
}) {
  return (
    <div className="flex justify-between rounded-lg border border-line bg-card px-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className="text-text">
        {value} {currency}
      </dd>
    </div>
  );
}

/** A timestamp, or an explicit "not yet" — never a blank cell. */
function Stamp({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex justify-between rounded-lg border border-line bg-card px-4 py-2.5">
      <dt className="text-muted">{label}</dt>
      <dd className={value ? 'text-text' : 'text-faint'}>
        {value ? `${value.slice(0, 19).replace('T', ' ')} UTC` : '—'}
      </dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'confirmed' || status === 'completed' || status === 'checked_in'
      ? 'border-good/40 bg-good/10 text-good'
      : status === 'cancelled' || status === 'disputed'
        ? 'border-bad/40 bg-bad/10 text-bad'
        : 'border-gold/40 bg-gold/10 text-gold';

  return (
    <span className={`mt-3 inline-block rounded-full border px-3 py-1 text-xs ${tone}`}>
      {status.replace(/_/g, ' ')}
    </span>
  );
}
