import Link from 'next/link';

import { getDashboard, type PartnerDashboard, sidebarBadges } from '@/lib/api';
import { BookingDecision } from '@/components/booking-decision';
import { requireVerifiedPartner } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { Ltr } from '@/components/ltr';
import { amount, count } from '@/lib/format';
import { fill, t, violationKind } from '@/lib/strings';

/**
 * لوحة التحكم (design handoff §7.1).
 *
 * Four KPI cards, the pending-request queue with its two-hour clock, a month calendar for one
 * unit, and the alerts panel that carries the payout line.
 *
 * ## Everything here is a fact the platform holds
 *
 * The KPIs are computed from this partner's own bookings; the queue is their unanswered requests;
 * the calendar is their availability with real bookings overlaid; the alerts are recorded
 * violations. Where the platform has nothing to say, the card says «—» rather than «٠» — see the
 * note on `PartnerDashboardService` for why that distinction is load-bearing on a screen about
 * somebody's business.
 *
 * ## The payout line
 *
 * Rendered from a `partner_payouts` ROW or not at all. It never sums what bookings owe into a
 * sentence about a transfer, and «مجدول» and «قيد التجميع» are two different strings so an accrual
 * cannot be read as a dated transfer.
 */
export const dynamic = 'force-dynamic';

export default async function DashboardPage() {
  const [profile, dashboard] = await Promise.all([
    requireVerifiedPartner(),
    getDashboard(),
  ]);
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  return (
    <Shell
      title={t.dashboard.title}
      partnerName={name}
      active="dashboard"
      badges={sidebarBadges(profile)}
    >
      {dashboard === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : dashboard === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : (
        <div className="grid gap-4.5">
          <Kpis kpis={dashboard.kpis} />

          {/*
            1.4fr / 1fr on a wide screen, one column below `lg` — and the REQUEST QUEUE comes
            first in the DOM either way. It is the panel with a two-hour clock on it; a partner
            opening this on a phone must not have to scroll past a calendar to find it.
          */}
          <div className="grid items-start gap-4.5 lg:grid-cols-[1.4fr_1fr]">
            <Requests requests={dashboard.pendingRequests} />

            <div className="grid gap-4.5">
              <Calendar calendar={dashboard.calendar} />
              <Alerts alerts={dashboard.alerts} payout={dashboard.payout} />
            </div>
          </div>
        </div>
      )}
    </Shell>
  );
}

/** The four §7.1 cards: auto-fit, minimum 180px. */
function Kpis({ kpis }: { readonly kpis: PartnerDashboard['kpis'] }) {
  const { earnings, bookings, occupancy, response } = kpis;

  return (
    <section className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-3.5">
      <Kpi
        label={t.dashboard.kpiEarnings}
        value={
          earnings ? (
            <Ltr>{amount(earnings.amount, earnings.currencyCode ?? 'USD')}</Ltr>
          ) : (
            t.dashboard.noData
          )
        }
        tone="text-gold"
        sub={earningsSub(earnings)}
      />

      <Kpi
        label={t.dashboard.kpiBookings}
        value={count(bookings.active)}
        tone="text-text"
        sub={
          bookings.arrivingThisWeek > 0
            ? fill(t.dashboard.kpiBookingsArriving, {
                n: count(bookings.arrivingThisWeek),
              })
            : t.dashboard.kpiBookingsNoneArriving
        }
      />

      <Kpi
        label={t.dashboard.kpiOccupancy}
        value={occupancy ? `${count(occupancy.percent)}٪` : t.dashboard.noData}
        tone="text-text"
        sub={
          occupancy
            ? fill(t.dashboard.kpiOccupancyDetail, {
                booked: count(occupancy.bookedNights),
                available: count(occupancy.availableNights),
              })
            : t.dashboard.noDataYet
        }
      />

      <Kpi
        label={t.dashboard.kpiResponse}
        value={
          response
            ? fill(t.dashboard.kpiResponseMinutes, { n: count(response.medianMinutes) })
            : t.dashboard.noData
        }
        tone="text-ok"
        sub={
          response
            ? fill(t.dashboard.kpiResponseSample, { n: count(response.sampleSize) })
            : t.dashboard.noDataYet
        }
      />
    </section>
  );
}

