import { getCampaigns, type CampaignItem, type Campaigns } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, count, percent, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Kpi, KpiRow } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { CampaignStatusButton } from '@/components/campaign-status-button';
import { fill, label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParamsFor } from '@/lib/table-size';

/**
 * الإعلانات — targeted advertising (design handoff §8).
 *
 * ## The rule that shapes what is NOT here
 *
 * "موسومة دائماً «إعلان شريك» ولا تُخلط بترتيب البحث الطبيعي." There is no ranking, priority or
 * boost column in the table, in the service, or on this screen — because the moment one exists
 * somebody will use it to lift a paid listing into search results, and the promise stops being
 * true. Placement is by city and by moment (after a booking is confirmed), and that is all.
 *
 * ## Click-through is computed, not stored
 *
 * The design shows impressions and clicks. The ratio is the number an operator actually judges a
 * campaign on, so it is derived here rather than added as a column that could disagree with its
 * own inputs.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1fr 1.3fr .8fr .9fr .9fr .8fr .8fr .9fr';

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, page, size } = await listParamsFor('ads', searchParams);

  const [result, counts] = await Promise.all([
    getCampaigns({ q, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.ads} counts={counts}>
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
          <Counters counters={result.counters} />

          <ConsolePanel>
            <TableToolbar
              action="/ads"
              query={q}
              size={size}
              placeholder={t.sections.ads.searchPlaceholder}
            />

            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={860}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/ads"
              section="ads"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />

            <FootNote>{t.sections.ads.note}</FootNote>
            <FootNote>{t.sections.ads.noRanking}</FootNote>
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

function Counters({ counters }: { counters: Campaigns['counters'] }) {
  const ctr =
    counters.impressions30d === 0
      ? null
      : (counters.clicks30d / counters.impressions30d) * 100;

  return (
    <KpiRow label={t.nav.ads}>
      <Kpi
        label={t.sections.ads.kpiActive}
        value={count(counters.active)}
        valueClass="text-ok"
      />
      <Kpi label={t.sections.ads.kpiPaused} value={count(counters.paused)} />
      <Kpi
        label={t.sections.ads.kpiEnding}
        value={count(counters.endingWithinWeek)}
        valueClass={counters.endingWithinWeek > 0 ? 'text-warn' : 'text-text'}
      />
      <Kpi
        label={t.sections.ads.kpiImpressions}
        value={count(counters.impressions30d)}
        valueClass="text-gold"
      />
      <Kpi
        label={t.sections.ads.kpiClicks}
        value={count(counters.clicks30d)}
        /* A dash when there is nothing to divide — never 0%, which reads as "nobody clicked". */
        sub={
          ctr === null
            ? t.admin.noData
            : `${t.sections.ads.ctr} ${percent(ctr.toFixed(1))}`
        }
      />
    </KpiRow>
  );
}

const COLUMNS: readonly AdminColumn<CampaignItem>[] = [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => <Ltr className="font-semibold text-sky">{row.reference}</Ltr>,
  },
  {
    key: 'advertiser',
    header: t.sections.ads.colAdvertiser,
    render: (row) => <span className="font-semibold text-text">{row.advertiser}</span>,
  },
  {
    key: 'kind',
    header: t.table.colType,
    render: (row) => (
      <span className="text-text2">
        {label(t.enums.advertiserKind, row.advertiserKind)}
      </span>
    ),
  },
  {
    key: 'city',
    header: t.table.colCity,
    render: (row) => <span className="text-muted">{row.city}</span>,
  },
  {
    key: 'period',
    header: t.sections.ads.colPeriod,
    render: (row) => (
      <span className="text-muted">
        {periodLabel(row.billingPeriod)}
        {row.priceAmount && row.priceCurrency ? (
          <Ltr className="ms-1.5 text-[10.5px] text-gold">
            {amount(row.priceAmount, row.priceCurrency)}
          </Ltr>
        ) : null}
      </span>
    ),
  },
  {
    key: 'impressions',
    header: t.sections.ads.colImpressions,
    render: (row) => <Ltr className="text-text2">{count(row.impressions)}</Ltr>,
  },
  {
    key: 'clicks',
    header: t.sections.ads.colClicks,
    render: (row) => (
      <span>
        <Ltr className="text-text2">{count(row.clicks)}</Ltr>
        {row.impressions > 0 ? (
          <Ltr className="ms-1 text-[10px] text-faint">
            {percent(((row.clicks / row.impressions) * 100).toFixed(1))}
          </Ltr>
        ) : null}
      </span>
    ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <div className="grid gap-1.5">
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.adStatus, row.status)}
        </StatusPill>
        {/* The design's "ينتهي بعد 4 أيام" — a window closing is what needs the operator. */}
        <Ltr className="text-[10px] text-faint">
          {row.daysRemaining < 0
            ? t.sections.ads.ended
            : fill(t.sections.ads.endsIn, { days: count(row.daysRemaining) })}
        </Ltr>
        <span className="text-[10px] text-faint2">
          <Ltr>
            {shortDate(row.startsAt)} ← {shortDate(row.endsAt)}
          </Ltr>
        </span>
        {row.status === 'expired' ? null : (
          <CampaignStatusButton reference={row.reference} status={row.status} />
        )}
      </div>
    ),
  },
];

function periodLabel(period: string): string {
  switch (period) {
    case 'weekly':
      return t.sections.ads.weekly;
    case 'quarterly':
      return t.sections.ads.quarterly;
    default:
      return t.sections.ads.monthly;
  }
}
