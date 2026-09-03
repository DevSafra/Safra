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
import { fill, label, plural, t } from '@/lib/strings';
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
/*
  الحالة is the widest track, and that is deliberate (Bashar, 2026-08-27).

  It carries four things — the pill, how long is left, the window's dates, and two controls — and at
  `.9fr` the pair of buttons could not sit on one line, so they wrapped and the column drove the
  height of every row on the screen. The width comes off المعلن, which is a name and wraps happily.
*/
const TEMPLATE = '1fr 1.15fr .8fr .85fr .9fr .75fr .75fr 1.2fr';

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

  /*
    The campaign just created, so its creative dialog opens by itself — Bashar, 2026-08-27, so
    «أنشئ ثم أضف الصورة» is one continuous move instead of hunting for the row afterwards.

    Read here, on the SERVER, and handed to the row as a boolean. The parameter is only ever
    COMPARED with a reference this page already fetched: it names no route, builds no query, and
    reaches no link, so the worst a crafted `?created=` can do is open a dialog on a row the reader
    is looking at anyway. The toolbar sends the reader to a literal `/ads`, so the new campaign is
    the first row of an unfiltered page — the list is ordered `created_at DESC`.
  */
  const query = await searchParams;
  const created = typeof query['created'] === 'string' ? query['created'] : null;

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
              columns={columnsFor(created)}
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
        {/*
          «→», not «←».

          The whole run is inside `Ltr`, so it is laid out LEFT to right: the start date is on the
          left and the end on the right, and an arrow pointing left there reads «the end leads back
          to the start». The rest of the console writes a range in the page's own RTL flow, where
          «←» is correct — the direction of the glyph has to follow the direction of the run it
          sits in (Bashar, 2026-09-01).
        */}
        <Ltr>
          {shortDate(row.periodStart)} → {shortDate(row.periodEnd)}
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

/**
 * The campaign columns, told which row (if any) should open its creative dialog on arrival.
 *
 * A function rather than a constant because that one row differs per request. Everything else here
 * is still static.
 */
