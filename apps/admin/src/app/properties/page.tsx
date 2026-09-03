import Link from 'next/link';

import {
  getPendingProperties,
  getPropertyRegistry,
  getPropertyTypes,
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
import { PropertyTypes } from '@/components/property-types';
import { fill, label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { returnQuery } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

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
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('properties', t.nav.properties);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('properties', searchParams);
  /* The review queue's own parameters — two paged lists on one route. See /partners. */
  const queue = await listParamsFor('propertiesPending', searchParams);

  // Carried into every row link, so «رجوع» on the detail screen comes back here.
  const back = returnQuery({ page, size, q });

  const [registry, pending, types, counts] = await Promise.all([
    getPropertyRegistry({ q, page, limit: size }),
    getPendingProperties({ page: queue.page, limit: queue.size }),
    /* §8.2's list. Small and bounded by the business — see the note on the panel below. */
    getPropertyTypes(),
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
                section="properties"
                /* The queue's place, as hidden fields — same reasoning as /partners (2026-08-25). */
                query={{
                  q,
                  ...(queue.page > 1 ? { queuePage: String(queue.page) } : {}),
                  queueSize: String(queue.size),
                }}
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
                    className="block rounded-card border border-line bg-field px-3.5 py-3 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
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

          {pending === 'failed' || pending === 'unauthenticated' ? null : (
            <TablePagination
              basePath="/properties"
              section="propertiesPending"
              /* And the registry's place, the other way round. */
              query={{
                q,
                ...(page > 1 ? { page: String(page) } : {}),
                size: String(size),
              }}
              page={pending.page}
              pages={pending.pages}
              total={pending.total}
              capped={pending.capped}
              size={queue.size}
              /* Named — two paged lists on this route too. See /partners. */
              label={fill(t.table.paginationLabelOf, {
                section: t.dashboard.propertiesPending,
              })}
            />
          )}
        </ConsolePanel>

        {/*
          §8.2 — «أنواع أخرى قابلة للإضافة من الإدارة».

          On العقارات rather than in a page of its own: an accommodation type is what a listing IS,
          and this is the screen where somebody is already thinking about listings. It is also the
          smallest thing that satisfies the sentence — a section, not a catalogue-management area.

          NOT paginated, and that is the geography screen's documented exception rather than an
          oversight: the list is bounded by the business at seven, it exists to show the COMPLETE
          set, and a pager over seven rows is worse than seven rows.
        */}
        <ConsolePanel title={t.sections.propertyTypes.title}>
          <p className="mb-3 text-[12.5px] text-muted">
            {t.sections.propertyTypes.intro}
          </p>

          {types === 'unauthenticated' || types === 'failed' ? (
            <p className="text-sm text-bad">{t.sections.panels.failed}</p>
          ) : (
            <PropertyTypes types={types} />
          )}
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
    /*
      The word, not the code. This column printed «rural_house» and «apartment» down an otherwise
      Arabic table (Bashar, 2026-08-14). The API sends `property_types.code` and that is right —
      the code is the stable thing — so the console resolves it here, the same way it resolves
      every other enum it displays.
    */
    render: (row) => (
      <span className="text-text2">{label(t.enums.propertyType, row.propertyType)}</span>
    ),
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
