import Link from 'next/link';

import { getPartnerRegistry, getPendingPartners, type PartnerListItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count } from '@/lib/format';
import { ConsolePanel, ConsoleShell, QueueState } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { ContractsCard } from '@/components/contracts-card';
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
import { fill, label, t } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { returnQuery } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';

/**
 * الشركاء (design handoff §8, §8.1).
 *
 * Three cards, in the design's order:
 *
 * 1. the partner registry with Score and التصنيف;
 * 2. عقود الشراكة — the contract upload, which has no table yet;
 * 3. the P-002 verification queue.
 *
 * ## Score leads the table for a reason
 *
 * It is the number that decides a partner's position in "موصى به من سفرة", so an operator needs
 * it before opening anybody. The design's colour ladder is reproduced exactly (≥80 ok, ≥60 warn,
 * below that bad) — the thresholds are the handoff's, not invented here.
 */
export const dynamic = 'force-dynamic';

/** The design's `grid-template-columns`, verbatim. */
const TEMPLATE = '1fr 1.4fr .9fr .9fr .9fr .8fr 1fr .9fr';

export default async function PartnersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, page, size } = await listParamsFor('partners', searchParams);
  /*
    The QUEUE's own place in its own list, read from its own parameters.

    Two paged lists on one route, so the queue namespaces to `?queuePage=`/`?queueSize=` — sharing
    `?page=` would make paging the registry move the queue underneath the reader. Same arrangement
    as the scope map on /staff.
  */
  const queue = await listParamsFor('partnersPending', searchParams);

  // Carried into every row link, so «رجوع» on the detail screen comes back here.
  const back = returnQuery({ page, size, q });

  const [registry, pending, counts] = await Promise.all([
    getPartnerRegistry({ q, page, limit: size }),
    getPendingPartners({ page: queue.page, limit: queue.size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.partners} subtitle={t.partners.subtitle} counts={counts}>
      <div className="grid gap-4">
        <ConsolePanel title={t.sections.partners.title}>
          {/*
            تسجيل شريك جديد — the way in to the in-person flow (Bashar, 2026-08-23).

            On the registry card rather than in the page header, because it belongs to «الشركاء»
            and not to the screen: the header already carries the section title, the date and the
            role, and a phone cannot hold a fourth thing on that line — the wrap read as two
            headers the last time something was added there.

            An anchor styled as a control needs `inline-flex min-h-10` below `lg`: `min-height`
            does nothing to an inline element, so the global 40px touch floor cannot reach it.
          */}
          <div className="mb-3 flex justify-end">
            <Link
              href="/partners/new"
              className="inline-flex min-h-10 items-center rounded-lg border border-ok/40 px-4 py-2 text-[12.5px] font-semibold text-ok hover:bg-ok/5 lg:min-h-0"
            >
              {t.sections.partners.onboard}
            </Link>
          </div>

          <TableToolbar
            action="/partners"
            query={q}
            size={size}
            placeholder={t.sections.partners.searchPlaceholder}
          />

          {registry === 'unauthenticated' ? (
            <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
          ) : registry === 'failed' ? (
            <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
          ) : (
            <>
              <AdminTable
                columns={columns(back)}
                rows={registry.items}
                template={TEMPLATE}
                rowKey={(row) => row.reference}
                minWidth={860}
                empty={t.table.empty}
              />
              <TablePagination
                basePath="/partners"
                section="partners"
                query={{ q }}
                page={registry.page}
                pages={registry.pages}
                total={registry.total}
                capped={registry.capped}
                size={size}
              />
            </>
          )}

          <FootNote>{t.sections.partners.note}</FootNote>
        </ConsolePanel>

        {/*
          عقود الشراكة. Backed by `partner_contracts` since 2026-08-04 — the upload supersedes the
          previous contract of the same kind rather than overwriting it, because which terms were
          in force on the day of a disputed booking is a question that gets asked.
        */}
        <ContractsCard />

        <ConsolePanel title={t.sections.partners.pendingTitle}>
          <QueueState state={pending}>
            {(rows) =>
              rows.map((partner) => (
                <li key={partner.reference}>
                  <Link
                    href={`/partners/${partner.reference}${back}`}
                    className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-field px-3.5 py-3 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-text">
                        {partner.legalName}
                      </span>
                      <span className="block text-[11px] text-faint">
                        <Ltr>{partner.reference}</Ltr> · {partner.city.nameAr} ·{' '}
                        {partner.documents.length} {t.dashboard.documents}
                      </span>
                    </span>

                    {/*
                      Screening state in the QUEUE, not only on the detail page. It is the one
                      precondition a reviewer cannot satisfy by reading documents, so seeing it
                      before opening a row is what stops a queue of unscreenable applications
                      building up unnoticed.
                    */}
                    <span className="ms-auto shrink-0">
                      {/*
                        Teal and orange rather than green and amber. الشركاء draws three kinds of
                        pill at once — verification, contract, screening — and «تم الفحص» came out
                        the same green as an in-force contract, so two unrelated facts looked like
                        one signal (Bashar, 2026-08-06). Neither colour is used by the other two
                        vocabularies on this screen.
                      */}
                      <StatusPill tone={partner.sanctionsScreenedAt ? 'teal' : 'orange'}>
                        {partner.sanctionsScreenedAt
                          ? t.dashboard.screened
                          : t.dashboard.notScreened}
                      </StatusPill>
                    </span>
                  </Link>
                </li>
              ))
            }
          </QueueState>

          {pending === 'failed' || pending === 'unauthenticated' ? null : (
            <TablePagination
              basePath="/partners"
              section="partnersPending"
              query={{ q }}
              page={pending.page}
              pages={pending.pages}
              total={pending.total}
              capped={pending.capped}
              size={queue.size}
              /*
                NAMED, because الشركاء now carries two paged lists.

                Two navigation landmarks with the same accessible name is the defect
                `paginationLabelOf` exists for — a screen-reader user listing the page's regions
                hears «تنقّل بين الصفحات» twice and cannot tell which table either one moves. The
                registry's bar keeps the plain name; the second one names itself, exactly as the
                scope map on /staff does.
              */
              label={fill(t.table.paginationLabelOf, {
                section: t.sections.partners.pendingTitle,
              })}
            />
          )}

          <FootNote>{t.admin.pendingPartnersNote}</FootNote>
        </ConsolePanel>
      </div>
    </ConsoleShell>
  );
}

/**
 * Built per request rather than as a constant, so every row link carries the reader's place in the
 * list — see `returnQuery`. Opening a partner from page 4 of a filtered search and coming back to
 * the top of an unfiltered registry is the failure this exists to prevent (Bashar, 2026-08-05).
 */
const columns = (back: string): readonly AdminColumn<PartnerListItem>[] => [
  {
    key: 'reference',
    header: t.table.colId,
    render: (row) => (
      <Link
        href={`/partners/${row.reference}${back}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'partner',
    header: t.sections.partners.colPartner,
    /*
      Legal name first, display name below. They differ often — "وليد بركات" trades as "شقق
      الميناء" — and a contract or a sanctions check is against the legal entity, so that is the
      one an operator must see first.
    */
    render: (row) => (
      <span className="min-w-0">
        <span className="block truncate font-semibold text-text">{row.legalName}</span>
        {row.displayName !== row.legalName ? (
          <span className="block truncate text-[10.5px] text-faint">
            {row.displayName}
          </span>
        ) : null}
      </span>
    ),
  },
  {
    key: 'type',
    header: t.table.colType,
    render: (row) => <span className="text-text2">{row.partnerType}</span>,
  },
  {
    key: 'city',
    header: t.table.colCity,
    render: (row) => <span className="text-muted">{row.city}</span>,
  },
  {
    key: 'score',
    header: t.sections.partners.colScore,
    /* The handoff's ladder: ≥80 ok, ≥60 warn, below that bad. */
    render: (row) => (
      <ToneText tone={scoreTone(row.score)}>
        <Ltr>{count(row.score)}</Ltr>
      </ToneText>
    ),
  },
  {
    key: 'tier',
    header: t.sections.partners.colTier,
    render: (row) => (
      <ToneText tone={tierTone(row.tier)}>
        {label(t.enums.partnerTier, row.tier)}
      </ToneText>
    ),
  },
  {
    key: 'status',
    header: t.table.colStatus,
    /*
      Suspension outranks verification: an approved partner who is suspended is not trading, and
      showing "معتمد" for them would be true and useless.
    */
    render: (row) =>
      row.suspended ? (
        <StatusPill tone="bad">{t.sections.partners.suspended}</StatusPill>
      ) : (
        <StatusPill tone={statusTone(row.verification)}>
          {label(t.enums.verification, row.verification)}
        </StatusPill>
      ),
  },
  {
    key: 'action',
    header: t.table.colAction,
    render: (row) => (
      <Link
        href={`/partners/${row.reference}${back}`}
        className="text-[11.5px] text-sky hover:underline"
      >
        {t.table.manage}
      </Link>
    ),
  },
];

function scoreTone(score: number): Tone {
  if (score >= 80) return 'ok';
  if (score >= 60) return 'warn';

  return 'bad';
}

function tierTone(tier: string): Tone {
  switch (tier) {
    case 'gold':
      return 'gold';
    case 'silver':
      return 'faint';
    default:
      // `new` and `needs_improvement` both mean "not yet proven".
      return 'warn';
  }
}
