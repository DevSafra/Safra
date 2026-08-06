import { getCoupons, type CouponItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count, money, shortDate } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import {
  AdminTable,
  Ltr,
  StatusPill,
  type AdminColumn,
  type Tone,
} from '@/components/admin-table';
import { TableToolbar, ToolbarNote } from '@/components/table-toolbar';
import { t, label } from '@/lib/strings';
import { listParamsFor } from '@/lib/table-size';

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
const TEMPLATE = '1fr .9fr .7fr .9fr .9fr 1.1fr .8fr';

export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, page, size } = await listParamsFor('coupons', searchParams);

  const [result, counts] = await Promise.all([
    getCoupons({ q, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.coupons} counts={counts}>
      <ConsolePanel>
        <TableToolbar
          action="/coupons"
          query={q}
          size={size}
          placeholder={t.sections.coupons.searchPlaceholder}
          end={
            <>
              <ToolbarNote>{t.sections.coupons.hint}</ToolbarNote>
              <span
                aria-disabled="true"
                title={t.nav.notBuilt}
                className="cursor-not-allowed rounded-[9px] border border-line px-4 py-1.5 text-[12.5px] font-extrabold text-faint2"
              >
                {t.sections.coupons.create}
              </span>
            </>
          }
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
              minWidth={760}
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
    render: (row) => <Ltr className="font-bold text-sky">{row.code}</Ltr>,
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
          : `${money(row.value)} ${row.currency ?? ''}`}
      </Ltr>
    ),
  },
  {
    key: 'min',
    header: t.sections.coupons.colMin,
    render: (row) => (
      <Ltr className="text-muted">
        {row.minBookingAmount === null ? t.admin.noData : money(row.minBookingAmount)}
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
    render: (row) => (
      <Ltr className="whitespace-nowrap text-muted">
        {shortDate(row.startsAt)} ← {shortDate(row.endsAt)}
      </Ltr>
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
