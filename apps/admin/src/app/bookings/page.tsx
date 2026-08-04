import Link from 'next/link';
import { redirect } from 'next/navigation';

import { getBookings, type BookingListItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, money, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Pager } from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { TableToolbar, ToolbarNote } from '@/components/table-toolbar';
import { AR, bookingStatus } from '@/lib/strings';

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
  const status = first('status');
  const cursor = first('cursor');

  const [result, counts] = await Promise.all([
    getBookings({ q, status, cursor }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={AR.nav.bookings} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/bookings"
          query={q}
          placeholder={AR.sections.bookings.searchPlaceholder}
          end={
            result === 'failed' || result === 'unauthenticated' ? null : (
              <ToolbarNote>
                {AR.sections.bookings.count(count(total(result.counts)))}
              </ToolbarNote>
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
            aria-label={AR.table.colStatus}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          >
            <option value="">{AR.sections.bookings.allStatuses}</option>
            {STATUSES.map((value) => (
              <option key={value} value={value}>
                {bookingStatus(value)}
              </option>
            ))}
          </select>
        </TableToolbar>

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={780}
              empty={AR.table.empty}
            />
            <Pager
              basePath="/bookings"
              query={{ q, status }}
              nextCursor={result.nextCursor}
            />
          </>
        )}

        <FootNote>{AR.sections.bookings.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<BookingListItem>[] = [
  {
    key: 'reference',
    header: AR.admin.colReference,
    render: (row) => (
      <Link
        href={`/bookings/${row.reference}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'property',
    header: AR.admin.colProperty,
    render: (row) => <span className="text-text">{row.property}</span>,
  },
  {
    key: 'customer',
    header: AR.admin.colCustomer,
    render: (row) => <span className="text-text2">{row.customer}</span>,
  },
  {
    key: 'dates',
    header: AR.table.colDates,
    render: (row) => (
      <Ltr className="whitespace-nowrap text-muted">
        {shortDate(row.checkIn)} ← {shortDate(row.checkOut)}
      </Ltr>
    ),
  },
  {
    key: 'amount',
    header: AR.admin.colAmount,
    render: (row) => (
      <Ltr className="font-bold whitespace-nowrap text-gold">
        {money(row.amount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'status',
    header: AR.admin.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>{bookingStatus(row.status)}</StatusPill>
    ),
  },
  {
    key: 'action',
    header: AR.table.colAction,
    render: (row) => (
      <Link
        href={`/bookings/${row.reference}`}
        className="text-[11.5px] text-sky hover:underline"
      >
        {AR.table.open}
      </Link>
    ),
  },
];

/**
 * Status colour, following the handoff's vocabulary exactly.
 *
 * `pending_confirmation` is `--pend` purple — an explicit rule (§1, §14) — because a paid
 * booking still waiting on a partner is not good news and gold would read as if it were.
 * `pending_payment` is amber: there the platform is waiting on the CUSTOMER, which is a
 * different situation calling for a different action.
 */
function statusTone(status: string): Tone {
  switch (status) {
    case 'confirmed':
      return 'ok';
    case 'checked_in':
      return 'sky';
    case 'pending_confirmation':
      return 'pend';
    case 'pending_payment':
      return 'warn';
    case 'cancelled':
    case 'disputed':
      return 'bad';
    default:
      // `completed` and `draft` — done or not started; neither needs attention.
      return 'faint';
  }
}

function total(counts: Record<string, number>): number {
  return Object.values(counts).reduce((sum, value) => sum + value, 0);
}
