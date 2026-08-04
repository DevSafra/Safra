import Link from 'next/link';

import { getPartnerRegistry, getPendingPartners, type PartnerListItem } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { count } from '@/lib/format';
import {
  ConsolePanel,
  ConsoleShell,
  Pager,
  QueueState,
} from '@/components/console-shell';
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
import { AR, label } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

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
  const { q, cursor } = await listParams(searchParams);

  const [registry, pending, counts] = await Promise.all([
    getPartnerRegistry({ q, cursor }),
    getPendingPartners(),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={AR.nav.partners} subtitle={AR.partners.subtitle} counts={counts}>
      <div className="grid gap-4">
        <ConsolePanel title={AR.sections.partners.title}>
          <TableToolbar
            action="/partners"
            query={q}
            placeholder={AR.sections.partners.searchPlaceholder}
          />

          {registry === 'unauthenticated' ? (
            <p className="text-[12.5px] text-muted">{AR.dashboard.sessionExpired}</p>
          ) : registry === 'failed' ? (
            <p className="text-[12.5px] text-bad">{AR.dashboard.queueFailed}</p>
          ) : (
            <>
              <AdminTable
                columns={COLUMNS}
                rows={registry.items}
                template={TEMPLATE}
                rowKey={(row) => row.reference}
                minWidth={860}
                empty={AR.table.empty}
              />
              <Pager
                basePath="/partners"
                query={{ q }}
                nextCursor={registry.nextCursor}
              />
            </>
          )}

          <FootNote>{AR.sections.partners.note}</FootNote>
        </ConsolePanel>

        {/*
          عقود الشراكة. Backed by `partner_contracts` since 2026-08-04 — the upload supersedes the
          previous contract of the same kind rather than overwriting it, because which terms were
          in force on the day of a disputed booking is a question that gets asked.
        */}
        <ContractsCard />

        <ConsolePanel title={AR.sections.partners.pendingTitle}>
          <QueueState state={pending}>
            {(rows) =>
              rows.map((partner) => (
                <li key={partner.reference}>
                  <Link
                    href={`/partners/${partner.reference}`}
                    className="flex flex-wrap items-center gap-3 rounded-[10px] border border-line bg-field px-3.5 py-3 transition-colors hover:border-[rgba(var(--goldA),0.4)]"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-text">
                        {partner.legalName}
                      </span>
                      <span className="block text-[11px] text-faint">
                        <Ltr>{partner.reference}</Ltr> · {partner.city.nameAr} ·{' '}
                        {partner.documents.length} {AR.dashboard.documents}
                      </span>
                    </span>

                    {/*
                      Screening state in the QUEUE, not only on the detail page. It is the one
                      precondition a reviewer cannot satisfy by reading documents, so seeing it
                      before opening a row is what stops a queue of unscreenable applications
                      building up unnoticed.
                    */}
                    <span className="ms-auto shrink-0">
                      <StatusPill tone={partner.sanctionsScreenedAt ? 'ok' : 'warn'}>
                        {partner.sanctionsScreenedAt
                          ? AR.dashboard.screened
                          : AR.dashboard.notScreened}
                      </StatusPill>
                    </span>
                  </Link>
                </li>
              ))
            }
          </QueueState>

          <FootNote>{AR.admin.pendingPartnersNote}</FootNote>
        </ConsolePanel>
      </div>
    </ConsoleShell>
  );
}

const COLUMNS: readonly AdminColumn<PartnerListItem>[] = [
  {
    key: 'reference',
    header: AR.table.colId,
    render: (row) => (
      <Link
        href={`/partners/${row.reference}`}
        className="font-semibold text-sky hover:underline"
      >
        <Ltr>{row.reference}</Ltr>
      </Link>
    ),
  },
  {
    key: 'partner',
    header: AR.sections.partners.colPartner,
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
    header: AR.table.colType,
    render: (row) => <span className="text-text2">{row.partnerType}</span>,
  },
  {
    key: 'city',
    header: AR.table.colCity,
    render: (row) => <span className="text-muted">{row.city}</span>,
  },
  {
    key: 'score',
    header: AR.sections.partners.colScore,
    /* The handoff's ladder: ≥80 ok, ≥60 warn, below that bad. */
    render: (row) => (
      <ToneText tone={scoreTone(row.score)}>
        <Ltr>{count(row.score)}</Ltr>
      </ToneText>
    ),
  },
  {
    key: 'tier',
    header: AR.sections.partners.colTier,
    render: (row) => (
      <ToneText tone={tierTone(row.tier)}>
        {label(AR.enums.partnerTier, row.tier)}
      </ToneText>
    ),
  },
  {
    key: 'status',
    header: AR.table.colStatus,
    /*
      Suspension outranks verification: an approved partner who is suspended is not trading, and
      showing "معتمد" for them would be true and useless.
    */
    render: (row) =>
      row.suspended ? (
        <StatusPill tone="bad">موقوف مؤقتاً</StatusPill>
      ) : (
        <StatusPill tone={verificationTone(row.verification)}>
          {label(AR.enums.verification, row.verification)}
        </StatusPill>
      ),
  },
  {
    key: 'action',
    header: AR.table.colAction,
    render: (row) => (
      <Link
        href={`/partners/${row.reference}`}
        className="text-[11.5px] text-sky hover:underline"
      >
        {AR.table.manage}
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

function verificationTone(verification: string): Tone {
  switch (verification) {
    case 'approved':
      return 'ok';
    case 'rejected':
      return 'bad';
    case 'in_review':
      return 'sky';
    default:
      return 'warn';
  }
}
