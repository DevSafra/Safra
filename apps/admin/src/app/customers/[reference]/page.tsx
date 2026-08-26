import type { ReactNode } from 'react';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';

import { getCustomer } from '@/lib/api';
import { Ltr, StatusPill } from '@/components/admin-table';
import { statusTone } from '@/lib/status-tone';
import { BackLink, type BackTarget } from '@/components/back-link';
import { backTarget, returnQuery } from '@/lib/search-params';
import { amount, count, shortDate, shortDateTime } from '@/lib/format';
import { bookingStatus, fill, label, t } from '@/lib/strings';
import { refuseSection } from '@/components/section-refusal';

/**
 * One customer's record — «كل معلوماته وحركاته على النظام» (Bashar, 2026-08-26).
 *
 * ## What this replaces
 *
 * العملاء was a registry with no way in. A support agent who found somebody had to re-search their
 * name in الحجوزات, and there was nowhere at all to see wallet movements, disputes, or what the
 * platform had sent them.
 *
 * ## Every section is bounded and says so
 *
 * The API returns the most recent ten of each with the true total beside it, and every heading
 * prints «أحدث ١٠ من ٤٠٣». A truncated list that does not say it is truncated reads as the whole
 * list, which is worse than not showing it — a reader would conclude a customer has ten bookings.
 *
 * ## Contact details are here because they were already one click away
 *
 * §9.4's booking screen has displayed `customer.email` and `customer.phone` since it was built, so
 * this is the same information behind the same capability. See the service's own note on why this
 * does not weaken EC-010.
 */
export const dynamic = 'force-dynamic';

export default async function CustomerPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /* Before any fetch — `staffFetch` maps 403 to 'unauthenticated'; see the partner screen. */
  const refused = await refuseSection('customers', t.nav.customers);

  if (refused) return refused;

  const { reference } = await params;
  const query = await searchParams;
  const back = backTarget('/customers', query, reference);

  const customer = await getCustomer(reference);

  if (customer === 'unauthenticated') {
    return (
      <Shell reference={reference} back={back}>
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      </Shell>
    );
  }

  /* A customer who is not there and one this reader may not see answer the same. */
  if (customer === 'failed') notFound();

  const c = t.sections.customerDetail;

  return (
    <Shell reference={reference} back={back}>
      <header>
        <p className="text-xs text-faint">
          <Ltr>{customer.reference}</Ltr>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-text">{customer.fullName}</h1>
      </header>

      <Section title={c.identity}>
        <dl className="grid gap-2 sm:grid-cols-2">
          {/* A Latin run isolated as a VALUE, never the label with it. */}
          <Row
            label={c.email}
            value={customer.email ? <Ltr>{customer.email}</Ltr> : <None />}
          />
          <Row
            label={c.phone}
            value={customer.phone ? <Ltr>{customer.phone}</Ltr> : <None />}
          />
          <Row label={c.type} value={customer.isGuest ? c.guest : c.registered} />
          <Row
            label={c.accountStatus}
            value={
              customer.accountStatus === null ? (
                /*
                  A guest has no `users` row at all, which is not the same as an account in an
                  unknown state — said plainly rather than rendered as a blank.
                */
                <span className="text-faint">{c.noAccount}</span>
              ) : (
                <StatusPill tone={statusTone(customer.accountStatus)}>
                  {label(t.enums.userStatus, customer.accountStatus)}
                </StatusPill>
              )
            }
          />
          <Row label={c.joined} value={<Ltr>{shortDate(customer.createdAt)}</Ltr>} />
          <Row
            label={c.wallet}
            value={
              customer.wallet === null ? (
                /* No wallet row at all — a different fact from a zero balance. */
                <span className="text-faint">{c.noWallet}</span>
              ) : (
                <Ltr className="font-bold text-gold">
                  {amount(
                    customer.wallet.balance,
                    customer.wallet.currency ?? DEFAULT_MONEY_CURRENCY,
                  )}
                </Ltr>
              )
            }
          />
        </dl>
      </Section>

      <Bounded title={c.bookings} section={customer.bookings} copy={c}>
        {customer.bookings.items.map((booking) => (
          <Line key={booking.reference}>
            {/*
              Into the booking, carrying where to come back to — «Opening a row and coming back»
              applies to a record's lists as much as to a registry.
            */}
            <Link
              href={`/bookings/${booking.reference}?${returnQuery({})}`}
              className="text-sky hover:underline"
            >
              <Ltr>{booking.reference}</Ltr>
            </Link>
            <span className="min-w-0 flex-1 truncate text-muted">{booking.property}</span>
            <StatusPill tone={statusTone(booking.status)}>
              {bookingStatus(booking.status)}
            </StatusPill>
            {/* The amount never without its currency. */}
            <Ltr className="text-gold">{amount(booking.amount, booking.currency)}</Ltr>
          </Line>
        ))}
      </Bounded>

      <Bounded title={c.walletMoves} section={customer.wallets} copy={c}>
        {customer.wallets.items.map((move, index) => (
          <Line key={`${move.at}-${index}`}>
            <span className="text-muted">{label(t.enums.walletReason, move.reason)}</span>
            <span className="min-w-0 flex-1" />
            <Ltr className={move.direction === 'credit' ? 'text-ok' : 'text-bad'}>
              {/* The sign says which way it went; the currency says what it was. */}
              {`${move.direction === 'credit' ? '+' : '−'}${amount(move.amount, move.currency)}`}
            </Ltr>
            <Ltr className="text-[12px] text-faint">{shortDateTime(move.at)}</Ltr>
          </Line>
        ))}
      </Bounded>

      <Bounded title={c.reviews} section={customer.reviews} copy={c}>
        {customer.reviews.items.map((review, index) => (
          <Line key={`${review.at}-${index}`}>
            <span className="text-text">
              {fill(c.rating, { n: count(review.rating) })}
            </span>
            <span className="min-w-0 flex-1 truncate text-muted">{review.property}</span>
            <Ltr className="text-[12px] text-faint">{shortDate(review.at)}</Ltr>
          </Line>
        ))}
      </Bounded>

      <Bounded title={c.disputes} section={customer.disputes} copy={c}>
        {customer.disputes.items.map((dispute) => (
          <Line key={dispute.reference}>
            {/*
              To the BOOKING, which is where a dispute is worked — there is no `/disputes/:ref`
              route and this linked to one, so every reference here was a dead end. الرسائل's own
              registry has always linked disputes the same way. A dispute with no booking behind it
              is plain text rather than a link to nowhere.
            */}
            {dispute.bookingReference ? (
              <Link
                href={`/bookings/${dispute.bookingReference}?from=customers`}
                className="text-sky hover:underline"
              >
                <Ltr>{dispute.reference}</Ltr>
              </Link>
            ) : (
              <Ltr className="text-text">{dispute.reference}</Ltr>
            )}
            <span className="min-w-0 flex-1 truncate text-muted">
              {label(t.enums.disputeKind, dispute.kind)}
            </span>
            <StatusPill tone={statusTone(dispute.status)}>
              {label(t.enums.disputeStatus, dispute.status)}
            </StatusPill>
            <Ltr className="text-[12px] text-faint">{shortDate(dispute.at)}</Ltr>
          </Line>
        ))}
      </Bounded>

      <Bounded title={c.notifications} section={customer.notifications} copy={c}>
        {customer.notifications.items.map((notice, index) => (
          <Line key={`${notice.at}-${index}`}>
            {/*
              WHAT was sent, in Arabic — «رد على طلب دعم», not `support.replied`.

              `label` falls back to the raw key by design, so a template with no catalogue entry
              looks like the untranslated thing it is rather than being quietly prettified.
            */}
            <span className="font-semibold text-text">
              {label(t.notificationTemplate, notice.templateKey)}
            </span>
            {/*
              The channel as the enum value, matching سجل واتساب والبريد. An enum value is a
              documented exception to the no-hardcoded-text rule, and inventing a second Arabic
              vocabulary for it here would put two names on one thing.
            */}
            <Ltr className="min-w-0 flex-1 truncate text-muted">{notice.channel}</Ltr>
            <StatusPill tone={statusTone(notice.status)}>
              {label(t.enums.notificationStatus, notice.status)}
            </StatusPill>
            <Ltr className="text-[12px] text-faint">{shortDateTime(notice.at)}</Ltr>
          </Line>
        ))}
      </Bounded>
    </Shell>
  );
}

