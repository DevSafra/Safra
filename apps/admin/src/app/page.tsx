import Link from 'next/link';

import {
  getDashboard,
  getPendingPartners,
  type DashboardOverview,
  type PendingPartner,
} from '@/lib/api';
import { getStaffSession } from '@/lib/session-server';
import { ARABIC_WESTERN_DIGITS } from '@/lib/numerals';
import { AdminSidebar } from '@/components/admin-sidebar';
import { RevenueChart } from '@/components/revenue-chart';
import { SignOutButton } from '@/components/sign-out-button';
import { AR, auditAction, bookingStatus, roleName } from '@/lib/strings';

/**
 * The command center (§9.2), built to the approved design (SAFRA 29.07).
 *
 * Sidebar plus a KPI row, an attention panel, the latest bookings, a revenue sparkline,
 * the partner queue and recent activity. The previous version was a narrow centred column
 * with three counters: same information, none of the shape — and the shape is what makes a
 * dashboard scannable at the start of a shift.
 *
 * ## Nothing here is invented
 *
 * Every figure comes from a column. Where the design asks for something the platform does not
 * record, the UI says so rather than showing a plausible value — a confident zero for a feature
 * that does not exist is the one failure mode a staff dashboard must not have, because somebody
 * would read "no open disputes" and believe it.
 *
 * That rule cost nothing when disputes had no table: the card showed a dash and named the gap. The
 * table landed on 2026-08-04 and the card now shows the real count, which is the same rule pointing
 * the other way. `null` is still rendered as a dash and still means "cannot be determined".
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [overview, partners, session] = await Promise.all([
    getDashboard(),
    getPendingPartners(),
    getStaffSession(),
  ]);

  const loaded = overview !== 'failed' && overview !== 'unauthenticated';

  return (
    <div className="mx-auto grid max-w-[1380px] gap-5 px-6 pt-6 pb-16 lg:grid-cols-[220px_1fr] lg:items-start">
      <AdminSidebar
        counts={
          loaded
            ? {
                bookings: overview.counters.pending_confirmation,
                partners: overview.counters.partners_pending_verification,
                properties: overview.counters.properties_pending_review,
              }
            : {}
        }
      />

      <main className="min-w-0">
        <header className="mb-4 flex flex-wrap items-center gap-3">
          <h1 className="font-[family-name:var(--font-amiri)] text-[28px] leading-tight text-text">
            {AR.admin.title}
          </h1>
          <span className="text-[11.5px] text-faint">
            {today()} · {roleName(session?.user.role)}
          </span>

          <div className="ms-auto flex items-center gap-2">
            {/*
              Emergency Mode (EC-009), reached from the header exactly as the prototype's
              `openEmergency` does. It was a disabled placeholder until the section was built;
              it now navigates, and the destination requires a target, a written reason and a
              confirmation before anything is armed.
            */}
            <Link
              href="/emergency"
              className="cursor-pointer rounded-[9px] border border-[rgba(var(--badA),0.5)] bg-[rgba(var(--badA),0.1)] px-4 py-2 text-xs font-extrabold text-bad transition-colors hover:bg-[rgba(var(--badA),0.18)]"
            >
              {AR.admin.emergencyMode}
            </Link>
            <SignOutButton />
          </div>
        </header>

        {overview === 'unauthenticated' ? (
          <Card>
            <p className="text-sm text-muted">{AR.dashboard.sessionExpired}</p>
          </Card>
        ) : overview === 'failed' ? (
          <Card>
            <p className="text-sm text-bad">{AR.dashboard.countersFailed}</p>
          </Card>
        ) : (
          <Overview overview={overview} partners={partners} />
        )}
      </main>
    </div>
  );
}

