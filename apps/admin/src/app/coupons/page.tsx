import { DEFAULT_MONEY_CURRENCY } from '@safra/contracts';
import { getCoupons, getGeography, type CouponItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, count, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  Ltr,
  StatusPill,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';

import { t, label } from '@/lib/strings';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';
import { CouponsToolbar } from '@/components/coupons-toolbar';
import { CouponActiveToggle } from '@/components/coupon-active-toggle';

/**
 * الكوبونات (design handoff §8).
 *
 * Kept a separate screen from gift cards because the handoff insists — "منفصلة تماماً عن بطاقات
 * الهدايا" — and the distinction is financial, not cosmetic. A gift card is a liability: someone
 * paid, the balance is owed, and it carries forward. A coupon is a discount: nobody paid, it
 * reduces revenue at the moment of use and leaves no balance. One screen for both would put a
 * debt and a marketing expense in the same list.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
/*
  EIGHT tracks for eight columns.

  This had seven while the table had eight — I added «إجراء» and did not widen it, so the last
  column fell onto an implicit `auto` track and took whatever its content wanted. That is most of
  where the horizontal scrollbar came from.

  The date column is the narrowest it can be because its two dates now STACK; everything else is
  sized to its content rather than to a guess.
*/
const TEMPLATE = '.9fr .8fr .7fr .8fr .7fr .8fr .8fr .7fr';

export default async function CouponsPage({
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
  const refused = await refuseSection('coupons', t.nav.coupons);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('coupons', searchParams);

  const [result, counts, geo] = await Promise.all([
    getCoupons({ q, page, limit: size }),
    sidebarCounts(),
    /* For the fixed-value currency picker; a failed read must not take the registry down. */
    getGeography(),
  ]);

  const currencies =
    geo === 'unauthenticated' || geo === 'failed'
      ? [DEFAULT_MONEY_CURRENCY]
      : geo.currencies.map((entry) => entry.code);

  return (
    <ConsoleShell title={t.nav.coupons} counts={counts}>
      <ConsolePanel>
        {/*
          The toolbar is drawn by the FORM, which owns the state the trigger and the panel share —
          see `CouponsToolbar`. The «+ كوبون جديد» button was `aria-disabled` with `notBuilt`: the
          `COUPON_MANAGE` permission, the `coupons` table and that button were a feature that
          existed only in the data model.
        */}
        <CouponsToolbar
          action="/coupons"
          query={q}
          size={size}
          placeholder={t.sections.coupons.searchPlaceholder}
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
              rowKey={(row) => row.code}
              minWidth={680}
              empty={t.table.empty}
            />
            <TablePagination
              basePath="/coupons"
              section="coupons"
              query={{ q }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
          </>
        )}
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<CouponItem>[] = [
  {
    key: 'code',
    header: t.sections.giftcards.colCode,
    /*
      A coupon code IS public — it is printed in campaigns — so unlike a gift card code there is
      nothing to protect and showing it in full is correct.
    */
    /*
      And it WRAPS rather than overflowing (2026-08-27).

      The schema allows 4 to 40 characters, so no fixed track can be wide enough: `RACE588330621`
      is thirteen and needed 100px in an 81px column at 1024, spilling into «النوع» beside it.
      Widening the track only moves the ceiling — the next code is longer — and raising `minWidth`
      brings back the horizontal scrollbar Bashar asked to be rid of.

      `break-all` because a code is one unbroken Latin token: `break-words` has nowhere to break it
      and does nothing. Two short lines are legible; a code sitting on top of the type beside it is
      not. Found by `table-overflow.spec.ts` at 1024, which is the width that regresses silently.
    */
    render: (row) => <Ltr className="font-bold break-all text-sky">{row.code}</Ltr>,
  },
  {
    key: 'type',
    header: t.table.colType,
    render: (row) => (
      <span className="text-text2">
        {label(t.enums.couponType, row.type)}
        {row.scope ? <span className="text-faint"> ({row.scope})</span> : null}
      </span>
    ),
  },
  {
    key: 'discount',
    header: t.sections.coupons.colDiscount,
    render: (row) => (
      <Ltr className="font-bold whitespace-nowrap text-gold">
        {row.valueKind === 'percent'
          ? `${Number(row.value).toLocaleString('en-US')}${t.percentSign}`
          : amount(row.value, row.currency ?? DEFAULT_MONEY_CURRENCY)}
      </Ltr>
    ),
  },
  {
    key: 'min',
    header: t.sections.coupons.colMin,
    render: (row) => (
      <Ltr className="text-muted">
        {row.minBookingAmount === null
          ? t.admin.noData
          : amount(row.minBookingAmount, row.currency ?? DEFAULT_MONEY_CURRENCY)}
      </Ltr>
    ),
  },
  {
    key: 'usage',
    header: t.sections.coupons.colUsage,
    /* `∞` for an uncapped coupon, matching the design's own `412 / ∞`. */
    render: (row) => (
      <Ltr className="text-text2">
        {count(row.redemptionsCount)} /{' '}
        {row.maxRedemptions === null ? '∞' : count(row.maxRedemptions)}
      </Ltr>
    ),
  },
  {
    key: 'period',
    header: t.sections.coupons.colPeriod,
    /*
      The two dates STACK rather than sitting on one line.

      `2026-08-27 ← 2026-09-26` with `whitespace-nowrap` is the widest cell in the table by a long
      way, and it was forcing the whole grid past the panel. Stacked, the column needs about half
      the width and each date is still read as a date.
    */
    render: (row) => (
      <div className="grid gap-0.5">
        <Ltr className="text-muted">{shortDate(row.startsAt)}</Ltr>
        <Ltr className="text-[10.5px] text-faint">{shortDate(row.endsAt)}</Ltr>
      </div>
    ),
  },
  {
    /*
      Pausing a campaign. Not offered on an EXPIRED coupon: switching one on changes nothing a
      customer can use, and a control that does nothing suggests otherwise. The API refuses the
      same way, so this is a courtesy rather than the guard.
    */
    key: 'action',
    header: t.table.colAction,
    render: (row) =>
      row.expired ? (
        <span className="text-faint">{t.admin.noData}</span>
      ) : (
        <CouponActiveToggle code={row.code} isActive={row.isActive} />
      ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row) => <StatusPill tone={tone(row)}>{statusLabel(row)}</StatusPill>,
  },
];

/**
 * A coupon's state is derived, not stored.
 *
 * `is_active` is the operator's switch; the window is the calendar. A coupon can be switched on
 * and still be expired, and showing "نشط" for one would send somebody looking for a bug in
 * checkout. Expiry wins.
 */
function statusLabel(row: CouponItem): string {
  if (row.expired) return label(t.enums.couponStatus, 'expired');
  if (!row.isActive) return label(t.enums.couponStatus, 'suspended');

  return label(t.enums.couponStatus, 'active');
}

function tone(row: CouponItem): Tone {
  if (row.expired) return 'faint';
  if (!row.isActive) return 'bad';

  return 'ok';
}
