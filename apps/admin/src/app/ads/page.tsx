import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';

import {
  getAdInvoices,
  getCampaigns,
  getGeography,
  type AdInvoiceItem,
  type CampaignItem,
  type Campaigns,
} from '@/lib/api';
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
import { AdsToolbar } from '@/components/ads-toolbar';
import { TableToolbar } from '@/components/table-toolbar';
import { CampaignStatusButton } from '@/components/campaign-status-button';
import { AdInvoicePaidButton } from '@/components/ad-invoice-paid-button';
import { CampaignCreativeForm } from '@/components/campaign-creative-form';
import { fill, label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

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

/** فواتير الإعلانات — seven columns, seven tracks. */
const INVOICE_TEMPLATE = '1fr .9fr 1.1fr 1.1fr .9fr .9fr 1fr';

export default async function AdsPage({
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
  const refused = await refuseSection('ads', t.nav.ads);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('ads', searchParams);
  /*
    The invoice table's OWN parameters — `?ipage=` and `?isize=`.

    Two paged tables on one route, so they are namespaced exactly as `/staff`'s two are. Sharing
    `?page=` would move both at once: a reader stepping through the billing would watch the
    campaign registry jump underneath them.
  */
  const invoiceParams = await listParamsFor('adInvoices', searchParams, 'iq');

  const [result, invoices, counts, geo] = await Promise.all([
    getCampaigns({ q, page, limit: size }),
    getAdInvoices({
      q: invoiceParams.q,
      page: invoiceParams.page,
      limit: invoiceParams.size,
    }),
    sidebarCounts(),
    /* For the campaign form's currency picker; a failed read must not take the registry down. */
    getGeography(),
  ]);

  const currencies =
    geo === 'unauthenticated' || geo === 'failed'
      ? [DEFAULT_MONEY_CURRENCY]
      : geo.currencies.map((entry) => entry.code);

  /*
    The invoice table's position, for every control on the campaign table to carry forward.

    Both directions, because a bar that drops its neighbour's page drops it in both — fixing the
    half you are looking at leaves the other half live. The return leg is `carry` on `<Invoices>`.
    `page` is omitted at 1 so an ordinary URL stays short and shareable.
  */
  const invoiceCarry: Record<string, string | undefined> = {
    ...(invoiceParams.page > 1 ? { ipage: String(invoiceParams.page) } : {}),
    isize: String(invoiceParams.size),
    ...(invoiceParams.q ? { iq: invoiceParams.q } : {}),
  };

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
            {/*
              The toolbar is drawn by the FORM, which owns the state the triggers and the panel
              share — see `AdsToolbar`. الإعلانات had no create control at all: the `AD_MANAGE`
              permission, the `ad_campaigns` table and the design's «+ حملة جديدة» were a feature
              that existed everywhere except where somebody could use it.
            */}
            <AdsToolbar
              action="/ads"
              query={q}
              size={size}
              placeholder={t.sections.ads.searchPlaceholder}
              currencies={currencies}
              carry={invoiceCarry}
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
              /* فواتير الإعلانات's place, so stepping this table does not reset that one. */
              query={{ q, ...invoiceCarry }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
              label={fill(t.table.paginationLabelOf, { section: t.nav.ads })}
            />

            <FootNote>{t.sections.ads.note}</FootNote>
            <FootNote>{t.sections.ads.noRanking}</FootNote>
          </ConsolePanel>

          <Invoices
            invoices={invoices}
            query={invoiceParams.q}
            size={invoiceParams.size}
            /* And the return leg: the campaign registry's place, carried the other way. */
            carry={{
              ...(page > 1 ? { page: String(page) } : {}),
              size: String(size),
              ...(q ? { q } : {}),
            }}
          />
        </div>
      )}
    </ConsoleShell>
  );
}

/**
 * فواتير الإعلانات — what each advertiser owes, and recording that they paid.
 *
 * ## A second table on this screen rather than a section of its own
 *
 * An invoice is meaningless without the campaign it bills, and an operator judging «هل الحملة
 * تستحق التجديد؟» reads the click-through and the money together. Its own sidebar entry would put
 * one question on two screens.
 *
 * It is paged like everything else, with its own `?ipage=`/`?isize=` and its own remembered rows
 * per page — see `adInvoices` in `TABLE_SECTIONS`.
 *
 * ## The panel refuses ALONE
 *
 * `getAdInvoices` failing renders a sentence inside this panel; the campaign registry above stays
 * readable. Two independent reads on one screen must not be able to take each other down.
 */
