import { getPartner, getPartnerViolations, type Violation } from '@/lib/api';
import { readerPermissions } from '@/lib/gate';
import { sidebarCounts } from '@/lib/console';
import { amount, shortDateTime } from '@/lib/format';
import { ConsolePanel, ConsoleShell } from '@/components/console-shell';
import { TablePagination } from '@/components/table-pagination';
import { BackLink } from '@/components/back-link';
import { Ltr } from '@/components/admin-table';
import { ViolationActions } from '@/components/violation-actions';
import { RaiseViolation } from '@/components/raise-violation';
import { refuseSection } from '@/components/section-refusal';
import { backTarget, rowAnchor } from '@/lib/search-params';
import { listParamsFor } from '@/lib/table-size';
import { fill, label, t } from '@/lib/strings';

/**
 * مخالفات شريك — the violations raised against one partner.
 *
 * ## Its own screen, and paged
 *
 * The partner record links here rather than embedding a list. A partner with forty violations after
 * two years is an ordinary partner, and an unpaged list on a record is the failure «Tables and
 * pagination» exists to prevent — so this is a registry like any other, with its own bar.
 *
 * ## A waived fine shows BOTH entries
 *
 * Bashar, 2026-08-24: never delete or rewrite history — the original fine stays permanently visible
 * and waiving posts a BALANCING entry, so the pair nets to zero and the record is complete. The
 * rule binds this screen as much as the ledger: rendering a waived fine as «—», or as its net, would
 * be the same deletion performed one layer higher, where it is easier to do and harder to notice.
 *
 * So a waived fine renders as three lines — the fine, the waiver, and a zero net — with who waived
 * it and why beside them.
 */
export const dynamic = 'force-dynamic';