function columnsFor(created: string | null): readonly AdminColumn<CampaignItem>[] {
  return [
    {
      key: 'reference',
      header: t.table.colId,
      render: (row) => <Ltr className="font-semibold text-sky">{row.reference}</Ltr>,
    },
    {
      key: 'advertiser',
      header: t.sections.ads.colAdvertiser,
      /*
      The advertiser, and UNDER it the Arabic headline the customer actually reads.

      Bashar, 2026-08-27: «when I edit a row and save, nothing changes, is that correct?» It was
      correct, and it was the defect. «تعديل» edits the three headlines and the target, and NONE of
      the four appeared anywhere on this screen — so a save that worked, wrote and was audited
      looked identical to one that had failed silently. A control whose result is invisible cannot
      be told apart from a broken one, and the operator has no way to know which they have.

      The ARABIC one, because this console is Arabic and it is the copy most of its readers are
      served. The English and German headlines and the target stay in the form: four lines per row
      would spend this row's legibility on the rarer question.
    */
      render: (row) => (
        <div className="grid gap-0.5 leading-tight">
          <span className="font-semibold text-text">{row.advertiser}</span>
          <span className="truncate text-[10.5px] text-faint" title={row.headlineAr}>
            {row.headlineAr}
          </span>
          {/*
          «بلا صورة» — an incomplete campaign, identifiable without opening twenty dialogs
          (Bashar, 2026-08-27). The creative itself is only ever visible inside the dialog, so
          without this the row cannot be told from a complete one.

          Shown for a campaign that has never had one AND for one whose render failed: both are
          served to the customer as text, which is what the marker is reporting. `processing` is
          deliberately excluded — a picture is being made, and saying «بلا صورة» about it would be
          wrong for the forty seconds it is true of nothing.

          Not a `StatusPill`. A campaign's status is active/paused/expired, and «One status, one
          word, one colour» governs that column across the whole console; a fourth word borrowing
          the pill's shape would read as a status and would be swept as one by
          `navigation.spec.ts`. A dashed outline is the same language the empty tile already uses.
        */}
          {row.imageStatus === null || row.imageStatus === 'failed' ? (
            <span
              data-no-creative={row.reference}
              title={t.sections.ads.rowNoCreativeTitle}
              className="mt-0.5 w-fit rounded border border-dashed border-line px-1.5 py-px text-[10px] text-muted"
            >
              {t.sections.ads.rowNoCreative}
            </span>
          ) : null}
        </div>
      ),
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
      /*
      The cycle on one line, what it costs on the next (Bashar, 2026-08-27).

      They were one line — the Arabic word, then the amount in an inline `Ltr` with a margin — and
      they rendered touching: «شهري$150.00». The margin was `ms-`, which is the INLINE START, and on
      an RTL line that puts the gap on the far side of the isolated run from where it is needed.
      Two values of different kinds sharing a line in two directions is a fight that a margin does
      not settle.

      Stacked, each reads as itself: the cycle is a word, the price is a figure, and «شهري» directly
      above «$150.00» says «monthly, at this rate» without either being read into the other.
    */
      render: (row) => (
        <div className="grid gap-0.5 leading-tight">
          <span className="text-text2">{periodLabel(row.billingPeriod)}</span>
          {row.priceAmount && row.priceCurrency ? (
            /* Never a bare figure — SYP and USD differ by four orders of magnitude. */
            <Ltr className="text-[11px] font-bold text-gold-ink">
              {amount(row.priceAmount, row.priceCurrency)}
            </Ltr>
          ) : (
            <span className="text-[10.5px] text-faint">{t.sections.ads.noPrice}</span>
          )}
        </div>
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
      /*
      Four things a reader needs, in the order they need them (Bashar, 2026-08-27).

      It was five stacked items of five different widths — pill, countdown, then the two dates on
      separate lines with a dangling arrow, then two buttons one above the other — and the column drove
      the height of every row on the screen.

      ## What changed, and why each one

      **The pill and how long is left share a line.** They answer one question — «is this running,
      and for how much longer» — and reading them as one glance is the whole point of the column.

      **The countdown is no longer wrapped in `<Ltr>`.** It is an Arabic SENTENCE, and forcing an
      LTR isolate over a label is the mistake `docs/i18n.md` names outright: the number inside it is
      a Latin RUN, and the bidi algorithm lays a run out correctly without being told. Wrapping the
      sentence is what pushed the digits around.

      **The dates are one line that does not break**, isolated as a PAIR — a range is a single value
      and `whitespace-nowrap` keeps the arrow between its two ends instead of stranded at the end of a row.

      **The controls sit side by side.** Two buttons of the same size on one line read as a pair of
      actions; stacked, they read as a list of two more facts about the campaign.
    */
      render: (row) => (
        <div className="grid gap-1.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <StatusPill tone={statusTone(row.status)}>
              {label(t.enums.adStatus, row.status)}
            </StatusPill>
            <span className="text-[10px] text-faint">
              {row.daysRemaining < 0
                ? t.sections.ads.ended
                : plural(t.sections.ads.endsIn, { days: row.daysRemaining })}
            </span>
          </div>

          {/* «→» inside an `Ltr` run — see the note on the invoice period column above. */}
          <Ltr className="text-[10px] whitespace-nowrap text-faint2">
            {shortDate(row.startsAt)} → {shortDate(row.endsAt)}
          </Ltr>

          {row.status === 'expired' ? null : (
            /*
            A two-column GRID, not a flex row with a `min-w-*` on each button.

            `min-w-[5.5rem]` was tried first and computed to `0px` in the browser: `globals.css`
            carries `:where(.grid, .flex, .inline-flex) > * { min-width: 0 }`, and under Tailwind v4
            that rule outranks the utility despite the utility's higher specificity — cascade LAYERS
            beat specificity, and the note beside that rule saying «any explicit `min-w-*` still
            wins» is no longer true of the built CSS. Measured, not assumed.

            Two equal tracks need no override and no magic number: the pair reads as a pair at every
            width, and neither button has to be told how wide the other is.
          */
            <div className="grid grid-cols-2 items-start gap-1.5">
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
                descriptionAr={row.descriptionAr}
                descriptionEn={row.descriptionEn}
                descriptionDe={row.descriptionDe}
                targetUrl={row.targetUrl}
                imageUrl={row.imageUrl}
                imageStatus={row.imageStatus}
                autoOpen={created === row.reference}
              />
            </div>
          )}
        </div>
      ),
    },
  ];
}

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