function Invoices({
  invoices,
  query,
  size,
  carry,
}: {
  invoices: Awaited<ReturnType<typeof getAdInvoices>>;
  query: string | undefined;
  size: number;
  /** The campaign registry's position, so this bar cannot move that table. */
  carry: Readonly<Record<string, string | undefined>>;
}) {
  const c = t.sections.adInvoices;

  return (
    <ConsolePanel title={c.title}>
      {/*
        A marker, not a position.

        A test reaching this table as «the second `<table>` on the page» finds nothing when either
        table is empty — an empty `AdminTable` renders «لا نتائج» and no `<table>` at all — and
        finds the WRONG one if a third ever appears. `data-ad-invoices` names it.
      */}
      <div data-ad-invoices>
        {invoices === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : invoices === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <TableToolbar
              action="/ads"
              query={query}
              size={size}
              placeholder={c.searchPlaceholder}
              queryName="iq"
              sizeName="isize"
              carry={carry}
            />

            <AdminTable
              columns={INVOICE_COLUMNS}
              rows={invoices.items}
              template={INVOICE_TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={820}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/ads"
              section="adInvoices"
              query={{ ...carry, ...(query ? { iq: query } : {}) }}
              page={invoices.page}
              pages={invoices.pages}
              total={invoices.total}
              capped={invoices.capped}
              size={size}
              label={fill(t.table.paginationLabelOf, { section: c.title })}
            />

            <FootNote>{c.note1}</FootNote>
            <FootNote>{c.note2}</FootNote>
          </>
        )}
      </div>
    </ConsolePanel>
  );
}

const INVOICE_COLUMNS: readonly AdminColumn<AdInvoiceItem>[] = [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => <Ltr className="font-semibold text-sky">{row.reference}</Ltr>,
  },
  {
    key: 'campaign',
    header: t.sections.adInvoices.colCampaign,
    render: (row) => <Ltr className="text-text2">{row.campaign}</Ltr>,
  },
  {
    key: 'advertiser',
    header: t.sections.ads.colAdvertiser,
    render: (row) => <span className="font-semibold text-text">{row.advertiser}</span>,
  },
  {
    key: 'city',
    header: t.table.colCity,
    render: (row) => <span className="text-muted">{row.city}</span>,
  },
  {
    key: 'period',
    header: t.sections.adInvoices.colPeriod,
    render: (row) => (
      <span className="text-[11px] text-muted">
        <Ltr>
          {shortDate(row.periodStart)} ← {shortDate(row.periodEnd)}
        </Ltr>
      </span>
    ),
  },
  {
    key: 'amount',
    header: t.sections.adInvoices.colAmount,
    /* Never a bare figure: SYP and USD differ by four orders of magnitude. */
    render: (row) => (
      <Ltr className="font-bold text-gold">{amount(row.amount, row.currency)}</Ltr>
    ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <div className="grid gap-1.5">
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.adInvoiceStatus, row.status)}
        </StatusPill>
        {row.paidAt ? (
          <span className="text-[10px] text-faint">
            {fill(t.sections.adInvoices.paidOn, { date: shortDate(row.paidAt) })}
          </span>
        ) : null}
        {/*
          Only a `due` invoice offers the control, and the API refuses any other state regardless
          — a person who deletes the attribute meets the same answer.
        */}
        {row.status === 'due' ? <AdInvoicePaidButton reference={row.reference} /> : null}
      </div>
    ),
  },
];

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
          <>
            <CampaignStatusButton reference={row.reference} status={row.status} />
            {/*
              The creative, editable from the row it appears on.

              Not offered on an expired campaign: its window has closed, nothing is being served,
              and a control that rewrites copy nobody will read is a promise the screen cannot keep.
            */}
            <CampaignCreativeForm
              reference={row.reference}
              headlineAr={row.headlineAr}
              headlineEn={row.headlineEn}
              headlineDe={row.headlineDe}
              targetUrl={row.targetUrl}
            />
          </>
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