/**
 * The comparison line under the earnings card.
 *
 * Three separate strings rather than one with a sign, because «↑ ١٢٪» and «↓ ١٢٪» are different
 * sentences in Arabic as in English, and a single template with a `+`/`−` prefix puts a
 * bidi-neutral character at the start of a number on an RTL line — which is the same class of bug
 * that rendered `+963900000001` as `963900000001+`.
 */
function earningsSub(earnings: PartnerDashboard['kpis']['earnings']): string {
  if (!earnings) return t.dashboard.noDataYet;
  if (earnings.changePercent === null) return t.dashboard.kpiEarningsNoCompare;
  if (earnings.changePercent === 0) return t.dashboard.kpiEarningsFlat;

  return earnings.changePercent > 0
    ? fill(t.dashboard.kpiEarningsUp, { percent: count(earnings.changePercent) })
    : fill(t.dashboard.kpiEarningsDown, { percent: count(-earnings.changePercent) });
}

function Kpi({
  label,
  value,
  sub,
  tone,
}: {
  readonly label: string;
  readonly value: React.ReactNode;
  readonly sub: string;
  readonly tone: string;
}) {
  return (
    <div className="rounded-[14px] border border-gold/15 bg-card p-4.5">
      <p className="text-[12px] text-faint">{label}</p>
      <p className={`mt-1.5 text-[26px] font-extrabold ${tone}`}>{value}</p>
      <p className="mt-1 text-[11px] text-ok">{sub}</p>
    </div>
  );
}

