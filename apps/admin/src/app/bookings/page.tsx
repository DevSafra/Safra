import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getBookings, type BookingListItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, dateRange, money } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { OutlineAction, TableToolbar, ToolbarNote } from '@/components/table-toolbar';
import { bookingStatus, fill, t } from '@/lib/strings';
import { oneOf, pageNumber, returnQuery } from '@/lib/search-params';
import { resolvePageSize } from '@/lib/table-size';
import { statusTone } from '@/lib/status-tone';

/**
 * الحجوزات — the bookings registry (design handoff §8).
 *
 * ## Two jobs, one route
 *
 * `?reference=…` redirects to the detail page, which is how the lookup form reaches §9.4 —
 * a GET form cannot target a dynamic segment. Everything else renders the table.
 *
 * ## Why the table exists
 *
 * An earlier version of this file argued that "a browsable index of every booking is a privacy
 * surface with no operational use". That was wrong. The operational question is not only "show
 * me BKG-2026-000431" but "show me everything stuck in قيد التأكيد right now", and a lookup box
 * cannot answer the second one — which is why the design specifies a filterable table.
 *
 * The privacy concern is real and is answered by SCOPE rather than by absence: a row carries a
 * customer's name and nothing else about them. No contact details, no payment instrument, no
 * internal notes. Those live on the detail screen behind their own permissions.
 */
export const dynamic = 'force-dynamic';

/**
 * Below this the table scrolls inside its own box — measured, not chosen.
 *
 * At 1000px the التواريخ column is 125px wide, which fits the widest range `dateRange` produces
 * for a stay inside one year (`28-08 ← 03-09-2026`, 124px), and المبلغ gets 87px for `201.99 USD`
 * at 70px. It was 780px, where التواريخ had 113px and the range printed over the amount — the bug
 * this number exists to prevent.
 *
 * A stay crossing a New Year is 159px and would need 1236px. It is allowed to wrap onto two lines
 * at the arrow instead: 236px of horizontal scroll on every table view, every day of the year, to
 * keep one rare row on one line is the wrong trade. `e2e/table-overflow.spec.ts` holds all of it.
 */
const MIN_WIDTH = 1000;

/** The design's own `grid-template-columns` for this table, verbatim. */
const TEMPLATE = '1.1fr 1.3fr 1fr 1fr .7fr 1fr .8fr';

const STATUSES = [
  'pending_payment',
  'pending_confirmation',
  'confirmed',
  'checked_in',
  'completed',
  'cancelled',
  'disputed',
] as const;

export default async function BookingsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const first = (key: string): string | undefined => {
    const raw = params[key];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value?.trim() || undefined;
  };

  const reference = first('reference')?.toUpperCase();

  // The lookup path, checked first so a reference never falls through into a filtered list.
  if (reference) redirect(`/bookings/${encodeURIComponent(reference)}`);

  const q = first('q');
  // Dropped rather than forwarded if it is not a real status — see `oneOf`.
  const status = oneOf(params['status'], STATUSES);
  const page = pageNumber(first('page'));
  // The URL wins, then this reader's saved size for bookings, then ten — see `resolvePageSize`.
  const size = await resolvePageSize('bookings', first('size'));

  // Carried into every row link, so «رجوع» on the detail screen comes back here.
  const back = returnQuery({ page, size, q, status });

  const [result, counts] = await Promise.all([
    getBookings({ q, status, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.bookings} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/bookings"
          query={q}
          size={size}
          placeholder={t.sections.bookings.searchPlaceholder}
          end={
            result === 'failed' || result === 'unauthenticated' ? null : (
              <>
                <ToolbarNote>
                  {fill(t.sections.bookings.count, { n: count(total(result.counts)) })}
                </ToolbarNote>
                {/*
                  The export carries the CURRENT filters, so what downloads is what is on screen.
                  An export that ignored the filter would have somebody reconcile the wrong set
                  against a bank statement with no way to tell.
                */}
                <OutlineAction href={exportHref({ q, status })} download>
                  {t.table.exportCsv}
                </OutlineAction>
              </>
            )
          }
        >
          {/*
            A `select` inside the form, applied on submit rather than on change. Both filters go
            in one navigation, and the result is a URL somebody can send to a colleague — which
            the prototype's live-filtering input cannot produce.
          */}
          <select
            name="status"
            defaultValue={status ?? ''}
            aria-label={t.table.colStatus}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          >
            <option value="">{t.sections.bookings.allStatuses}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {bookingStatus(value)}
              </option>
            ))}
          </select>
        </TableToolbar>

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={columns(back)}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={MIN_WIDTH}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/bookings"
              section="bookings"
              query={{ q, status }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.bookings.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

/**
 * Built per request rather than as a constant, so every row link carries the reader's place in the
 * list — see `returnQuery`. Opening a booking from page 4 of a filtered search and coming back to
 * the top of an unfiltered registry is the failure this exists to prevent (Bashar, 2026-08-05).
 */
const columns = (back: string): readonly AdminColumn<BookingListItem>[] => [
  {
    key: 'reference',
    header: t.admin.colReference,
    render: (row) => (
      <Link
        href={`/bookings/${row.reference}${back}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'property',
    header: t.admin.colProperty,
    render: (row) => <span className="text-text">{row.property}</span>,
  },
  {
    key: 'customer',
    header: t.admin.colCustomer,
    render: (row) => <span className="text-text2">{row.customer}</span>,
  },
  {
    key: 'dates',
    header: t.table.colDates,
    /*
      Deliberately NOT wrapped in `Ltr`, unlike the reference and the amount.

      `Ltr` forces the run left-to-right, which put the check-IN on the left and left the «←»
      pointing away from the check-out — the arrow said the stay ran backwards. Left to the RTL
      context, the bidirectional algorithm places the first value on the right, so the arrow leads
      from the check-in rightwards-to-leftwards into the check-out, which is how the handoff draws
      it and how the sentence is read.

      No `whitespace-nowrap` either: the range must be allowed to break at its space rather than
      paint over المبلغ when the column is narrow. `dateRange` uses non-breaking hyphens so the
      break can only happen beside the arrow and never inside a date.
    */
    render: (row) => (
      <span className="text-muted">{dateRange(row.checkIn, row.checkOut)}</span>
    ),
  },
  {
    key: 'amount',
    header: t.admin.colAmount,
    render: (row) => (
      <Ltr className="font-bold whitespace-nowrap text-gold">
        {money(row.amount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'status',
    header: t.admin.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>{bookingStatus(row.status)}</StatusPill>
    ),
  },
  {
    key: 'action',
    header: t.table.colAction,
    render: (row) => (
      <Link
        href={`/bookings/${row.reference}${back}`}
        className="text-[11.5px] text-sky hover:underline"
      >
        {t.table.open}
      </Link>
    ),
  },
];

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}

function exportHref(filters: {
  q?: string | undefined;
  status?: string | undefined;
}): string {
  const params = new URLSearchParams();

  if (filters.q) params.set('q', filters.q);
  if (filters.status) params.set('status', filters.status);

  const query = params.toString();

  return `/bookings/export${query ? `?${query}` : ''}`;
}
