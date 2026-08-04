import Link from 'next/link';

import {
  getPendingProperties,
  getPropertyRegistry,
  type PropertyListItem,
} from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { shortDate } from '@/lib/format';
import {
  ConsolePanel,
  ConsoleShell,
  Pager,
  QueueState,
} from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { AR, label } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

/**
 * العقارات (design handoff §8).
 *
 * The registry table, then the P-002 review queue. The registry carries the الشريك column the
 * design specifies, because "which partner owns this listing" is the first question asked about a
 * problem listing and the answer decides who gets called.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1fr 1.5fr .9fr .9fr 1.2fr .7fr 1fr';

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, cursor } = await listParams(searchParams);

  const [registry, pending, counts] = await Promise.all([
    getPropertyRegistry({ q, cursor }),
    getPendingProperties(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell
      title={AR.nav.properties}
      subtitle={AR.properties.subtitle}
      counts={counts}
    >
      <div className="grid gap-4">
        <ConsolePanel title={AR.sections.properties.title}>
          <TableToolbar
            action="/properties"
            query={q}
            placeholder={AR.sections.properties.searchPlaceholder}
          />

          {registry === 'unauthenticated' ? (
            <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
          ) : registry === 'failed' ? (
            <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
          ) : (
            <>
              <AdminTable
                columns={COLUMNS}
                rows={registry.items}
                template={TEMPLATE}
                rowKey={(row) => row.reference}
                minWidth={800}
                empty={AR.table.empty}
              />
              <Pager
                basePath="/properties"
                query={{ q }}
                nextCursor={registry.nextCursor}
              />
            </>
          )}

          <FootNote>{AR.sections.properties.note}</FootNote>
        </ConsolePanel>

        <ConsolePanel title={AR.dashboard.propertiesPending}>
          <QueueState state={pending}>
            {(rows) =>
              rows.map((property) => (
                <li key={property.reference}>
                  <Link
                    href={`/properties/${property.reference}`}
                    className="block rounded-[10px] border border-line bg-field px-3.5 py-3 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
                  >
                    <span className="block truncate text-[13px] font-bold text-text">
                      {property.nameAr}
                    </span>
                    <span className="block text-[11px] text-faint">
                      <Ltr>{property.reference}</Ltr> · {property.city.nameAr} ·{' '}
                      {property.partner.displayName} · {AR.dashboard.submitted}{' '}
                      <Ltr>{shortDate(property.createdAt)}</Ltr>
                    </span>

                    {/*
                      Review notes in the QUEUE. They are the reviewer's own message to the next
                      reviewer — "photos to follow" means do not reject this yet — and a note only
                      visible after opening the row gets read too late.
                    */}
                    {property.reviewNotes ? (
                      <span className="mt-1 block text-[11px] text-warn">
                        {property.reviewNotes}
                      </span>
                    ) : null}
                  </Link>
                </li>
              ))
            }
          </QueueState>
        </ConsolePanel>
      </div>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<PropertyListItem>[] = [
  {
    key: 'reference',
    header: AR.table.colId,
    render: (row) => (
      <Link
        href={`/properties/${row.reference}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'property',
    header: AR.sections.properties.colProperty,
    render: (row) => (
      <span className="block truncate font-semibold text-text">{row.nameAr}</span>
    ),
  },
  {
    key: 'type',
    header: AR.table.colType,
    render: (row) => <span className="text-text2">{row.propertyType}</span>,
  },
  {
    key: 'city',
    header: AR.table.colCity,
    render: (row) => <span className="text-muted">{row.city}</span>,
  },
  {
    key: 'partner',
    header: AR.sections.properties.colPartner,
    render: (row) =>
      row.partnerReference ? (
        <Link
          href={`/partners/${row.partnerReference}`}
          className="block truncate text-text2 hover:text-gold hover:underline"
        >
          {row.partner}
        </Link>
      ) : (
        <span className="text-text2">{row.partner}</span>
      ),
  },
  {
    key: 'status',
    header: AR.table.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>
        {label(AR.enums.propertyStatus, row.status)}
      </StatusPill>
    ),
  },
];

function statusTone(status: string): Tone {
  switch (status) {
    case 'published':
      return 'ok';
    case 'approved':
      return 'sky';
    case 'pending_review':
      return 'warn';
    case 'rejected':
    case 'suspended':
      return 'bad';
    default:
      // `draft` and `archived` — not live, and not waiting on anybody.
      return 'faint';
  }
}
