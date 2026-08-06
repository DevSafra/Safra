import Link from 'next/link';

import {
  getPendingProperties,
  getPropertyRegistry,
  type PropertyListItem,
} from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell, QueueState } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t, label } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParams, returnQuery } from '@/lib/search-params';

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
  const { q, page, size } = await listParams(searchParams);

  // Carried into every row link, so «رجوع» on the detail screen comes back here.
  const back = returnQuery({ page, size, q });

  const [registry, pending, counts] = await Promise.all([
    getPropertyRegistry({ q, page, limit: size }),
    getPendingProperties(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell
      title={t.nav.properties}
      subtitle={t.properties.subtitle}
      counts={counts}
    >
      <div className="grid gap-4">
        <ConsolePanel title={t.sections.properties.title}>
          <TableToolbar
            action="/properties"
            query={q}
            size={size}
            placeholder={t.sections.properties.searchPlaceholder}
          />

          {registry === 'unauthenticated' ? (
            <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
          ) : registry === 'failed' ? (
            <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
          ) : (
            <>
              <AdminTable
                columns={columns(back)}
                rows={registry.items}
                template={TEMPLATE}
                rowKey={(row) => row.reference}
                minWidth={1040}
                empty={t.table.empty}
              />
              <TablePagination
                basePath="/properties"
                query={{ q }}
                page={registry.page}
                pages={registry.pages}
                total={registry.total}
                capped={registry.capped}
                size={size}
              />
            </>
          )}

          <FootNote>{t.sections.properties.note}</FootNote>
        </ConsolePanel>

        <ConsolePanel title={t.dashboard.propertiesPending}>
          <QueueState state={pending}>
            {(rows) =>
              rows.map((property) => (
                <li key={property.reference}>
                  <Link
                    href={`/properties/${property.reference}${back}`}
                    className="block rounded-[10px] border border-line bg-field px-3.5 py-3 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
                  >
                    <span className="block truncate text-[13px] font-bold text-text">
                      {property.nameAr}
                    </span>
                    <span className="block text-[11px] text-faint">
                      <Ltr>{property.reference}</Ltr> · {property.city.nameAr} ·{' '}
                      {property.partner.displayName} · {t.dashboard.submitted}{' '}
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

/**
 * Built per request rather than as a constant, so every row link carries the reader's place in the
 * list — see `returnQuery`. Opening a property from page 4 of a filtered search and coming back to
 * the top of an unfiltered registry is the failure this exists to prevent (Bashar, 2026-08-05).
 */
const columns = (back: string): readonly AdminColumn<PropertyListItem>[] => [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => (
      <Link
        href={`/properties/${row.reference}${back}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'property',
    header: t.sections.properties.colProperty,
    render: (row) => (
      <span className="block truncate font-semibold text-text">{row.nameAr}</span>
    ),
  },
  {
    key: 'type',
    header: t.table.colType,
    render: (row) => <span className="text-text2">{row.propertyType}</span>,
  },
  {
    key: 'city',
    header: t.table.colCity,
    render: (row) => <span className="text-muted">{row.city}</span>,
  },
  {
    key: 'partner',
    header: t.sections.properties.colPartner,
    render: (row) =>
      row.partnerReference ? (
        /*
          Carries this registry as the origin, so «رجوع» on the partner comes back to العقارات
          rather than dropping the reader into الشركاء — a list they were never in. Same defect as
          the booking detail's cards (Bashar, 2026-08-06).
        */
        <Link
          href={`/partners/${row.partnerReference}?from=properties`}
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
    header: t.table.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>
        {label(t.enums.propertyStatus, row.status)}
      </StatusPill>
    ),
  },
];
