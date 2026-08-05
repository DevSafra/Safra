import Link from 'next/link';

import { getGeography, type Geography } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, money, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { cityCategories, fill, t } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

/**
 * المدن والدول والعملات (design handoff §8).
 *
 * The screen exists because of P-005: launch geography and exchange rates are OPERATIONAL
 * values adjusted by staff, not constants a developer edits and deploys. The handoff says it
 * outright — "أسعار الصرف تُعدَّل من هنا لا من الكود".
 *
 * ## Read-only, and the add buttons say so
 *
 * Adding a country, city or currency has real consequences — a city with no images and no
 * properties would appear in public search — and each needs its own validated form plus an audit
 * entry. The buttons are rendered disabled with the reason instead of wired to nothing.
 *
 * FX rates are the exception: they already have a full write path with audited history on its own
 * screen, so they are DISPLAYED here and edited there. Duplicating the editor would create two
 * ways to change the number that prices every booking.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns` for the cities table, verbatim. */
const TEMPLATE = '1.2fr .9fr 1fr .8fr .9fr';

export default async function GeoPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q } = await listParams(searchParams);

  const [result, counts] = await Promise.all([getGeography(q), sidebarCounts()]);

  return (
    <ConsoleShell title={t.nav.geo} counts={counts}>
      {result === 'unauthenticated' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        </ConsolePanel>
      ) : result === 'failed' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        </ConsolePanel>
      ) : (
        <div className="grid gap-4">
          {/* Two cards side by side, as the design lays them out. */}
          <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
            <Countries rows={result.countries} />
            <Currencies rows={result.currencies} />
          </div>

          <ConsolePanel>
            <div className="mb-3.5 flex flex-wrap items-center gap-2.5">
              <h2 className="text-[14.5px] font-extrabold text-gold">
                {t.sections.geo.cities}
              </h2>
              <div className="ms-auto flex flex-wrap items-center gap-2.5">
                <Disabled>{t.sections.geo.addCity}</Disabled>
              </div>
            </div>

            <TableToolbar
              action="/geo"
              query={q}
              placeholder={t.sections.geo.searchPlaceholder}
            />

            <AdminTable
              columns={CITY_COLUMNS}
              rows={result.cities}
              template={TEMPLATE}
              rowKey={(row) => row.slug}
              minWidth={600}
              empty={t.table.empty}
            />

            <FootNote>{t.sections.geo.citiesNote}</FootNote>
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

function Countries({ rows }: { rows: Geography['countries'] }) {
  return (
    <ConsolePanel>
      <div className="mb-2.5 flex items-center gap-2.5">
        <h2 className="text-[14px] font-extrabold text-gold">
          {t.sections.geo.countries}
        </h2>
        <span className="ms-auto">
          <Disabled>{t.sections.geo.addCountry}</Disabled>
        </span>
      </div>

      <ul className="grid gap-2 text-[12.5px]">
        {rows.map((row) => (
          <li
            key={row.code}
            className="flex flex-wrap items-center gap-2.5 rounded-[9px] border border-line bg-field px-3 py-2.5"
          >
            <span className="font-bold text-text">{row.nameAr}</span>
            <span className="text-[11px] text-faint">
              {row.currencyCode ?? t.admin.noData} ·{' '}
              {fill(t.sections.geo.activeCities, { n: count(row.activeCities) })}
            </span>
            <span
              className={`ms-auto text-[11px] font-bold ${row.isActive ? 'text-ok' : 'text-faint'}`}
            >
              {row.isActive ? t.sections.geo.active : t.sections.geo.inactive}
            </span>
          </li>
        ))}
      </ul>
    </ConsolePanel>
  );
}

function Currencies({ rows }: { rows: Geography['currencies'] }) {
  return (
    <ConsolePanel>
      <div className="mb-2.5 flex items-center gap-2.5">
        <h2 className="text-[14px] font-extrabold text-gold">
          {t.sections.geo.currencies}
        </h2>
        <span className="ms-auto">
          <Disabled>{t.sections.geo.addCurrency}</Disabled>
        </span>
      </div>

      <ul className="grid gap-2 text-[12.5px]">
        {rows.map((row) => (
          <li
            key={row.code}
            className="flex flex-wrap items-center gap-2.5 rounded-[9px] border border-line bg-field px-3 py-2.5"
          >
            <span className="font-bold text-text">
              {row.nameAr} {row.symbol}
            </span>

            {row.isAccounting ? (
              <span className="rounded-full bg-[rgba(var(--goldA),0.14)] px-2.5 py-0.5 text-[10px] font-extrabold text-gold">
                {t.sections.geo.accounting}
              </span>
            ) : null}

            {/*
              A missing rate is called out in red rather than shown as a dash. The platform
              REFUSES to price a booking without one, so an unconfigured currency is a live
              defect waiting for a customer to find — this is where it should be caught.
            */}
            <span className="ms-auto text-[11.5px]">
              {row.rateToSyp === null ? (
                <span className="font-bold text-bad">{t.sections.geo.noRate}</span>
              ) : (
                <Ltr className="text-muted">
                  = {money(row.rateToSyp)} ل.س
                  {row.rateSetAt ? (
                    <span className="ms-1.5 text-[10.5px] text-faint">
                      {shortDate(row.rateSetAt)}
                    </span>
                  ) : null}
                </Ltr>
              )}
            </span>
          </li>
        ))}
      </ul>

      <FootNote>{t.sections.geo.note}</FootNote>
      <p className="mt-1 text-[11px] text-faint">
        <Link href="/settings" className="text-sky hover:underline">
          {t.sections.geo.fxElsewhere}
        </Link>
      </p>
    </ConsolePanel>
  );
}

const CITY_COLUMNS: readonly AdminColumn<Geography['cities'][number]>[] = [
  {
    key: 'city',
    header: t.sections.geo.cities,
    render: (row) => <span className="font-semibold text-text">{row.nameAr}</span>,
  },
  {
    key: 'country',
    header: t.sections.geo.colCountry,
    render: (row) => <span className="text-text2">{row.country}</span>,
  },
  {
    key: 'category',
    header: t.sections.geo.colCategory,
    render: (row) => <span className="text-muted">{cityCategories(row.category)}</span>,
  },
  {
    key: 'properties',
    header: t.sections.geo.colProperties,
    render: (row) => <span className="text-text2">{count(row.properties)}</span>,
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <StatusPill tone={row.isActive ? 'ok' : 'faint'}>
        {row.isActive ? t.sections.geo.active : t.sections.geo.inactive}
      </StatusPill>
    ),
  },
];

/** An action the design shows and the platform cannot yet perform. */
function Disabled({ children }: { children: React.ReactNode }) {
  return (
    <span
      aria-disabled="true"
      title={t.nav.notBuilt}
      className="cursor-not-allowed rounded-lg border border-line px-3.5 py-1.5 text-[11.5px] font-bold text-faint2"
    >
      {children}
    </span>
  );
}
