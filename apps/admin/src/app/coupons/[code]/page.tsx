import Link from 'next/link';

import { BackLink } from '@/components/back-link';
import { AdminTable, StatusPill } from '@/components/admin-table';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { TableToolbar } from '@/components/table-toolbar';
import { getCouponPartners, type CouponPartner } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { refuseSection } from '@/components/section-refusal';
import { backTarget, listParams } from '@/lib/search-params';
import { statusTone } from '@/lib/status-tone';

import { groupCount } from './group-count';
import { shortDate } from '@/lib/format';
import { label, t } from '@/lib/strings';

/**
 * One coupon's adoption — who took it up, who refused, who has not answered.
 *
 * ## Why this screen exists
 *
 * Bashar (2026-09-01): «allow SAFRA operators to quickly understand coupon adoption and follow up
 * with partners who have not yet responded». A coupon does nothing on a partner's listings until
 * they accept, so «is this campaign live?» is not a property of the coupon — it is a count of the
 * partners behind it, and there was nowhere to read it.
 *
 * ## The three counts describe the COUPON, the table describes the filter
 *
 * The totals ignore the status filter and the search on purpose. An operator asks «how is it
 * going» and then «who do I chase», and a count that only described the rows currently on screen
 * would answer the first question with the answer to the second.
 */
export const dynamic = 'force-dynamic';

const TEMPLATE = '1.4fr 1fr .8fr 1fr';

export default async function CouponParticipationPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ code: string }>;
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const refused = await refuseSection('coupons', t.nav.coupons);

  if (refused) return refused;

  const { code } = await params;
  const query = await searchParams;
  const { page, size, q } = await listParams(Promise.resolve(query));

  const raw = query['status'];
  const chosen = Array.isArray(raw) ? raw[0] : raw;
  /*
    An ALLOW-LIST, not whatever the URL carries. It reaches the API as a status filter and the API
    casts it to an enum; anything else is dropped here rather than turned into a refusal there.
  */
  const status =
    chosen === 'pending' || chosen === 'accepted' || chosen === 'rejected'
      ? chosen
      : undefined;

  const [result, counts] = await Promise.all([
    getCouponPartners(code, { page, limit: size, q, status }),
    sidebarCounts(),
  ]);

  const back = backTarget('/coupons', query, code);

  if (result === 'unauthenticated' || result === 'failed') {
    return (
      <ConsoleShell title={t.nav.coupons} counts={counts}>
        <ConsolePanel>
          <BackLink target={back} section={t.nav.coupons} />
          <p className="mt-3 text-[12.5px] text-muted">
            {result === 'unauthenticated'
              ? t.dashboard.sessionExpired
              : t.errors.unreachable}
          </p>
        </ConsolePanel>
      </ConsoleShell>
    );
  }

  const c = t.sections.coupons;
  const groups = [
    { key: undefined, label: c.allPartners, n: null },
    {
      key: 'pending' as const,
      label: label(t.enums.couponPartnerStatus, 'pending'),
      n: result.counts.pending,
    },
    {
      key: 'accepted' as const,
      label: label(t.enums.couponPartnerStatus, 'accepted'),
      n: result.counts.accepted,
    },
    {
      key: 'rejected' as const,
      label: label(t.enums.couponPartnerStatus, 'rejected'),
      n: result.counts.rejected,
    },
  ];

  /** Every filter this screen carries, so paging and searching keep the others. */
  const carry = {
    ...(q ? { q } : {}),
    ...(status ? { status } : {}),
    size: String(size),
  };

  return (
    <ConsoleShell title={t.nav.coupons} counts={counts}>
      <ConsolePanel>
        <BackLink target={back} section={t.nav.coupons} />

        <h2 className="mt-3 font-mono text-[15px] font-extrabold text-gold-ink">
          {code}
        </h2>
        <h3 className="mt-1 text-[13px] font-bold text-text">{c.participationTitle}</h3>
        <p className="mt-1 text-[12px] leading-relaxed text-faint2">
          {c.participationNote}
        </p>

        {/*
          The three totals as FILTERS, not as decoration. The number and the way to see the rows
          behind it are the same control, because an operator who reads «12 بانتظار الرد» wants
          those twelve next.
        */}
        <nav className="mt-3 flex flex-wrap gap-2">
          {groups.map((group) => {
            const href = new URLSearchParams({
              ...(q ? { q } : {}),
              ...(group.key ? { status: group.key } : {}),
              size: String(size),
            });
            const active = status === group.key;

            return (
              <Link
                key={group.label}
                href={`/coupons/${encodeURIComponent(code)}?${href.toString()}`}
                {...(group.key ? { 'data-participation-count': group.key } : {})}
                className={`inline-flex min-h-10 items-center gap-2 rounded-lg border px-3.5 py-2 text-[12px] font-bold transition-colors lg:min-h-0 ${
                  active
                    ? 'border-[rgba(var(--goldA),0.5)] bg-[rgba(var(--goldA),0.1)] text-gold-ink'
                    : 'border-line text-muted hover:text-text'
                }`}
              >
                {group.label}
                {group.n === null ? null : (
                  <span className="text-[11px] text-faint">{groupCount(group.n)}</span>
                )}
              </Link>
            );
          })}
        </nav>

        <div className="mt-4">
          <TableToolbar
            action={`/coupons/${encodeURIComponent(code)}`}
            query={q}
            size={size}
            placeholder={c.searchPartners}
            /* The status filter travels with the search, or searching drops the group. */
            {...(status ? { carry: { status } } : {})}
          />
        </div>

        <AdminTable
          columns={COLUMNS}
          rows={[...result.partners.items]}
          template={TEMPLATE}
          rowKey={(row) => row.reference}
          minWidth={640}
          empty={c.partnersEmpty}
        />

        <TablePagination
          basePath={`/coupons/${encodeURIComponent(code)}`}
          section="coupons"
          query={carry}
          page={result.partners.page}
          pages={result.partners.pages}
          total={result.partners.total}
          capped={result.partners.capped}
          size={size}
        />
      </ConsolePanel>
    </ConsoleShell>
  );
}

const COLUMNS = [
  {
    key: 'partner',
    header: t.sections.coupons.colPartner,
    render: (row: CouponPartner) => (
      <span className="grid">
        <span className="truncate font-semibold text-text">{row.partner}</span>
        <span className="font-mono text-[10.5px] text-faint">{row.reference}</span>
      </span>
    ),
  },
  {
    key: 'city',
    header: t.sections.coupons.colCity,
    render: (row: CouponPartner) => (
      <span className="text-text2">{row.city ?? t.admin.noData}</span>
    ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    render: (row: CouponPartner) => (
      /* `statusTone`, never a colour chosen here — one status is one colour everywhere. */
      <StatusPill tone={statusTone(row.status)}>
        {label(t.enums.couponPartnerStatus, row.status)}
      </StatusPill>
    ),
  },
  {
    key: 'decided',
    header: t.sections.coupons.colDecidedAt,
    /* «لم يردّ بعد» rather than a dash: the absence is the thing being followed up. */
    render: (row: CouponPartner) => (
      <span className={row.decidedAt ? 'text-text2' : 'text-faint'}>
        {row.decidedAt ? shortDate(row.decidedAt) : t.sections.coupons.noResponse}
      </span>
    ),
  },
];