function Shell({
  reference,
  back,
  children,
}: {
  reference: string;
  back: BackTarget;
  children: ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      <BackLink target={back} section={t.nav.customers} />
      <div className="mt-4 grid gap-8" data-customer={reference}>
        {children}
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-3 text-lg text-text">{title}</h2>
      {children}
    </section>
  );
}

/**
 * A section that shows the most recent rows and states how many there are in total.
 *
 * The count is beside the heading rather than at the foot: a reader decides whether to go looking
 * elsewhere from the heading, and a note under ten rows is a note they have already scrolled past.
 */
function Bounded({
  title,
  section,
  copy,
  children,
}: {
  title: string;
  section: { total: number; items: readonly unknown[] };
  copy: { showingRecent: string; none: string };
  children: ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-baseline gap-3">
        <h2 className="text-lg text-text">{title}</h2>
        {section.total > section.items.length ? (
          <span className="text-[12px] text-faint">
            {/* `count()`, so the figures read in Arabic-Indic like every other number here. */}
            {fill(copy.showingRecent, {
              shown: count(section.items.length),
              total: count(section.total),
            })}
          </span>
        ) : null}
      </div>

      {section.total === 0 ? (
        <p className="text-sm text-faint">{copy.none}</p>
      ) : (
        <ul className="grid gap-1.5">{children}</ul>
      )}
    </section>
  );
}

/** One row in a bounded section — wraps rather than scrolling sideways below `lg`. */
function Line({ children }: { children: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-card px-4 py-2.5 text-[13px]">
      {children}
    </li>
  );
}

function Row({ label: rowLabel, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-card px-4 py-3">
      <dt className="text-xs text-faint">{rowLabel}</dt>
      <dd className="mt-0.5 break-words text-text">{value}</dd>
    </div>
  );
}

function None() {
  return <span className="text-faint">{t.admin.noData}</span>;
}