function Overview({
  overview,
  partners,
}: {
  overview: DashboardOverview;
  partners: PendingPartner[] | 'unauthenticated' | 'failed';
}) {
  const { counters } = overview;
  const delta = counters.bookings_today - counters.bookings_yesterday;

  return (
    <div className="grid gap-4">
      {/*
        ── KPI row (§9.2) ───────────────────────────────────────────────────
        A labelled region, not a bare div. Several KPI labels are also booking statuses —
        "قيد التأكيد" is both a counter and a pill in the table below — so the row needs to
        be addressable as a unit, both for a screen reader moving by landmark and for a test
        that means "the counter" rather than "any element with that word in it".
      */}
      <section
        aria-label={AR.admin.kpiRow}
        className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3"
      >
        <Kpi
          label={AR.admin.kpiBookingsToday}
          value={count(counters.bookings_today)}
          sub={`${delta < 0 ? '↓' : '↑'} ${count(Math.abs(delta))} ${AR.admin.kpiBookingsTodaySub}`}
        />
        <Kpi
          label={AR.admin.kpiPending}
          value={count(counters.pending_confirmation)}
          valueClass="text-sky"
          sub={`${AR.admin.ofWhich} ${count(counters.sla_expiring_soon)} ${AR.admin.kpiPendingSub}`}
        />
        <Kpi
          label={AR.admin.kpiRevenue}
          value={`$${money(counters.revenue_today_usd)}`}
          valueClass="text-gold"
          sub={`${money(counters.revenue_today_syp)} ل.س`}
        />
        <Kpi
          label={AR.admin.kpiCancelled}
          value={count(counters.cancelled_today)}
          sub={`${AR.admin.ofWhich} ${count(counters.cancelled_today_with_fine)} ${AR.admin.kpiCancelledSub}`}
        />
        {/*
          Real since 2026-08-04, when the disputes table landed. It showed a dash and "the
          feature does not exist" for months, which was the right answer then and would be a lie
          now. `null` still renders a dash — it means "cannot be determined", which is a
          different statement from zero and must never be conflated with it.
        */}
        <Kpi
          label={AR.admin.kpiDisputes}
          value={
            overview.openDisputes === null
              ? AR.admin.noData
              : count(overview.openDisputes)
          }
          valueClass={
            overview.openDisputes === null
              ? 'text-faint'
              : overview.openDisputes > 0
                ? 'text-bad'
                : 'text-text'
          }
          sub={
            overview.openDisputes === null
              ? AR.admin.kpiDisputesUnavailable
              : AR.admin.kpiDisputesSub
          }
        />
      </section>

      <div className="grid gap-4 xl:grid-cols-[1.5fr_1fr] xl:items-start">
        <div className="grid min-w-0 gap-4">
          <Attention counters={counters} />
          <LatestBookings rows={overview.recentBookings} />
        </div>

        <div className="grid min-w-0 gap-4">
          <RevenueChart series={overview.revenue} />
          <PartnerQueue partners={partners} />
          <RecentActivity rows={overview.recentAudit} />
        </div>
      </div>
    </div>
  );
}

/**
 * What needs a human right now.
 *
 * Derived from the counters rather than a separate incident feed, because every row has to
 * be something the platform actually knows. The design shows EC-coded incidents; the ones
 * that exist as data today are the SLA window and the two verification queues. Rows appear
 * only when their count is non-zero, so a quiet console shows an empty panel instead of
 * three reassuring zeroes nobody reads.
 */
