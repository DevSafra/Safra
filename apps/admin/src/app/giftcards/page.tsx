import { getGeography, getGiftCards, type GiftCardItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { money, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  FootNote,
  Ltr,
  StatusPill,
  type AdminColumn,
} from '@/components/admin-table';
import { t, label } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';
import Link from 'next/link';

import { GiftCardsToolbar } from '@/components/issue-gift-card-form';
import { CancelGiftCardForm } from '@/components/cancel-gift-card-form';
import { DEFAULT_MONEY_CURRENCY, GIFT_CARD_CURRENCIES } from '@safra/contracts';

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

/**
 * Whether a card's expiry has already passed.
 *
 * Asked of the CLOCK, not of the status column: `gift-card-expiry` runs hourly, so a card that
 * lapsed forty minutes ago still says `active`. Offering an إلغاء control on it would be offering
 * something the API refuses.
 */
function lapsed(expiresAt: string | null): boolean {
  return expiresAt !== null && new Date(expiresAt).getTime() <= Date.now();
}

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1.1fr .8fr .9fr 1fr .9fr .8fr 1fr';

export default async function GiftCardsPage({
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
  const refused = await refuseSection('giftCards', t.nav.giftCards);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('giftcards', searchParams);

  const [result, counts, geo] = await Promise.all([
    getGiftCards({ q, page, limit: size }),
    sidebarCounts(),
    /*
      For the issue form's currency list. A failed read must not take the registry down — a screen
      that refuses to show gift cards because it could not list currencies is worse than one whose
      form offers the accounting currency only.
    */
    getGeography(),
  ]);

  /*
    The three a card may be issued in, intersected with what geography says is ACTIVE.

    Two filters rather than one, and each catches something the other cannot: `GIFT_CARD_CURRENCIES`
    is the product decision (Bashar, 2026-08-26) and the schema enforces it, so JOD and LBP cannot
    be issued even by a caller who edits the DOM. The intersection is the operational half — a
    currency the platform deactivates stops being offerable here without anybody remembering this
    screen.

    A failed geography read falls back to the accounting currency rather than taking the registry
    down: a screen that refuses to show gift cards because it could not list currencies is worse
    than one whose form offers one.
  */
  const active =
    geo === 'unauthenticated' || geo === 'failed'
      ? [DEFAULT_MONEY_CURRENCY]
      : geo.currencies.map((entry) => entry.code);

  const currencies = GIFT_CARD_CURRENCIES.filter((code) => active.includes(code));

  return (
    <ConsoleShell title={t.nav.giftCards} counts={counts}>
      <ConsolePanel>
        {/*
          The toolbar is rendered by the FORM, not beside it.

          The trigger belongs in the bar and the panel belongs under it at the table's full width,
          and the two share one piece of state — so one client component owns both and draws the bar
          around them. Placed in the bar's `end` slot instead, the panel inherited an `ms-auto`
          wrapper that sizes to its content and rendered in a third of the row with the search
          beside it.
        */}
        <GiftCardsToolbar
          action="/giftcards"
          query={q}
          size={size}
          placeholder={t.sections.giftcards.searchPlaceholder}
          currencies={currencies}
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
              template={TEMPLATE}
              rowKey={(row) => row.reference}
              minWidth={700}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/giftcards"
              section="giftcards"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}

        <FootNote>{t.sections.giftcards.note}</FootNote>
        <FootNote>{t.sections.giftcards.codeNote}</FootNote>
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<GiftCardItem>[] = [
  {
    key: 'reference',
    header: t.sections.giftcards.colCode,
    /*
      The reference over the last four, not beside them (Bashar, 2026-08-26).

      They were one run of text and rendered as «···7633GIF-018699» — two Latin values with no
      separation, in an RTL cell where the bidi algorithm decides which end each begins at. Nothing
      was clipped; it was unreadable, which is worse because it looks like data.

      Stacked, each is read for what it is: the reference identifies the card, the four characters
      are what a customer reads off their own copy of the code. Same shape as المحفظة's customer
      cell, and the same faint 10.5px the last four already had.
    */
    render: (row) => (
      <div className="grid min-w-0 gap-0.5">
        <Ltr className="font-semibold text-sky">{row.reference}</Ltr>
        <Ltr className="text-[10.5px] text-faint">••••{row.codeLast4}</Ltr>
      </div>
    ),
  },
  {
    key: 'original',
    header: t.sections.giftcards.colValue,
    render: (row) => (
      <Ltr className="whitespace-nowrap text-text2">
        {money(row.originalAmount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'remaining',
    header: t.sections.giftcards.colRemaining,
    /* Gold, because the remaining balance is the liability — the number that still matters. */
    render: (row) => (
      <Ltr className="font-bold whitespace-nowrap text-gold">
        {money(row.remainingAmount)} {row.currency}
      </Ltr>
    ),
  },
  {
    key: 'buyer',
    header: t.sections.giftcards.colBuyer,
    /*
      The buyer opens their record — every other registry that names a customer now does.

      Linked only where there IS a buyer and they still have a record: `buyer` falls back to the
      RECIPIENT's name for a card nobody bought, and that name belongs to no customer. A deleted
      profile answers 404 on العملاء, so it stays plain text too — the same thing المحفظة learned
      by clicking its own first row.
    */
    render: (row) =>
      row.buyerReference && row.buyerActive ? (
        <Link
          href={`/customers/${row.buyerReference}?from=giftcards`}
          className="truncate text-sky hover:underline"
        >
          {row.buyer}
        </Link>
      ) : (
        <span className="truncate text-text2">{row.buyer ?? t.admin.noData}</span>
      ),
  },
  {
    key: 'expiry',
    header: t.sections.giftcards.colExpiry,
    render: (row) => <Ltr className="text-muted">{shortDate(row.expiresAt)}</Ltr>,
  },
  {
    /*
      Voiding a live card. Only where one CAN be voided — a used, expired or cancelled card gets no
      control, and neither does one whose expiry has lapsed but which the hourly sweep has not
      reached. That is a courtesy: the API re-checks all four against the clock.
    */
    key: 'action',
    header: t.table.colAction,
    render: (row) =>
      row.status === 'active' && !lapsed(row.expiresAt) ? (
        <CancelGiftCardForm reference={row.reference} />
      ) : (
        <span className="text-faint">{t.admin.noData}</span>
      ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => (
      <StatusPill tone={statusTone(row.status)}>
        {label(t.enums.giftCardStatus, row.status)}
      </StatusPill>
    ),
  },
];