export default async function PartnerViolationsPage({
  params,
  searchParams,
}: {
  params: Promise<{ reference: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  /*
    FIRST, before any fetch.

    `staffFetch` maps a 403 to 'unauthenticated', so a guard placed after the fetches never runs:
    the page has already rendered «انتهت الجلسة» to somebody whose session is fine.
  */
  const refused = await refuseSection('partners', t.nav.partners);

  if (refused) return refused;

  const { reference } = await params;
  const query = await searchParams;
  /*
    Its OWN section, not الشركاء's — `TABLE_SECTIONS` is keyed by TABLE, not by route.

    Ten partners is a queue you scan; a list of violations is a log you search, and they want
    different page sizes. Sharing the key would mean choosing a hundred rows here silently rewrote
    الشركاء, which is the drift `staffScope` exists to prevent on `/staff`.
  */
  const { page, size } = await listParamsFor('partnerViolations', searchParams);
  /*
    Back goes to the partner's RECORD, not to the registry (Bashar, 2026-08-24).
    
    It was `backTarget('/partners', …)`, which sends the reader to الشركاء with a row anchor — a
    page they were probably never on. This screen is reached from ONE place, the record's
    enforcement section, and «رجوع» from a sub-page of a record means that record.

    Still a literal base path plus THIS screen's own reference — the same thing `rowAnchor` uses,
    and the same reasoning the standing rule gives for the row fragment: the screen already knows
    which record it is displaying, so there is nothing here a crafted link could point at that the
    reader is not already looking at.
  */
  const back = backTarget(`/partners/${reference}`, query);

  const [partner, result, permissions, counts] = await Promise.all([
    getPartner(reference),
    getPartnerViolations(reference, { page, limit: size }),
    /*
      What this reader may DO, as opposed to which section they may open.

      `violation.waive` gates waiving ALONE — forgiving money is a different authority from
      recording an offence — so the two are read separately rather than inferred from each other.
      The API refuses either way; this decides whether a control that would be refused is offered.
    */
    readerPermissions(),
    sidebarCounts(),
  ]);

  const name =
    partner === 'failed' || partner === 'unauthenticated'
      ? reference
      : partner.displayName;

  const canManage = permissions.includes('violation.manage');
  const canWaive = permissions.includes('violation.waive');

  return (
    <ConsoleShell
      title={fill(t.sections.enforcement.violationsOf, { partner: name })}
      counts={counts}
    >
      <BackLink target={back} section={t.nav.partners} />

      <div className="mt-4">
        <ConsolePanel>
          {/*
            Raising is the only step here that CREATES anything — warn, fine and waive all move a
            violation that already exists. Offered only to a reader who may manage them, because a
            control the API will refuse is worse than no control.
          */}
          {canManage ? <RaiseViolation reference={reference} /> : null}

          {result === 'unauthenticated' ? (
            <p className="text-[12.5px] text-muted">{t.dashboard.sessionExpired}</p>
          ) : result === 'failed' ? (
            <p className="text-[12.5px] text-bad">{t.dashboard.queueFailed}</p>
          ) : result.items.length === 0 ? (
            <p className="text-[12.5px] text-faint">
              {t.sections.enforcement.noViolations}
            </p>
          ) : (
            <>
              <ul className="grid gap-2.5">
                {result.items.map((violation) => (
                  <li
                    key={violation.id}
                    id={rowAnchor(violation.id)}
                    className="scroll-mt-24 rounded-lg border border-line bg-card p-3.5"
                  >
                    <Row
                      violation={violation}
                      canManage={canManage}
                      canWaive={canWaive}
                    />
                  </li>
                ))}
              </ul>

              <TablePagination
                basePath={`/partners/${reference}/violations`}
                section="partnerViolations"
                query={{}}
                page={result.page}
                pages={result.pages}
                total={result.total}
                capped={result.capped}
                size={size}
                label={fill(t.table.paginationLabelOf, {
                  section: t.sections.enforcement.violations,
                })}
              />
            </>
          )}

          {/*
            No footnote about suspension here — this screen is about violations, and
            `suspendedEffect` describes what a SUSPENSION does. I had it here by carelessness: it is
            the right sentence on the partner record, where somebody is deciding whether to lift one,
            and a claim about hidden listings and frozen payouts under a list of violations reads as
            though the violations caused it.
          */}
        </ConsolePanel>
      </div>
    </ConsoleShell>
  );
}

function Row({
  violation,
  canManage,
  canWaive,
}: {
  violation: Violation;
  canManage: boolean;
  canWaive: boolean;
}) {
  return (
    <>
      <div className="flex flex-wrap items-baseline gap-2.5">
        <span className="text-[13px] font-bold text-text">
          {label(t.enums.violationKind, violation.kind)}
        </span>
        <span className="text-[11px] text-faint">
          {label(t.enums.violationStage, violation.stage)}
        </span>
        <span className="text-[11px] text-faint">
          {fill(t.sections.enforcement.occurrenceNumber, {
            n: String(violation.occurrenceNumber),
          })}
        </span>
        {violation.bookingReference ? (
          <Ltr className="text-[11px] text-sky">{violation.bookingReference}</Ltr>
        ) : null}
        <Ltr className="ms-auto text-[11px] text-faint">
          {shortDateTime(violation.createdAt)}
        </Ltr>
      </div>

      {violation.warningNote ? (
        <p className="mt-1.5 text-[12px] leading-relaxed text-text2">
          {violation.warningNote}
        </p>
      ) : null}

      {violation.fineAmount && violation.fineCurrency ? (
        <Money violation={violation} />
      ) : null}

      <ViolationActions violation={violation} canManage={canManage} canWaive={canWaive} />
    </>
  );
}

/**
 * The fine, and — where there is one — its waiver, and the zero they come to.
 *
 * Three lines rather than one, and never «—». The original stays permanently visible because the
 * question this record has to answer six months later is what happened and what it cost, not what
 * the balance ended up being.
 */
function Money({ violation }: { violation: Violation }) {
  const fine = amount(violation.fineAmount ?? '0', violation.fineCurrency ?? '');
  const waiver = violation.waiver;

  return (
    <dl className="mt-2 grid gap-1 rounded border border-line bg-field p-2.5 text-[12px]">
      <div className="flex flex-wrap items-baseline gap-2">
        <dt className="text-faint">{t.sections.enforcement.fineOriginal}</dt>
        <dd className={waiver ? 'text-faint line-through' : 'text-text'}>
          <Ltr>{fine}</Ltr>
        </dd>
        {violation.collectedAt ? (
          <dd className="text-[11px] text-faint">
            {fill(t.sections.enforcement.collectedOn, {
              when: shortDateTime(violation.collectedAt),
            })}
          </dd>
        ) : null}
      </div>

      {violation.customerCompensationAmount ? (
        <div className="flex flex-wrap items-baseline gap-2">
          <dt className="text-faint">{t.sections.enforcement.compensationLabel}</dt>
          <dd className="text-text2">
            <Ltr>
              {amount(violation.customerCompensationAmount, violation.fineCurrency ?? '')}
            </Ltr>
          </dd>
        </div>
      ) : null}

      {waiver ? (
        <>
          <div className="flex flex-wrap items-baseline gap-2">
            <dt className="text-faint">{t.sections.enforcement.fineWaiver}</dt>
            {/*
              The balancing entry, printed as a negative of the same figure. `waiver.amount` equals
              the fine by construction — the API reads it from the stored row — so this is the
              ledger's own pair rather than a subtraction this screen performed.
            */}
            <dd className="text-ok">
              <Ltr>{`− ${amount(waiver.amount, waiver.currency)}`}</Ltr>
            </dd>
            <dd className="text-[11px] text-faint">
              {fill(t.sections.enforcement.waivedOn, {
                when: shortDateTime(waiver.at),
              })}
              {waiver.by
                ? ` · ${fill(t.sections.enforcement.waivedBy, { who: waiver.by })}`
                : ''}
            </dd>
          </div>

          <div className="flex flex-wrap items-baseline gap-2 border-t border-line2 pt-1">
            <dt className="text-faint">{t.sections.enforcement.waivedNet}</dt>
            <dd className="font-bold text-text">
              <Ltr>{amount('0', waiver.currency)}</Ltr>
            </dd>
          </div>

          {/*
            The reason, always, and beside the mark rather than behind a click.

            «أُلغيت» with no reason is worse for the partner than no mark at all — they can see that
            money moved and not why, which is the state the whole never-delete-history rule exists
            to prevent.
          */}
          <p className="text-[11.5px] leading-relaxed text-text2">{waiver.reason}</p>
        </>
      ) : null}
    </dl>
  );
}