function Attention({ counters }: { counters: DashboardOverview['counters'] }) {
  const rows = [
    counters.sla_expiring_soon > 0
      ? {
          code: 'EC-008',
          text: `${count(counters.sla_expiring_soon)} ${AR.admin.attentionSla}`,
          /*
            No destination: §9.4 is a lookup by reference and there is deliberately no
            browsable list of bookings, so there is nowhere to send a reviewer with "the
            twelve expiring soon". The row still belongs here — the count is the alert —
            and the action is dimmed rather than pointed at a screen that redirects back.
          */
          href: undefined,
        }
      : null,
    counters.partners_pending_verification > 0
      ? {
          code: 'P-002',
          text: `${count(counters.partners_pending_verification)} ${AR.admin.attentionPartners}`,
          href: '/partners',
        }
      : null,
    counters.properties_pending_review > 0
      ? {
          code: 'P-002',
          text: `${count(counters.properties_pending_review)} ${AR.admin.attentionProperties}`,
          href: '/properties',
        }
      : null,
  ].filter(
    (row): row is { code: string; text: string; href: string | undefined } =>
      row !== null,
  );

  return (
    <section className="rounded-[15px] border border-[rgba(var(--badA),0.45)] bg-card p-4.5">
      <h2 className="mb-3 text-[14.5px] font-extrabold text-bad">{AR.admin.attention}</h2>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-muted">{AR.admin.attentionEmpty}</p>
      ) : (
        <ul className="grid gap-2.5">
          {rows.map((row) => (
            <li
              key={row.text}
              className="flex flex-wrap items-center gap-2.5 rounded-[10px] border border-line bg-field px-3.5 py-2.5"
            >
              <span
                dir="ltr"
                className="rounded bg-[rgba(var(--badA),0.12)] px-2 py-0.5 text-[10px] font-extrabold text-bad"
              >
                {row.code}
              </span>
              <span className="text-[12.5px] text-text2">{row.text}</span>
              {row.href ? (
                <Link
                  href={row.href}
                  className="ms-auto cursor-pointer rounded-[7px] border border-[rgba(var(--goldA),0.4)] px-3.5 py-1 text-[11.5px] font-bold text-gold transition-colors hover:bg-[rgba(var(--goldA),0.08)]"
                >
                  {AR.admin.handle}
                </Link>
              ) : (
                <span
                  aria-disabled="true"
                  title={AR.nav.notBuilt}
                  className="ms-auto cursor-not-allowed rounded-[7px] border border-line px-3.5 py-1 text-[11.5px] font-bold text-faint/60"
                >
                  {AR.admin.handle}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LatestBookings({ rows }: { rows: DashboardOverview['recentBookings'] }) {
  return (
    <section className="min-w-0 rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="text-[14.5px] font-extrabold text-gold">
          {AR.admin.latestBookings}
        </h2>

        {/*
          Lookup by reference, kept in this panel's header because the five rows below are
          only the most recent — §9.4's screen is reached by the reference a customer reads
          out on the phone, and this is the only route to it. A plain GET form so it works
          without JavaScript; /bookings redirects to the detail page.
        */}
        {/* Input metrics from the handoff §8: field bg, 1px line, 9px radius, 8/14 padding,
            12.5px, min-width 260px. Every admin table carries one. */}
        <form action="/bookings" method="get" className="ms-auto flex gap-2">
          <input
            name="reference"
            placeholder={AR.dashboard.bookingReferencePlaceholder}
            aria-label={AR.dashboard.findBookingLabel}
            dir="ltr"
            className="min-w-[260px] rounded-[9px] border border-line bg-field px-3.5 py-2 text-[12.5px] text-text placeholder:text-faint"
          />
          <button
            type="submit"
            className="cursor-pointer rounded-[9px] border border-line px-3.5 py-2 text-[12.5px] text-muted transition-colors hover:border-[rgba(var(--goldA),0.4)] hover:text-gold"
          >
            {AR.dashboard.findBooking}
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <p className="text-[12.5px] text-faint">{AR.dashboard.nothingWaiting}</p>
      ) : (
        /*
          A real `<table>`, though the design draws a CSS grid. This is tabular data and a
          screen reader needs the row/column relationships that a grid of divs throws away.
          `overflow-x` keeps it usable in a narrow window without the page body scrolling
          sideways.
        */
        <div className="overflow-x-auto">
          <table className="w-full min-w-[540px] border-collapse text-[12.5px]">
            <thead>
              <tr>
                <Th>{AR.admin.colReference}</Th>
                <Th>{AR.admin.colProperty}</Th>
                <Th>{AR.admin.colCustomer}</Th>
                <Th>{AR.admin.colAmount}</Th>
                <Th>{AR.admin.colStatus}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.reference} className="border-t border-line2">
                  <td className="p-2.5">
                    <Link
                      href={`/bookings/${row.reference}`}
                      dir="ltr"
                      className="font-semibold text-sky hover:underline"
                    >
                      {row.reference}
                    </Link>
                  </td>
                  <td className="max-w-[160px] truncate p-2.5 text-text">
                    {row.property}
                  </td>
                  <td className="max-w-[140px] truncate p-2.5 text-text2">
                    {row.customer}
                  </td>
                  <td dir="ltr" className="whitespace-nowrap p-2.5 font-bold text-gold">
                    {money(row.amount)} {row.currency}
                  </td>
                  <td className="p-2.5">
                    <StatusPill status={row.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function PartnerQueue({
  partners,
}: {
  partners: PendingPartner[] | 'unauthenticated' | 'failed';
}) {
  return (
    <section className="rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      <h2 className="mb-3 text-[14.5px] font-extrabold text-gold">
        {AR.admin.pendingPartners}
      </h2>

      {partners === 'failed' ? (
        <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
      ) : partners === 'unauthenticated' ? (
        <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
      ) : partners.length === 0 ? (
        <p className="text-[12.5px] text-faint">{AR.dashboard.nothingWaiting}</p>
      ) : (
        <ul className="grid gap-2.5">
          {/*
            Capped at four. The design shows three; the real queue can hold thousands, and
            a dashboard panel that grows without bound stops being a dashboard. The full
            list lives on /partners.
          */}
          {partners.slice(0, QUEUE_PREVIEW).map((partner) => (
            <li key={partner.reference}>
              <Link
                href={`/partners/${partner.reference}`}
                className="flex items-center gap-2.5 rounded-[10px] border border-line bg-field px-3 py-2.5 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
              >
                <span
                  aria-hidden
                  className="grid size-[34px] shrink-0 place-items-center rounded-[9px] border border-[rgba(var(--goldA),0.3)] bg-[rgba(var(--goldA),0.12)] font-[family-name:var(--font-amiri)] text-base text-gold"
                >
                  ۞
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-bold text-text">
                    {partner.legalName}
                  </span>
                  <span className="block text-[10.5px] text-faint">
                    {partner.reference} · {partner.city.slug}
                  </span>
                </span>
                {/*
                  Screening state in the QUEUE, not only on the detail page. It is the one
                  precondition a reviewer cannot satisfy by reading documents, so seeing it
                  before opening a row is what stops a queue of unscreenable applications
                  building up unnoticed.
                */}
                <span
                  className={`ms-auto shrink-0 text-[10.5px] font-bold ${
                    partner.sanctionsScreenedAt ? 'text-ok' : 'text-warn'
                  }`}
                >
                  {partner.sanctionsScreenedAt
                    ? AR.dashboard.screened
                    : AR.dashboard.notScreened}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-2.5 text-[10.5px] leading-relaxed text-faint">
        {AR.admin.pendingPartnersNote}
      </p>
    </section>
  );
}

function RecentActivity({ rows }: { rows: DashboardOverview['recentAudit'] }) {
  return (
    <section className="rounded-[15px] border border-[rgba(var(--goldA),0.14)] bg-card p-4.5">
      <h2 className="mb-2.5 text-[14.5px] font-extrabold text-gold">
        {AR.admin.recentActivity}
      </h2>

      <div className="grid gap-2 text-[11.5px] leading-relaxed text-muted">
        {rows.map((row) => (
          <p key={`${row.at}-${row.action}`} className="truncate">
            <span dir="ltr" className="text-sky">
              {row.at.slice(0, 16).replace('T', ' ')}
            </span>{' '}
            · {row.actor ?? AR.admin.systemActor} — {auditAction(row.action)}
          </p>
        ))}
      </div>

      <Link
        href="/audit"
        className="mt-3 inline-block cursor-pointer text-[11.5px] text-sky hover:underline"
      >
        {AR.admin.viewAll}
      </Link>
    </section>
  );
}

function Kpi({
  label,
  value,
  sub,
  valueClass = 'text-text',
}: {
  label: string;
  value: string;
  sub: string;
  valueClass?: string;
}) {
  return (
    <div className="rounded-[13px] border border-[rgba(var(--goldA),0.14)] bg-card p-4">
      <p className="text-[11.5px] text-faint">{label}</p>
      <p className={`mt-1.5 text-2xl font-extrabold ${valueClass}`}>{value}</p>
      <p className="mt-1 text-[10.5px] text-muted">{sub}</p>
    </div>
  );
}

/**
 * Booking status as a pill, coloured by what the status MEANS for staff.
 *
 * `pending_confirmation` is purple (`--pend`), not gold — an explicit rule in the design
 * handoff. Gold is SAFRA's affirmative accent, and a booking the customer has paid for that
 * is still waiting on a partner is not good news. `pending_payment` is amber because the
 * platform is waiting on the customer, which is a different kind of waiting and calls for a
 * different action.
 */
function StatusPill({ status }: { status: string }) {
  const tone =
    status === 'completed'
      ? 'border-ok/40 bg-ok/10 text-ok'
      : status === 'cancelled' || status === 'disputed'
        ? 'border-bad/40 bg-bad/10 text-bad'
        : status === 'pending_confirmation'
          ? 'border-pend/40 bg-pend/10 text-pend'
          : status === 'pending_payment'
            ? 'border-warn/40 bg-warn/10 text-warn'
            : 'border-sky/40 bg-sky/10 text-sky';

  return (
    <span
      className={`inline-block whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[10.5px] font-bold ${tone}`}
    >
      {bookingStatus(status)}
    </span>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      scope="col"
      className="border-b border-line p-2.5 text-start text-[11px] font-bold text-faint"
    >
      {children}
    </th>
  );
}

function Card({ children }: { children: React.ReactNode }) {
  return <div className="rounded-[15px] border border-line bg-card p-6">{children}</div>;
}

/** How many queue rows the dashboard previews before deferring to the full section. */
const QUEUE_PREVIEW = 4;

/**
 * Today's date in Arabic, as the design's header shows it.
 *
 * Formatted on the server from the server's clock so it agrees with the counters beside
 * it — a browser-rendered date can disagree across a midnight boundary, and "today's
 * bookings" under yesterday's date is the kind of small inconsistency that costs trust in
 * every other number on the screen.
 */
function today(): string {
  return new Intl.DateTimeFormat(ARABIC_WESTERN_DIGITS, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date());
}

/** Counts, grouped. */
function count(value: number): string {
  return value.toLocaleString(ARABIC_WESTERN_DIGITS);
}

/** Money, two decimals. */
function money(amount: string): string {
  return Number(amount).toLocaleString(ARABIC_WESTERN_DIGITS, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