/** طلبات حجز بانتظار ردك — §7.1's warn-bordered panel with the SLA badge. */
function Requests({
  requests,
}: {
  readonly requests: PartnerDashboard['pendingRequests'];
}) {
  return (
    <section className="rounded-2xl border border-warn/40 bg-card p-5">
      <div className="flex flex-wrap items-center gap-2.5">
        <h2 className="text-[15px] font-extrabold text-warn">
          {t.dashboard.requestsTitle}
        </h2>
        <span className="rounded-full border border-warn bg-warn/15 px-2.5 py-0.5 text-[11px] font-extrabold text-warn">
          {t.dashboard.requestsRule}
        </span>
      </div>

      {requests.length === 0 ? (
        <p className="mt-3.5 text-[12.5px] text-faint">{t.dashboard.requestsEmpty}</p>
      ) : (
        <ul className="mt-3.5 flex flex-col gap-3">
          {requests.map((request) => (
            <li
              key={request.reference}
              className="rounded-xl border border-line bg-field p-3.5"
            >
              <div className="flex flex-wrap items-center gap-3">
                <div className="min-w-0">
                  {/* A reference is a Latin run on an Arabic line. */}
                  <p className="text-[14px] font-bold text-sky">
                    <Ltr>{request.reference}</Ltr>
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-muted">
                    {request.unitName} · {request.checkIn} ← {request.checkOut} ·{' '}
                    {fill(t.dashboard.requestsNights, { n: count(request.nights) })} ·{' '}
                    {fill(t.dashboard.requestsGuests, { n: count(request.guests) })}
                  </p>
                </div>

                <div className="ms-auto text-end">
                  <p className="text-[15px] font-extrabold text-gold">
                    <Ltr>{amount(request.amount, request.currencyCode)}</Ltr>
                  </p>
                  <p className="text-[11px] font-bold text-warn">
                    <Deadline at={request.deadlineAt} />
                  </p>
                </div>
              </div>

              <div className="mt-3">
                <BookingDecision reference={request.reference} />
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-[11px] text-faint">{t.dashboard.requestsNote}</p>
    </section>
  );
}

/**
 * How long is left on the two-hour clock.
 *
 * Rendered on the SERVER, as a duration at page-render time rather than a live countdown. A
 * ticking clock would need JavaScript, a timer per row and a re-render every second, and would
 * still be wrong the moment the tab is backgrounded. The page is `force-dynamic`, so a reload is
 * accurate; what a partner needs from this is "an hour and a half" or "hurry", not seconds.
 *
 * A deadline in the past says so rather than showing a negative duration — the sweep has not run
 * yet, which is a real state and worth distinguishing from a comfortable margin.
 */
function Deadline({ at }: { readonly at: string | null }) {
  if (!at) return <>{t.dashboard.requestsNoDeadline}</>;

  const remaining = new Date(at).getTime() - Date.now();

  if (!Number.isFinite(remaining)) return <>{t.dashboard.requestsNoDeadline}</>;
  if (remaining <= 0) return <>{t.dashboard.requestsOverdue}</>;

  const minutes = Math.floor(remaining / 60_000);
  const hours = Math.floor(minutes / 60);
  const clock = `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

  return <>{fill(t.dashboard.requestsLeft, { time: clock })}</>;
}

/** التقويم — this month for one unit, seven columns, with the §7.1 legend and reminder. */
function Calendar({ calendar }: { readonly calendar: PartnerDashboard['calendar'] }) {
  if (!calendar) {
    return (
      <section className="rounded-2xl border border-gold/15 bg-card p-5">
        <p className="text-[12.5px] text-faint">{t.dashboard.calendarNoUnits}</p>
      </section>
    );
  }

  const first = calendar.days[0];
  const monthName = first ? (t.months[new Date(first.date).getUTCMonth()] ?? '') : '';

  return (
    <section className="rounded-2xl border border-gold/15 bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[15px] font-extrabold text-gold">
          {fill(t.dashboard.calendarTitle, { month: monthName })}
        </h2>
        <span className="text-[11px] text-faint">
          {fill(t.dashboard.calendarDefaultPrice, {
            count: count(calendar.unitCount),
            price: amount(calendar.fromPrice, calendar.currencyCode),
          })}
        </span>
      </div>

      {/*
        Seven columns, and the grid is NOT offset to the weekday the month starts on. The handoff
        draws a plain run of squares, and an offset grid needs a weekday header to be readable —
        which the design does not have. A month strip is what is specified. التقويمات, which is where
        the work happens, draws a real weekday-aligned grid.
      */}
      <ol className="mt-3.5 grid grid-cols-7 gap-1.25">
        {calendar.days.map((day) => {
          /*
            The breakdown in a `title` AND an `aria-label`, because the square is too small to carry
            three numbers. As the link's accessible name it also means a screen reader hears which
            day it is about to open rather than a bare numeral repeated thirty-one times.
          */
          const detail = fill(t.dashboard.calendarDayDetail, {
            date: day.date,
            booked: count(day.booked),
            blocked: count(day.blocked),
            available: count(day.available),
          });

          return (
            <li key={day.date} data-day={day.date} data-day-available={day.available}>
              {/*
                Each day OPENS that day (Bashar, 2026-08-10). The dashboard square is a portfolio
                aggregate over every unit, so it cannot itself be edited — there is no single room to
                open or close. It links to التقويمات at this date instead, which is the screen that
                can act on it, with the day marked so the reader lands on it.

                `min-h-10` on top of `aspect-square`: the cells are already past 40px at every width
                the app supports, but the floor is a rule about controls under `lg` rather than an
                observation about this grid, and an anchor needs it stated.
              */}
              <Link
                href={`/calendars?date=${day.date}`}
                /*
                  `prefetch={false}` because there are THIRTY-ONE of these, all in the viewport at
                  once, and each points at a dynamic page that costs a profile read plus a page of
                  calendars to render. Left to the framework's default that is a month's worth of
                  server renders for opening the dashboard. One deliberate navigation is cheap; the
                  speculative version of it is not.
                */
                prefetch={false}
                title={detail}
                aria-label={detail}
                className={`grid aspect-square min-h-10 cursor-pointer place-items-center rounded-[7px] border text-[11px] font-semibold transition-colors hover:border-gold ${portfolioTone(
                  day.available,
                  calendar.unitCount,
                )}`}
              >
                {count(new Date(day.date).getUTCDate())}
              </Link>
            </li>
          );
        })}
      </ol>

      <p className="mt-2.5 text-[10.5px] text-faint2">{t.dashboard.calendarClickHint}</p>

      <div className="mt-3 flex flex-wrap gap-3.5 text-[10.5px] text-faint">
        <Legend tone="text-ok" label={t.dashboard.legendPortfolioFree} />
        <Legend tone="text-warn" label={t.dashboard.legendPortfolioSome} />
        <Legend tone="text-bad" label={t.dashboard.legendPortfolioFull} />
      </div>

      <p className="mt-2.5 rounded-lg border border-dashed border-warn/40 bg-warn/8 px-3 py-2 text-[11px] text-warn">
        {t.dashboard.calendarReminder}
      </p>
    </section>
  );
}

/**
 * How full the portfolio is on one day, as a colour.
 *
 * Three states rather than four: the old map painted a DAY STATUS, which a portfolio does not
 * have — six units can be booked, closed and free on the same date. What a partner reads off this
 * grid is "can anybody still book me today", so that is what the colour answers.
 *
 * A portfolio with no units never reaches here (the section says so in words instead), so the
 * zero-denominator case is not a colour decision.
 */
function portfolioTone(available: number, total: number): string {
  if (available === 0) return 'border-bad/40 bg-bad/12 text-bad';
  if (available < total) return 'border-warn/40 bg-warn/12 text-warn';

  return 'border-ok/30 bg-ok/10 text-ok';
}

function Legend({ tone, label }: { readonly tone: string; readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className={tone} aria-hidden="true">
        ■
      </span>
      {label}
    </span>
  );
}

/** المخالفات والتنبيهات, and the payout line the handoff puts in the same panel. */
function Alerts({
  alerts,
  payout,
}: {
  readonly alerts: PartnerDashboard['alerts'];
  readonly payout: PartnerDashboard['payout'];
}) {
  return (
    <section className="rounded-2xl border border-gold/15 bg-card p-5">
      <h2 className="mb-3 text-[15px] font-extrabold text-gold">
        {t.dashboard.alertsTitle}
      </h2>

      <ul className="flex flex-col gap-2.25 text-[12.5px]">
        {alerts.map((alert) => (
          <li
            key={`${alert.kind}-${alert.createdAt}`}
            className="flex gap-2.5 text-muted"
          >
            <span className="text-bad" aria-hidden="true">
              ●
            </span>
            <span>
              {violationKind(alert.kind)}
              {alert.bookingReference ? (
                <>
                  {' · '}
                  {fill(t.dashboard.alertOnBooking, {
                    reference: alert.bookingReference,
                  })}
                </>
              ) : null}
              {alert.fineAmount ? (
                <>
                  {' · '}
                  {fill(t.dashboard.alertFine, {
                    amount: amount(alert.fineAmount, alert.currencyCode ?? 'USD'),
                  })}
                </>
              ) : null}
            </span>
          </li>
        ))}

        {/*
          The payout line, from a real row or not at all.

          Two strings, not one with a status placeholder: «مجدول» describes a dated transfer and
          «قيد التجميع» an open accrual period, and collapsing them into one template is precisely
          how an accrual would come to be presented to a partner as money on its way.
        */}
        <li className="flex gap-2.5 text-muted">
          <span className={payout ? 'text-ok' : 'text-faint2'} aria-hidden="true">
            ●
          </span>
          <span data-payout-line>
            {!payout
              ? t.dashboard.payoutNone
              : payout.status === 'scheduled' && payout.scheduledFor
                ? fill(t.dashboard.payoutScheduled, {
                    amount: amount(payout.netAmount, payout.currencyCode),
                    date: payout.scheduledFor,
                  })
                : fill(t.dashboard.payoutAccruing, {
                    amount: amount(payout.netAmount, payout.currencyCode),
                  })}
          </span>
        </li>

        {alerts.length === 0 ? (
          <li className="text-faint">{t.dashboard.alertsEmpty}</li>
        ) : null}
      </ul>
    </section>
  );
}
