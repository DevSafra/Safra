import Link from 'next/link';

import { getDisputes, type DisputeItem, type Disputes } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Kpi, KpiRow } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { FootNote, Ltr, StatusPill, type Tone } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { CloseDisputeForm } from '@/components/close-dispute-form';
import { fill, label, t } from '@/lib/strings';
import { listParams } from '@/lib/search-params';

/**
 * النزاعات — disputes (design handoff §8).
 *
 * ## Cards, not a table
 *
 * The one section the design does NOT draw as a grid, and it is right: a dispute is a paragraph of
 * context, not a row of fields. The EC tag, the title, the booking, the customer, the evidence
 * count and the age all have to be readable at once to decide what to pick up next.
 *
 * ## The payout freeze is stated on every card it applies to
 *
 * "فتح النزاع يجمّد استحقاق تحويل الشريك" is the rule with money attached, and it is the one an
 * operator forgets. Each unresolved dispute says so explicitly rather than leaving it to the
 * footnote, because a footnote is read once and a badge is read every time.
 */
export const dynamic = 'force-dynamic';

export default async function DisputesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { q, page, size } = await listParams(searchParams);
  const params = await searchParams;
  const rawStatus = params['status'];
  const status =
    (Array.isArray(rawStatus) ? rawStatus[0] : rawStatus)?.trim() || undefined;

  const [result, counts] = await Promise.all([
    getDisputes({ q, status, page, limit: size }),
    sidebarCounts(),
  ]);

  return (
    <ConsoleShell title={t.nav.disputes} counts={counts}>
      {result === 'unauthenticated' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
        </ConsolePanel>
      ) : result === 'failed' ? (
        <ConsolePanel>
          <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
        </ConsolePanel>
      ) : (
        <div className="grid gap-4">
          <Counters counters={result.counters} />

          <ConsolePanel>
            <TableToolbar
              action="/disputes"
              query={q}
              size={size}
              placeholder={t.sections.disputes.searchPlaceholder}
            >
              <select
                name="status"
                defaultValue={status ?? ''}
                aria-label={t.table.colStatus}
                className="cursor-pointer rounded-[9px] border border-line bg-field px-3 py-2 text-[12.5px] text-text"
              >
                <option value="">{t.sections.bookings.allStatuses}</option>
                {(['open', 'investigating', 'resolved', 'rejected'] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {label(t.enums.disputeStatus, value)}
                    </option>
                  ),
                )}
              </select>
            </TableToolbar>

            {result.items.length === 0 ? (
              <p className="text-[12.5px] text-faint">{t.table.empty}</p>
            ) : (
              <div className="grid gap-3">
                {result.items.map((dispute) => (
                  <DisputeCard key={dispute.reference} dispute={dispute} />
                ))}
              </div>
            )}

            <TablePagination
              basePath="/disputes"
              query={{ q, status }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
            <FootNote>{t.sections.disputes.note}</FootNote>
          </ConsolePanel>
        </div>
      )}
    </ConsoleShell>
  );
}

function Counters({ counters }: { counters: Disputes['counters'] }) {
  return (
    <KpiRow label={t.nav.disputes}>
      <Kpi
        label={t.sections.disputes.kpiOpen}
        value={count(counters.open)}
        valueClass={counters.open > 0 ? 'text-bad' : 'text-text'}
      />
      <Kpi
        label={t.sections.disputes.kpiInvestigating}
        value={count(counters.investigating)}
        valueClass="text-warn"
      />
      <Kpi
        label={t.sections.disputes.kpiOldest}
        /* A dash when nothing is open — never a zero, which reads as "opened just now". */
        value={
          counters.oldestOpenHours === null
            ? t.admin.noData
            : `${count(counters.oldestOpenHours)} ${t.sections.disputes.hours}`
        }
        valueClass={
          counters.oldestOpenHours !== null && counters.oldestOpenHours > 24
            ? 'text-bad'
            : 'text-text'
        }
      />
      <Kpi
        label={t.sections.disputes.kpiFrozen}
        value={count(counters.frozenPayouts)}
        valueClass={counters.frozenPayouts > 0 ? 'text-warn' : 'text-text'}
        sub={t.sections.disputes.kpiFrozenSub}
      />
      <Kpi
        label={t.sections.disputes.kpiResolved}
        value={count(counters.resolvedThisMonth)}
        valueClass="text-ok"
      />
    </KpiRow>
  );
}

function DisputeCard({ dispute }: { dispute: DisputeItem }) {
  const closed = dispute.closedAt !== null;

  return (
    <article
      /* The design's card: bad-tinted border, 14px radius. */
      className={`rounded-[14px] border bg-card p-4 ${
        closed ? 'border-line' : 'border-[rgba(var(--badA),0.35)]'
      }`}
    >
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <Ltr className="font-bold text-sky">{dispute.reference}</Ltr>
            {/* The EC code, in the design's small square tag. */}
            <span className="rounded bg-[rgba(var(--badA),0.14)] px-2 py-0.5 text-[10px] font-extrabold text-bad">
              {label(t.enums.disputeKind, dispute.kind)}
            </span>
            {dispute.freezesPayout ? (
              <StatusPill tone="warn">{t.sections.disputes.frozen}</StatusPill>
            ) : null}
          </div>

          <p className="mt-1.5 text-[13px] font-semibold text-text">{dispute.title}</p>

          <p className="mt-1 text-[11.5px] text-faint">
            {dispute.bookingReference ? (
              <Link
                href={`/bookings/${dispute.bookingReference}`}
                className="text-sky hover:underline"
              >
                <Ltr>{dispute.bookingReference}</Ltr>
              </Link>
            ) : null}
            {dispute.customer ? ` · ${dispute.customer}` : ''}
            {dispute.partner ? ` · ${dispute.partner}` : ''}
            {dispute.evidenceCount > 0
              ? ` · ${fill(t.sections.disputes.evidence, { n: count(dispute.evidenceCount) })}`
              : ''}
          </p>

          {/* The resolution, once closed. It is the whole point of requiring one. */}
          {dispute.resolution ? (
            <p className="mt-2 rounded-[10px] border border-line bg-field px-3 py-2 text-[11.5px] leading-relaxed text-text2">
              {dispute.resolution}
              {dispute.compensationAmount && dispute.compensationCurrency ? (
                <span className="ms-1.5 font-bold text-gold">
                  <Ltr>
                    {amount(dispute.compensationAmount, dispute.compensationCurrency)}
                  </Ltr>
                </span>
              ) : null}
            </p>
          ) : null}
        </div>

        <div className="ms-auto flex shrink-0 flex-col items-end gap-2">
          <StatusPill tone={statusTone(dispute.status)}>
            {label(t.enums.disputeStatus, dispute.status)}
          </StatusPill>
          <Ltr className="text-[11px] text-faint">
            {closed ? shortDateTime(dispute.closedAt) : `${count(dispute.ageHours)}h`}
          </Ltr>
        </div>
      </div>

      {/* The close workflow lives on the card, not behind a separate screen. */}
      {closed ? null : <CloseDisputeForm reference={dispute.reference} />}
    </article>
  );
}

function statusTone(status: string): Tone {
  switch (status) {
    case 'open':
      return 'bad';
    case 'investigating':
      return 'warn';
    case 'resolved':
      return 'ok';
    default:
      return 'faint';
  }
}
