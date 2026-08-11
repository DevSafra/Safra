import Link from 'next/link';

import { PAYOUT_STATUSES } from '@safra/contracts';

import { getJobRuns, getPayoutRegistry, type PayoutItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { statusTone } from '@/lib/status-tone';
import { rowAnchor, returnQuery } from '@/lib/search-params';
import { fill, label, t } from '@/lib/strings';
import { listParamsFor } from '@/lib/table-size';
import { oneOf } from '@/lib/search-params';

/**
 * تحويلات الشركاء — the payout registry (§9.3).
 *
 * ## Why this is not under a twentieth sidebar entry
 *
 * The handoff specifies nineteen console sections and `navigation.spec.ts` sweeps exactly those.
 * Payouts are part of الدفع والفواتير — the handoff's «صرف مستحقات الشركاء» is a permission on that
 * screen, not a section of its own — so this is reached from there rather than from the sidebar.
 *
 * ## What an operator does here
 *
 * Reads. Every action lives on one payout's own page, because releasing money is a decision about
 * a specific transfer and a row in a list is not enough to make it on.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1.1fr 1.3fr 1.1fr .7fr 1fr .9fr 1fr';

export default async function PayoutsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const { q, page, size } = await listParamsFor('payouts', searchParams);

  /*
    An allow-list, not the raw parameter. `?status=` reaches an enum cast in the API, which would
    answer 400 for anything else — and a 400 on a typed filter is an error page where the reader
    expected a table. `oneOf` narrows it to a known value or drops it.
  */
  const status = oneOf(params['status'], PAYOUT_STATUSES);

  const [result, counts, jobs] = await Promise.all([
    getPayoutRegistry({ q, page, limit: size, status }),
    sidebarCounts(),
    getJobRuns(),
  ]);

  /*
    When accrual last ran, stated on the screen where somebody would ask.

    A scheduled job that STOPPED firing is invisible: a throw lands in the log and in the run's
    `error`, but silence lands nowhere. This is the cheapest place for that absence to become
    noticeable to a person — an operator opening this registry to answer "where is my money" sees
    the timestamp before they see the rows.
  */
  const accrual =
    jobs === 'failed' || jobs === 'unauthenticated'
      ? null
      : (jobs.find((run) => run.job === 'payout-accrual') ?? null);

  return (
    <ConsoleShell title={t.sections.payouts.title} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/payouts"
          query={q}
          size={size}
          placeholder={t.sections.payouts.searchPlaceholder}
        >
          <select
            name="status"
            defaultValue={status ?? ''}
            aria-label={t.sections.payouts.colStatus}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          >
            <option value="">{t.sections.payouts.allStatuses}</option>
            {PAYOUT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {label(t.enums.payoutStatus, value)}
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
              columns={columns({ page, size, q, status })}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={880}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/payouts"
              section="payouts"
              query={{ q, status }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>
          {accrual === null
            ? t.sections.payouts.lastAccrualNever
            : accrual.status === 'failed'
              ? fill(t.sections.payouts.lastAccrualFailed, {
                  when: shortDateTime(accrual.startedAt),
                })
              : fill(t.sections.payouts.lastAccrual, {
                  when: shortDateTime(accrual.startedAt),
                  n: String(attachedIn(accrual.detail)),
                })}
        </FootNote>
        <FootNote>{t.sections.payouts.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

/**
 * The columns, built with the reader's list position so «رجوع» returns to it.
 *
 * A function rather than a constant because `returnQuery` needs the current page, size and
 * filters — the standing "opening a row and coming back" rule, whose whole point is that the four
 * fields carried are an ALLOW-LIST rather than whatever the URL happened to hold.
 */
function columns(position: {
  page: number;
  size: number;
  q?: string | undefined;
  status?: string | undefined;
}): readonly AdminColumn<PayoutItem>[] {
  const back = returnQuery(position);

  return [
    {
      key: 'reference',
      header: t.sections.payouts.colReference,
      render: (row) => (
        <Link
          href={`/payouts/${encodeURIComponent(row.reference)}${back}`}
          id={rowAnchor(row.reference)}
          className="scroll-mt-24"
        >
          <Ltr className="font-semibold text-sky">{row.reference}</Ltr>
        </Link>
      ),
    },
    {
      key: 'partner',
      header: t.sections.payouts.colPartner,
      render: (row) => (
        <span className="text-text">{row.partnerName ?? t.admin.noData}</span>
      ),
    },
    {
      key: 'period',
      header: t.sections.payouts.colPeriod,
      render: (row) => (
        <Ltr className="whitespace-nowrap text-[11.5px] text-faint">
          {row.periodStart} ← {row.periodEnd}
        </Ltr>
      ),
    },
    {
      key: 'bookings',
      header: t.sections.payouts.colBookings,
      render: (row) => <Ltr className="text-muted">{row.bookingCount}</Ltr>,
    },
    {
      key: 'net',
      header: t.sections.payouts.colNet,
      render: (row) => (
        <Ltr className="font-extrabold whitespace-nowrap text-gold">
          {amount(row.netAmount, row.currencyCode)}
        </Ltr>
      ),
    },
    {
      key: 'status',
      header: t.sections.payouts.colStatus,
      render: (row) => (
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.payoutStatus, row.status)}
        </StatusPill>
      ),
    },
    {
      key: 'scheduled',
      header: t.sections.payouts.colScheduled,
      /*
        The DATE a transfer is set for, or «—». Deliberately not "the date it was created": a
        column headed «موعد التحويل» showing a creation date is the kind of quiet mislabelling
        somebody plans a bank run around.
      */
      render: (row) => (
        <Ltr className="whitespace-nowrap text-muted">
          {row.scheduledFor ?? row.paidAt?.slice(0, 10) ?? t.admin.noData}
        </Ltr>
      ),
    },
  ];
}

/** How many bookings the last accrual attached, or zero — never a guess presented as a fact. */
function attachedIn(detail: unknown): number {
  if (typeof detail !== 'object' || detail === null || !('attached' in detail)) return 0;

  const { attached } = detail;

  return typeof attached === 'number' ? attached : 0;
}
