import Link from 'next/link';

import { getWalletTransactions, type WalletItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { money, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  ToneText,
  type AdminColumn,
} from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { t, label, walletNote } from '@/lib/strings';
import { isUnread, listParamsFor } from '@/lib/table-size';
import { MarkSectionSeen } from '@/components/mark-section-seen';
import { refuseSection } from '@/components/section-refusal';

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
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never
    runs: the page has already rendered «انتهت الجلسة» to somebody whose session is fine, and
    signing in again lands them here again.
  */
  const refused = await refuseSection('wallet', t.nav.wallet);

  if (refused) return refused;

  const { q, page, size, seen } = await listParamsFor('wallet', searchParams);

  const [result, counts] = await Promise.all([
    getWalletTransactions({ q, page, limit: size }),
    sidebarCounts(),
  ]);

  /*
    The OLDEST row this page is about to render — the frontier the reader will have reached.

    These registries are ordered newest first, so the last item is the deepest one shown, and
    reporting it is what lets the badge fall by exactly the new rows on this page rather than
    by the whole batch. `undefined` when the list could not be read or came back empty: the
    visit is still reported, without a frontier, because that is what starts the clock for a
    reader who has never opened this section.
  */
  const oldestShown = typeof result === 'object' ? result.items.at(-1)?.at : undefined;
  /* And the NEWEST — the top of what was shown, which is where the next batch begins. */
  const newestShown = typeof result === 'object' ? result.items.at(0)?.at : undefined;

  return (
    <ConsoleShell title={t.nav.wallet} counts={counts}>
      {/*
        Marks this section read AFTER the render above has already used the old mark, so the
        badge and the tinted rows are shown on the visit that clears them. A client effect
        rather than part of rendering: Next.js prefetches links, and a prefetch is not a visit.
      */}
      <MarkSectionSeen section="wallet" readTo={oldestShown} readFrom={newestShown} />
      <ConsolePanel>
        <TableToolbar
          action="/wallet"
          query={q}
          size={size}
          placeholder={t.sections.wallet.searchPlaceholder}
        />

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={COLUMNS}
              rows={result.items}
              isNew={(row) => isUnread(seen)(row.at)}
              template={TEMPLATE}
              rowKey={(row) => `${row.at}-${row.customerReference ?? ''}-${row.amount}`}
              minWidth={820}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/wallet"
              section="wallet"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.wallet.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<WalletItem>[] = [
  {
    key: 'operation',
    header: t.sections.wallet.colOperation,
    /*
      `wallet_transactions` has no human reference, so the operation is identified by what it
      was FOR — the booking it belongs to — rather than by a fabricated `WTX-…` id. When there
      is no booking (a manual adjustment), the reason column carries the meaning.
    */
    /*
      Into the booking, carrying where to come back to.

      المحفظة was the one registry a reader could not click out of, and it names the two things an
      operator reconciling a movement actually asks about — whose balance this is, and which stay it
      belongs to. Both screens exist; the references were being printed at them.
    */
    render: (row) =>
      row.bookingReference ? (
        <Link
          href={`/bookings/${row.bookingReference}?from=wallet`}
          className="font-semibold text-sky hover:underline"
        >
          <Ltr>{row.bookingReference}</Ltr>
        </Link>
      ) : (
        /* A manual adjustment belongs to no booking; the reason column carries the meaning. */
        <span className="text-faint">{t.admin.noData}</span>
      ),
  },
  {
    key: 'customer',
    header: t.sections.wallet.colCustomer,
    /*
      The NAME on its own line, the reference under it (Bashar, 2026-08-26).

      They were one run of text, so an Arabic name and a Latin `CUS-…` sat on the same line with
      the bidi algorithm deciding where the boundary fell — and on a narrow column the reference
      wrapped into the middle of the name. Stacked, each is read for what it is: the name is what
      an operator scans, the reference is what they quote.

      Same shape as the date column two along, and the same 10.5px faint treatment the reference
      already had.
    */
    /*
      Linked only where there is still a record to open.

      A movement outlives the profile it belongs to — it is a financial record, and hiding it
      because somebody was removed would hide money — but العملاء filters deleted profiles out, so
      the link would answer 404. Found by clicking one: the first row of المحفظة belonged to a
      soft-deleted fixture. The reference stays either way, because reconciling is what it is for.
    */
    render: (row) =>
      row.customerReference && row.customerActive ? (
        <Link
          href={`/customers/${row.customerReference}?from=wallet`}
          className="grid min-w-0 gap-0.5 hover:underline"
        >
          <span className="truncate text-sky">{row.customer}</span>
          <Ltr className="text-[10.5px] text-faint">{row.customerReference}</Ltr>
        </Link>
      ) : (
        <div className="grid min-w-0 gap-0.5">
          <span className="truncate text-text">{row.customer}</span>
          {row.customerReference ? (
            <Ltr className="text-[10.5px] text-faint">{row.customerReference}</Ltr>
          ) : null}
        </div>
      ),
  },
  {
    key: 'reason',
    header: t.table.colType,
    render: (row) => (
      <ToneText tone={row.direction === 'credit' ? 'ok' : 'bad'}>
        {label(t.enums.walletReason, row.reason)}
      </ToneText>
    ),
  },
  {
    key: 'amount',
    header: t.admin.colAmount,
    /* Signed, so direction is legible without reading the type column. */
    render: (row) => (
      <div className="grid gap-0.5">
        <Ltr
          className={`font-extrabold whitespace-nowrap ${
            row.direction === 'credit' ? 'text-ok' : 'text-bad'
          }`}
        >
          {row.direction === 'credit' ? '+' : '−'}
          {money(row.amount)} {row.currency}
        </Ltr>
        {/*
          What this movement did with money that cannot be paid out — shown only when it did
          something with it (Bashar, 2026-09-01).

          «40.00 credited» does not say whether SAFRA handed out goodwill or gave somebody their own
          money back, and المحفظة is where a disputed movement is read. Silent when the figure is
          zero: a line on every ordinary row is noise, and noise is what trains people to skip the
          line that matters.
        */}
        {Number(row.restrictedAmount) > 0 ? (
          <span className="text-[10.5px] whitespace-nowrap text-faint2">
            {t.sections.wallet.restrictedPart}{' '}
            <Ltr>
              {money(row.restrictedAmount)} {row.currency}
            </Ltr>
          </span>
        ) : null}
      </div>
    ),
  },
  {
    key: 'note',
    header: t.sections.wallet.colReason,
    /*
      Through `walletNote`, so a code the platform wrote reads as Arabic and a sentence a staff
      member typed reads as they typed it. This printed `row.note` raw, and the platform's own
      notes were English prose on an Arabic-only console.
    */
    render: (row) => (
      <span className="text-text2">
        {row.note ? walletNote(row.note) : label(t.enums.walletReason, row.reason)}
      </span>
    ),
  },
  {
    key: 'at',
    header: t.sections.wallet.colBalanceAfter,
    render: (row) => (
      <div className="grid gap-0.5">
        {/* The currency, on the balance as on the movement above it — an amount never stands alone. */}
        <Ltr className="font-bold text-text2">
          {money(row.balanceAfter)} {row.currency}
        </Ltr>
        <Ltr className="text-[10.5px] text-muted">{shortDateTime(row.at)}</Ltr>
      </div>
    ),
  },
];
