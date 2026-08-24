import Link from 'next/link';

import { getPartnerApplications, type PartnerApplicationRow } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { shortDateTime } from '@/lib/format';
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
import { label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { oneOf, returnQuery } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

/**
 * طلبات الشراكة — who has asked to join (Bashar, 2026-08-19).
 *
 * ## The nineteenth section, and why it is one
 *
 * The approved design has eighteen, and this is not among them, because until «انضم كشريك» there
 * was nothing to review: a partner either existed or did not. A request is a different object
 * from a partner — no account, no listings, no money — and it has its own queue, its own badge
 * and its own decision. Folding it into الشركاء would have put people who are not partners into
 * the registry of partners.
 *
 * ## One person works this list
 *
 * Accepting a request creates an account and invites somebody onto the platform, which Bashar put
 * with the super admin alone. Operations can READ the queue — they inherit the partner the moment
 * it exists — and the API enforces that split, not this screen.
 */
export const dynamic = 'force-dynamic';

/** The vocabulary — the filter's options and the values a URL may carry, from one list. */
const APPLICATION_STATUSES = ['submitted', 'contacted', 'accepted', 'rejected'] as const;

/** Reference, business, contact, city, type, status, submitted. */
const TEMPLATE = '.9fr 1.4fr 1.1fr .8fr .8fr .8fr .9fr';

export default async function PartnerApplicationsPage({
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
  const refused = await refuseSection('partnerApplications', t.nav.partnerApplications);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('partnerApplications', searchParams);
  const params = await searchParams;
  /*
    Checked against THIS section's vocabulary. An unrecognised status drops to "all" rather than
    reaching the API, whose `.strict()` enum answers 400 — which the console renders as a screen
    with no table, for what is only a stale bookmark.
  */
  const status = oneOf(params['status'], APPLICATION_STATUSES);

  /* Carried into every row link, so «رجوع» on the detail screen comes back to this exact view. */
  const back = returnQuery({ page, size, q, status });

  const [result, counts] = await Promise.all([
    getPartnerApplications({ q, status, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.partnerApplications} counts={counts}>
      <ConsolePanel title={t.sections.partnerApplications.title}>
        <TableToolbar
          action="/applications"
          query={q}
          size={size}
          placeholder={t.sections.partnerApplications.searchPlaceholder}
        >
          <select
            name="status"
            defaultValue={status ?? ''}
            aria-label={t.table.colStatus}
            className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
          >
            <option value="">{t.sections.partnerApplications.allStatuses}</option>
            {APPLICATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {label(t.enums.partnerApplicationStatus, value)}
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
              minWidth={900}
              empty={t.sections.partnerApplications.empty}
            />
            <TablePagination
              basePath="/applications"
              section="partnerApplications"
              query={{ q, status }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.partnerApplications.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

/**
 * Built per request rather than as a constant, so every row link carries the reader's place in the
 * list — see `returnQuery`. Opening a request from page 4 of a filtered search and coming back to
 * the top of an unfiltered queue is the failure this exists to prevent (Bashar, 2026-08-05).
 */
const columns = (back: string): readonly AdminColumn<PartnerApplicationRow>[] => [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => (
      <Link
        href={`/applications/${row.reference}${back}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'business',
    header: t.sections.partnerApplications.colBusiness,
    /*
      Legal name first, trading name below — the same order as الشركاء, and for the same reason:
      the contract and the sanctions check are against the legal entity.
    */
    render: (row) => (
      <span className="min-w-0">
        <span className="block truncate font-semibold text-text">{row.legalName}</span>
        {row.displayName !== row.legalName ? (
          <span className="block truncate text-[10.5px] text-faint">
            {row.displayName}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: 'contact',
    header: t.sections.partnerApplications.colContact,
    /* The person to ring, and the number to ring — step 2 is a phone call. */
    render: (row) => (
      <span className="min-w-0">
        <span className="block truncate text-text2">{row.contactName}</span>
        <span className="block truncate text-[10.5px] text-faint">
          <Ltr>{row.phone}</Ltr>
        </span>
      </span>
    ),
  },
  {
    key: 'city',
    header: t.sections.partnerApplications.colCity,
    render: (row) => <span className="text-muted">{row.cityAr}</span>,
  },
  {
    key: 'type',
    header: t.sections.partnerApplications.colType,
    render: (row) => <span className="text-muted">{row.partnerTypeAr}</span>,
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>
        {label(t.enums.partnerApplicationStatus, row.status)}
      </StatusPill>
    ),
  },
  {
    key: 'submitted',
    header: t.sections.partnerApplications.colSubmitted,
    render: (row) => (
      <span className="text-[11.5px] text-faint">
        <Ltr>{shortDateTime(row.createdAt)}</Ltr>
      </span>
    ),
  },
];
