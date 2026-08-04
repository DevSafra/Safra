import { getGiftCards, type GiftCardItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { money, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Pager } from '@/components/console-shell';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { TableToolbar, ToolbarNote } from '@/components/table-toolbar';
import { AR, label } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

/**
 * بطاقات الهدايا (design handoff §8).
 *
 * ## No code is ever shown
 *
 * The design's table has a الكود column. `gift_cards` stores `code_hash` and `code_last4`, so
 * this shows the reference and the last four characters — and there is no endpoint that returns
 * a usable code. A support console that displayed redeemable codes would be a way to spend other
 * people's money; a lost card is reissued, not revealed.
 *
 * ## The create button is disabled, and says why
 *
 * Issuing a gift card is a financial liability: it needs an amount, a currency, an expiry, a
 * recipient, an audit entry and a delivery email, and getting the currency wrong creates a debt
 * in the wrong denomination. That form is its own piece of work. The button is rendered
 * `aria-disabled` rather than omitted, so the capability is visibly planned rather than
 * apparently missing.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1.1fr .9fr 1fr 1fr 1fr .9fr';

export default async function GiftCardsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, cursor } = await listParams(searchParams);

  const [result, counts] = await Promise.all([
    getGiftCards({ q, cursor }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={AR.nav.giftCards} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/giftcards"
          query={q}
          placeholder={AR.sections.giftcards.searchPlaceholder}
          end={
            <>
              <ToolbarNote>{AR.sections.giftcards.hint}</ToolbarNote>
              <span
                aria-disabled="true"
                title={AR.nav.notBuilt}
                className="cursor-not-allowed rounded-[9px] border border-line px-4 py-1.5 text-[12.5px] font-extrabold text-faint2"
              >
                {AR.sections.giftcards.create}
              </span>
            </>
          }
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
              rowKey={(row) => row.reference}
              minWidth={700}
              empty={AR.table.empty}
            />
            <Pager basePath="/giftcards" query={{ q }} nextCursor={result.nextCursor} />
          </>
        )}

        <FootNote>{AR.sections.giftcards.note}</FootNote>
        <FootNote>{AR.sections.giftcards.codeNote}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<GiftCardItem>[] = [
  {
    key: 'reference',
    header: AR.sections.giftcards.colCode,
    render: (row) => (
      <span>
        <Ltr className="font-semibold text-sky">{row.reference}</Ltr>
        <Ltr className="ms-1.5 text-[10.5px] text-faint">···{row.codeLast4}</Ltr>
      </span>
    ),
  },
  {
    key: 'original',
    header: AR.sections.giftcards.colValue,
    render: (row) => (
      <Ltr className="whitespace-nowrap text-text2">
        {money(row.originalAmount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'remaining',
    header: AR.sections.giftcards.colRemaining,
    /* Gold, because the remaining balance is the liability — the number that still matters. */
    render: (row) => (
      <Ltr className="font-bold whitespace-nowrap text-gold">
        {money(row.remainingAmount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'buyer',
    header: AR.sections.giftcards.colBuyer,
    render: (row) => <span className="text-text2">{row.buyer ?? AR.admin.noData}</span>,
  },
  {
    key: 'expiry',
    header: AR.sections.giftcards.colExpiry,
    render: (row) => <Ltr className="text-muted">{shortDate(row.expiresAt)}</Ltr>,
  },
  {
    key: 'status',
    header: AR.table.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>
        {label(AR.enums.giftCardStatus, row.status)}
      </StatusPill>
    ),
  },
];

function statusTone(status: string): Tone {
  switch (status) {
    case 'active':
      return 'ok';
    case 'used':
      return 'faint';
    case 'expired':
      return 'warn';
    default:
      return 'bad';
  }
}
