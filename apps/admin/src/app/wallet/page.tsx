import { getWalletTransactions, type WalletItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { money, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Pager } from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  Ltr,
  ToneText,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { AR, label } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

/**
 * المحفظة — the wallet ledger across all customers (design handoff §8).
 *
 * Every row carries its REASON, which is the point of the screen: a credit is either a refund,
 * an SLA compensation (P-007) or a manual adjustment, and only the last of those is a judgement
 * somebody has to answer for. `balanceAfter` comes along so a disputed balance can be
 * reconstructed by reading rather than by replaying arithmetic.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1.2fr 1fr .9fr .8fr 1.6fr 1fr';

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, cursor } = await listParams(searchParams);

  const [result, counts] = await Promise.all([
    getWalletTransactions({ q, cursor }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={AR.nav.wallet} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/wallet"
          query={q}
          placeholder={AR.sections.wallet.searchPlaceholder}
        />

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              template={TEMPLATE}
              rowKey={(row) => `${row.at}-${row.customerReference ?? ''}-${row.amount}`}
              minWidth={820}
              empty={AR.table.empty}
            />
            <Pager basePath="/wallet" query={{ q }} nextCursor={result.nextCursor} />
          </>
        )}

        <FootNote>{AR.sections.wallet.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<WalletItem>[] = [
  {
    key: 'operation',
    header: AR.sections.wallet.colOperation,
    /*
      `wallet_transactions` has no human reference, so the operation is identified by what it
      was FOR — the booking it belongs to — rather than by a fabricated `WTX-…` id. When there
      is no booking (a manual adjustment), the reason column carries the meaning.
    */
    render: (row) => (
      <Ltr className="font-semibold text-sky">
        {row.bookingReference ?? AR.admin.noData}
      </Ltr>
    ),
  },
  {
    key: 'customer',
    header: AR.sections.wallet.colCustomer,
    render: (row) => (
      <span className="text-text">
        {row.customer}
        {row.customerReference ? (
          <Ltr className="ms-1.5 text-[10.5px] text-faint">{row.customerReference}</Ltr>
        ) : null}
      </span>
    ),
  },
  {
    key: 'reason',
    header: AR.table.colType,
    render: (row) => (
      <ToneText tone={row.direction === 'credit' ? 'ok' : 'bad'}>
        {label(AR.enums.walletReason, row.reason)}
      </ToneText>
    ),
  },
  {
    key: 'amount',
    header: AR.admin.colAmount,
    /* Signed, so direction is legible without reading the type column. */
    render: (row) => (
      <Ltr
        className={`font-extrabold whitespace-nowrap ${
          row.direction === 'credit' ? 'text-ok' : 'text-bad'
        }`}
      >
        {row.direction === 'credit' ? '+' : '−'}
        {money(row.amount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'note',
    header: AR.sections.wallet.colReason,
    render: (row) => (
      <span className="text-text2">
        {row.note ?? label(AR.enums.walletReason, row.reason)}
      </span>
    ),
  },
  {
    key: 'at',
    header: AR.sections.wallet.colBalanceAfter,
    render: (row) => (
      <div className="grid gap-0.5">
        <Ltr className="font-bold text-text2">{money(row.balanceAfter)}</Ltr>
        <Ltr className="text-[10.5px] text-muted">{shortDateTime(row.at)}</Ltr>
      </div>
    ),
  },
];
