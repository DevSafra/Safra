import Link from 'next/link';

import { renderRedactions } from '@safra/i18n';

import { getDisputes, type DisputeItem, type Disputes } from '@/lib/api';
import { sidebarCounts } from '@/lib/console';
import { amount, count, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell, Kpi, KpiRow } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { FootNote, Ltr, StatusPill } from '@/components/admin-table';
import { TableToolbar } from '@/components/table-toolbar';
import { CloseDisputeForm } from '@/components/close-dispute-form';
import { DisputeEvidence } from '@/components/dispute-evidence';
import { AcknowledgeDisputeButton } from '@/components/acknowledge-dispute-button';
import { label, t, plural } from '@/lib/strings';
import { statusTone } from '@/lib/status-tone';
import { oneOf } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';
import { refuseSection } from '@/components/section-refusal';

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

/** The dispute vocabulary — the filter's options and the values a URL may carry, from one list. */
const DISPUTE_STATUSES = ['open', 'investigating', 'resolved', 'rejected'] as const;

export default async function DisputesPage({
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
  const refused = await refuseSection('disputes', t.nav.disputes);

  if (refused) return refused;

  const { q, page, size } = await listParamsFor('disputes', searchParams);
  const params = await searchParams;
  /*
    Checked against THIS section's vocabulary, which is not the bookings one. It used to pass
    whatever the URL said straight to the API, whose `.strict()` enum answers 400 — and the console
    renders that as «تعذّر تحميل القائمة», a screen with no table. A status is something a person
    types or keeps in a bookmark, so an unrecognised one drops to "all" (see `oneOf`).
  */
  const status = oneOf(params['status'], DISPUTE_STATUSES);

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
                {DISPUTE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {label(t.enums.disputeStatus, value)}
                  </option>
                ))}
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
              section="disputes"
              query={{ q, status }}
              page={result.page}
              pages={result.pages}
              total={result.total}
              capped={result.capped}
              size={size}
            />
            {/*
              The reported-review queue lives beside this one: both are complaints about what
              somebody said, and both are answered by the same people.
            */}
            <FootNote>
              <Link
                href="/reviews"
                className="inline-flex min-h-10 items-center font-semibold text-gold underline-offset-2 hover:underline lg:min-h-0"
              >
                {t.sections.reviewModeration.title}
              </Link>
            </FootNote>
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
              /*
                ── indigo, not amber (2026-08-27) ──────────────────────────────

                «المستحقات مجمّدة» is not a status — it is a property of the booking's money — but
                it is drawn as a pill on a screen that also draws the four dispute statuses, and
                «One status, one word, one colour» forbids two pills sharing a colour there.

                It was `warn`, which was safe only because `investigating` could never happen:
                nothing wrote that status. «استلام» gave it a writer, «قيد المراجعة» is `warn` too,
                and `navigation.spec.ts` failed the same hour — «المستحقات مجمّدة / قيد المراجعة
                are all rgb(232, 165, 75)». The rule earning its keep on the first screen to test it.

                Indigo because the four statuses hold crimson, amber, green and red, and because a
                held payout reads as cold rather than as an alarm. Same shape as the sanctions pill
                on الشركاء, which takes teal/orange for exactly this reason.
              */
              <StatusPill tone="indigo">{t.sections.disputes.frozen}</StatusPill>
            ) : null}
          </div>

          {/* The title is redacted on the way in, so it is rendered on the way out. */}
          <p className="mt-1.5 text-[13px] font-semibold text-text">
            {renderRedactions(dispute.title, 'ar')}
          </p>

          {/*
            ── what the person actually SAID (2026-08-27) ─────────────────────

            The title is 120 characters and is the headline; this is the account. It was stored on
            both routes — the customer's own words through the app, and what a staff member takes
            down over the phone — and displayed nowhere: the queue showed the title, the booking
            screen showed a count. So the decision to uphold a complaint, release a frozen payout
            and credit a wallet was taken from a headline.

            «الغرفة لم تطابق الوصف المنشور» was the title on DSP-010142. That the room faced the
            car park rather than the advertised garden was in the description, unread.

            Redacted on the way IN like every stored message, so it is rendered the way the title
            is — the masks are markers in the stored text, not something applied here.
          */}
          {dispute.description ? (
            <p
              /* Marked so the browser sweep can find the account and nothing else. */
              data-dispute-account={dispute.reference}
              className="mt-1.5 text-[12px] leading-relaxed whitespace-pre-line text-text2"
            >
              {renderRedactions(dispute.description, 'ar')}
            </p>
          ) : null}

          {/* Back from the booking returns to النزاعات, the list the reader is actually in. */}
          <p className="mt-1 text-[11.5px] text-faint">
            {dispute.bookingReference ? (
              <Link
                href={`/bookings/${dispute.bookingReference}?from=disputes`}
                className="text-sky hover:underline"
              >
                <Ltr>{dispute.bookingReference}</Ltr>
              </Link>
            ) : null}
            {dispute.customer ? ` · ${dispute.customer}` : ''}
            {dispute.partner ? ` · ${dispute.partner}` : ''}
            {dispute.evidenceCount > 0
              ? ` · ${plural(t.sections.disputes.evidence, { n: dispute.evidenceCount })}`
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

      {/*
        «استلام» beside the close workflow, and only while nobody has taken it.

        Both live on the card rather than behind a separate screen: an operator works down this
        queue, and the two things they do to a dispute are take it and settle it.
      */}
      {dispute.status === 'open' ? (
        <div className="mt-3">
          <AcknowledgeDisputeButton reference={dispute.reference} />
        </div>
      ) : null}

      {/*
        The evidence, and the control that adds to it — above the close form, because it is what the
        decision is made FROM.
      */}
      <DisputeEvidence
        reference={dispute.reference}
        closed={closed}
        evidence={dispute.evidence}
      />

      {/* The close workflow lives on the card, not behind a separate screen. */}
      {closed ? null : <CloseDisputeForm reference={dispute.reference} />}
    </article>
  );
}
