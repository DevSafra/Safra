import { getExports, type ExportItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { TablePagination } from '@/components/table-pagination';
import { BackLink } from '@/components/back-link';
import { label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParamsFor } from '@/lib/table-size';
import { ExportsRefresh } from '@/components/exports-refresh';
import { refuseSection } from '@/components/section-refusal';

/**
 * الملفات المصدَّرة — collecting a CSV somebody asked for.
 *
 * ## Why this screen exists at all
 *
 * Until BullMQ phase 5 «تصدير CSV» was a link that downloaded a file, capped at 20,000 rows because
 * the file was built inside the request. The build moved to a worker, which removes the cap and
 * makes the export a THING rather than a response: it has a reference, a status, a row count and an
 * expiry. All of that needs somewhere to be read.
 *
 * ## Not a nineteenth sidebar section
 *
 * It lives under `/bookings/exports`, reached from the الحجوزات toolbar. The sidebar is the
 * approved design's eighteen sections in the design's order, and staff learn a spatial habit for
 * where things sit; an export is a step in the booking registry's own workflow rather than a place
 * of its own. Same reasoning as `payouts` and `reviews`, which are registries under other sections.
 *
 * ## The list is scoped by the API, not here
 *
 * An operator sees their OWN requests; somebody with `STAFF_MANAGE` sees everybody's, because a
 * list of who exported which slice of customer data is an oversight surface. That decision is a
 * WHERE clause in `ExportRequestService`, where it cannot be forgotten — this screen renders
 * whatever it is given.
 */
export const dynamic = 'force-dynamic';

const COLUMNS: AdminColumn<ExportItem>[] = [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => <span className="font-mono text-[12px]">{row.reference}</span>,
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>
        {label(t.enums.exportStatus, row.status)}
      </StatusPill>
    ),
  },
  {
    key: 'filters',
    header: t.table.colFilter,
    render: (row) => {
      const parts = Object.entries(row.filters)
        .filter(([, value]) => value)
        .map(([key, value]) => `${key}: ${String(value)}`);

      /* "كل الحجوزات" rather than an empty cell: an unfiltered export is a fact, not a blank. */
      return (
        <span className="text-[12px] text-muted">
          {parts.length > 0 ? parts.join(' · ') : t.sections.exports.filtersNone}
        </span>
      );
    },
  },
  {
    key: 'rows',
    header: t.sections.exports.rows,
    render: (row) => (
      <span className="text-[12px]">
        {row.rowCount === null ? '—' : count(row.rowCount)}
      </span>
    ),
  },
  {
    key: 'requested',
    header: t.sections.exports.requested,
    render: (row) => (
      <span className="text-[12px] text-muted">{shortDateTime(row.createdAt)}</span>
    ),
  },
  {
    key: 'download',
    header: t.table.colFile,
    render: (row) =>
      row.status === 'ready' ? (
        /*
          An anchor, and `min-h-10` below `lg` because `min-height` does nothing to an inline
          element — the 40px touch target the responsive rule requires.
        */
        <a
          href={`/bookings/exports/download/${row.reference}`}
          download
          className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-gold px-3 text-[12px] font-bold text-gold lg:min-h-0 lg:py-1.5"
        >
          {t.sections.exports.download}
        </a>
      ) : (
        <span className="text-[11.5px] text-faint">
          {row.status === 'failed' ? t.sections.exports.failed : '—'}
        </span>
      ),
  },
];

const TEMPLATE = '1fr 0.9fr 1.4fr 0.7fr 1fr 0.9fr';

export default async function ExportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('bookings', t.sections.exports.title);

  if (refused) return refused;

  const { page, size } = await listParamsFor('exports', searchParams);
  const params = await searchParams;
  const failed = params['failed'] === '1';
  /*
    Set by the DOWNLOAD route when the reader could not have the file. A second flag rather than
    reusing `failed`, because the two say different things and suggest different actions — one is
    "ask again", the other is "the file is gone or is not yours".
  */
  const unavailable = params['unavailable'] === '1';

  const [result, counts] = await Promise.all([
    getExports({ page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.sections.exports.title} counts={counts}>
      <ConsolePanel>
        {/*
          `origin: null` — this screen is not opened FROM a row, so there is no position to
          restore. `BackLink` falls back to the plain registry, which is the useful destination.
        */}
        <div className="mb-3">
          <BackLink
            target={{ href: '/bookings', origin: null }}
            section={t.nav.bookings}
          />
        </div>

        {/* The request itself failed — distinct from an export that failed to BUILD. */}
        {failed ? (
          <p role="alert" className="mb-3 text-[12.5px] text-bad">
            {t.sections.exports.requestFailed}
          </p>
        ) : null}

        {/* The COLLECTION failed: expired, missing, or not this reader's to take. */}
        {unavailable ? (
          <p role="alert" className="mb-3 text-[12.5px] text-bad">
            {t.sections.exports.downloadUnavailable}
          </p>
        ) : null}

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            {/*
              Closes the loop the response used to close: the row fills itself in rather than
              waiting for the operator to guess that a reload is needed.
            */}
            <ExportsRefresh
              pending={result.items.some(
                (row) => row.status === 'queued' || row.status === 'running',
              )}
            />

            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={760}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/bookings/exports"
              section="exports"
              query={{}}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />

            <FootNote>{t.sections.exports.note}</FootNote>
            <FootNote>{t.sections.exports.expiry}</FootNote>
          </>
        )}
      </ConsolePanel>
    </ConsoleShell>
  );
}
