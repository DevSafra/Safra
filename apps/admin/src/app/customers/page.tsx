import Link from 'next/link';

import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';
import { getCustomers, type CustomerListItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, count, shortDate } from '@/lib/format';
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
import { returnQuery } from '@/lib/search-params';
import { t } from '@/lib/strings';
import { isUnread, listParamsFor } from '@/lib/table-size';
import { MarkSectionSeen } from '@/components/mark-section-seen';
import { refuseSection } from '@/components/section-refusal';

/**
 * العملاء — the customer registry (design handoff §8).
 *
 * ## Deliberately less than the design's row
 *
 * The prototype's demo rows show a name and a wallet balance, which is what this renders. What
 * it does NOT render — and what a customer list is always asked to add — is an email and a
 * phone number. Those are on the detail screen, because a registry is the screen most likely to
 * be left open on a shared support desk, and a list of four thousand contactable people is a
 * different class of exposure from one customer's record opened for a reason.
 *
 * The design's own footnote says the quiet part: support staff do not see payment data.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1fr 1.3fr .9fr .8fr 1fr 1fr';

export default async function CustomersPage({
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
  const refused = await refuseSection('customers', t.nav.customers);

  if (refused) return refused;

  const { q, page, size, seen } = await listParamsFor('customers', searchParams);

  /* Carried into every row link, so «رجوع» on the record comes back to this page of this search. */
  const back = returnQuery({ page, size, q });

  const [result, counts] = await Promise.all([
    getCustomers({ q, page, limit: size }),
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
  const oldestShown =
    typeof result === 'object' ? result.items.at(-1)?.createdAt : undefined;
  /* And the NEWEST — the top of what was shown, which is where the next batch begins. */
  const newestShown =
    typeof result === 'object' ? result.items.at(0)?.createdAt : undefined;

  return (
    <ConsoleShell title={t.nav.customers} counts={counts}>
      {/*
        Marks this section read AFTER the render above has already used the old mark, so the
        badge and the tinted rows are shown on the visit that clears them. A client effect
        rather than part of rendering: Next.js prefetches links, and a prefetch is not a visit.
      */}
      <MarkSectionSeen section="customers" readTo={oldestShown} readFrom={newestShown} />
      <ConsolePanel>
        <TableToolbar
          action="/customers"
          query={q}
          size={size}
          placeholder={t.sections.customers.searchPlaceholder}
        />

        {result === 'unauthenticated' ? (
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        ) : result === 'failed' ? (
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        ) : (
          <>
            <AdminTable
              columns={columns(back)}
              rows={result.items}
              isNew={(row) => isUnread(seen)(row.createdAt)}
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={700}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/customers"
              section="customers"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.customers.note}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

const columns = (back: string): readonly AdminColumn<CustomerListItem>[] => [
  {
    key: 'reference',
    header: t.table.colId,
    /*
      Into the customer's record, carrying the reader's place in the list.

      The registry had no way in at all until 2026-08-26: an agent who found somebody here had to
      re-search their name in الحجوزات. `returnQuery` is the allow-list, so the link reflects only
      the four fields the list owns and never whatever the URL happened to carry.
    */
    render: (row) => (
      <Link
        href={`/customers/${row.reference}${back}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'name',
    header: t.sections.customers.colName,
    render: (row) => <span className="font-semibold text-text">{row.fullName}</span>,
  },
  {
    key: 'type',
    header: t.table.colType,
    /*
      Guest and registered are coloured differently because they lead to different support
      conversations: a guest holds only one booking's data and can be upgraded; a registered
      customer has an account to recover.
    */
    render: (row) =>
      row.isGuest ? (
        <ToneText tone="sky">{t.sections.customers.guest}</ToneText>
      ) : (
        <ToneText tone="ok">{t.sections.customers.registered}</ToneText>
      ),
  },
  {
    key: 'bookings',
    header: t.sections.customers.colBookings,
    render: (row) => <span className="text-text2">{count(row.bookings)}</span>,
  },
  {
    key: 'wallet',
    header: t.sections.customers.colWallet,
    /* A customer with no wallet row shows a dash, not $0.00 — they are different facts. */
    render: (row) =>
      row.walletBalance === null ? (
        <span className="text-faint">{t.admin.noData}</span>
      ) : (
        <Ltr className="font-bold whitespace-nowrap text-gold">
          {amount(row.walletBalance, row.walletCurrency ?? DEFAULT_MONEY_CURRENCY)}
        </Ltr>
      ),
  },
  {
    key: 'last',
    header: t.sections.customers.colLast,
    render: (row) => <Ltr className="text-muted">{shortDate(row.lastActivity)}</Ltr>,
  },
];
