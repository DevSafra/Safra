import { getFinance, type FinanceItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, money, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Kpi, KpiRow } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  ToneText,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t, label } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParams } from '@/lib/search-params';

/**
 * الدفع والفواتير — money movement (design handoff §8).
 *
 * Payments, refunds and partner fines in one chronological table, as the design specifies:
 * the operational question is "what happened to this booking's money", and answering it from
 * three separate screens means reconstructing a timeline by hand.
 *
 * ## The design's fourth row type is absent, on purpose
 *
 * تحويل شريك (`TRF-…`, a scheduled partner payout) is not shown. There is no payouts table —
 * `partner_payout_accounts` records where to send money, not that any was sent — and payment
 * rails are deferred by decision. The fourth KPI therefore reports what SAFRA OWES partners and
 * says so, instead of presenting an obligation as a transfer that has been arranged.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1fr 1.1fr 1fr .9fr .8fr 1fr';

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, page, size } = await listParams(searchParams);

  const [result, counts] = await Promise.all([
    getFinance({ q, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.payments} counts={counts}>
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
          <KpiRow label={t.nav.payments}>
            <Kpi
              label={t.sections.payments.kpiCaptured}
              value={amount(result.counters.captured_today, result.counters.currency)}
              valueClass="text-gold"
            />
            <Kpi
              label={t.sections.payments.kpiRefunded}
              value={amount(result.counters.refunded_today, result.counters.currency)}
              valueClass="text-bad"
            />
            <Kpi
              label={t.sections.payments.kpiPayable}
              value={amount(
                result.counters.partner_payable_outstanding,
                result.counters.currency,
              )}
              sub={t.sections.payments.payableNote}
            />
            <Kpi
              label={t.sections.payments.kpiFines}
              value={amount(
                result.counters.fines_collected_month,
                result.counters.currency,
              )}
              valueClass="text-warn"
            />
          </KpiRow>

          <ConsolePanel>
            <TableToolbar
              action="/payments"
              query={q}
              size={size}
              placeholder={t.sections.payments.searchPlaceholder}
            />

            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => `${row.kind}-${row.reference}-${row.at}`}
              minWidth={720}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/payments"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />

            <FootNote>{t.sections.payments.note}</FootNote>
            <FootNote>{t.sections.payments.payoutsMissing}</FootNote>
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<FinanceItem>[] = [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => <Ltr className="font-semibold text-sky">{row.reference}</Ltr>,
  },
  {
    key: 'linked',
    header: t.sections.payments.colLinked,
    render: (row) => <Ltr className="text-text2">{row.linkedTo ?? t.admin.noData}</Ltr>,
  },
  {
    key: 'method',
    header: t.sections.payments.colMethod,
    /*
      A fine has no payment method; the column carries its violation KIND instead, which is the
      equivalent fact — why the money moved. Both maps fall back to the raw value.
    */
    render: (row) => (
      <span className="text-text2">
        {row.kind === 'fine'
          ? label(t.enums.violationKind, row.method)
          : label(t.enums.paymentMethod, row.method)}
      </span>
    ),
  },
  {
    key: 'kind',
    header: t.table.colType,
    render: (row) => <ToneText tone={kindTone(row.kind)}>{kindLabel(row.kind)}</ToneText>,
  },
  {
    key: 'amount',
    header: t.admin.colAmount,
    render: (row) => (
      <Ltr className="font-bold whitespace-nowrap text-gold">
        {money(row.amount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <div className="grid gap-1">
        <StatusPill tone={statusTone(row.status)}>
          {label(t.enums.paymentStatus, row.status)}
        </StatusPill>
        <Ltr className="text-[10.5px] text-faint">{shortDateTime(row.at)}</Ltr>
      </div>
    ),
  },
];

function kindLabel(kind: FinanceItem['kind']): string {
  switch (kind) {
    case 'payment':
      return t.sections.payments.typePayment;
    case 'refund':
      return t.sections.payments.typeRefund;
    default:
      return t.sections.payments.typeFine;
  }
}

/** Money in is green, money out is red, a fine is amber — the direction at a glance. */
function kindTone(kind: FinanceItem['kind']): Tone {
  switch (kind) {
    case 'payment':
      return 'ok';
    case 'refund':
      return 'bad';
    default:
      return 'warn';
  }
}
