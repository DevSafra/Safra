import Link from 'next/link';

import { getMyViolation, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';
import { violationDescription } from '@/lib/violation-description';

/**
 * تفاصيل المخالفة — one violation, in full.
 *
 * ## Why the list was not enough
 *
 * Bashar, 2026-08-24: المخالفات had no page per item. A row is for scanning — kind, stage, date —
 * and a partner opening it is doing something else: deciding whether to accept a fine. That needs
 * what happened, when, which booking, what was said to them, what it cost, and whether it was
 * forgiven, laid out to be read rather than compressed onto one line.
 *
 * ## Every field the API is willing to give this reader, and no more
 *
 * The money rule is the API's: `moneyHidden` withholds every figure AND the fine's reason from a
 * reader without `payout.read_own`, so an employee sees what happened and not what it cost. This
 * screen renders what arrives; it makes no second decision about visibility, because a detail page
 * is exactly where a narrower guard would be easiest to forget.
 *
 * ## It says the two things a partner assumes wrongly
 *
 * That the violation has hurt their ranking — it has not, and the sentence says so — and that this
 * page is where an appeal happens. Both are stated rather than left to be inferred, for the same
 * reason the suspension notice answers "are my guests safe" before listing what stopped.
 */
export const dynamic = 'force-dynamic';

export default async function ViolationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [access, profile] = await Promise.all([
    sectionAccess('violations'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.violations.detailTitle}
      partnerName={name}
      active="violations"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">
        {/*
          Back FIRST in the DOM, so a reader on a phone meets the way out before the detail — and to
          a LITERAL path, never one taken from the URL. The only thing this screen is reached with is
          an id it already displays, so there is nothing a crafted link could redirect through.
        */}
        <Link
          href="/violations"
          className="inline-flex min-h-10 w-fit items-center gap-2 text-[12.5px] text-muted hover:text-gold lg:min-h-0"
        >
          <span aria-hidden="true">→</span>
          {t.violations.back}
        </Link>
        {children}
      </div>
    </Shell>
  );

  if (access !== 'open') return shell(<SectionRefusal access={access} />);

  const result = await getMyViolation(id);

  if (result === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  /*
    `failed` covers "not yours" as well as "not there", and deliberately reads the same.

    The API answers `VIOLATION_NOT_FOUND` for a violation belonging to another business — scoped in
    the WHERE clause — so this screen must not distinguish the two either. A different sentence for
    "exists but is not yours" would turn a uuid guess into a way of discovering that it exists.
  */
  if (result === 'failed') {
    return shell(<p className="text-sm text-bad">{t.violations.notFound}</p>);
  }

  const { violation, moneyHidden } = result;
  const described = violationDescription(violation);
  const fine =
    violation.fineAmount && violation.fineCurrency
      ? `${violation.fineAmount} ${violation.fineCurrency}`
      : null;

  return shell(
    <>
      <section className="grid gap-3 rounded-xl border border-line bg-card p-4">
        <div className="flex flex-wrap items-center gap-2.5">
          <h2 className="text-[15px] font-bold text-text">
            {t.violations.kind[violation.kind] ?? violation.kind}
          </h2>
          <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted">
            {t.violations.stage[violation.stage] ?? violation.stage}
          </span>
        </div>

        {/*
          WHAT HAPPENED, first and in full — the reason this page exists.

          `violationDescription` gives the operator's own sentence where somebody wrote one, and the
          sentence for the KIND where the platform wrote the violation itself. Without the fallback
          the violations that cost money — every one levied by the SLA sweep — were the ones with no
          explanation on them.
        */}
        {described ? (
          <div className="grid gap-1">
            <h3 className="text-[11.5px] text-faint">{t.violations.whatHappened}</h3>
            <p className="text-[13px] leading-relaxed text-text">{described}</p>
          </div>
        ) : null}

        <dl className="grid gap-2 sm:grid-cols-2">
          <Fact label={t.violations.recordedOn}>
            <Ltr>{violation.createdAt}</Ltr>
          </Fact>
          <Fact label={t.violations.theOccurrence}>
            {fill(t.violations.occurrence, { n: count(violation.occurrenceNumber) })}
          </Fact>
          <Fact label={t.violations.theBooking}>
            {violation.bookingReference ? (
              <Ltr>{violation.bookingReference}</Ltr>
            ) : (
              <span className="text-faint">{t.violations.noBooking}</span>
            )}
          </Fact>
        </dl>
      </section>

      {/* The warning, and only once somebody actually issued one. */}
      {violation.warnedAt ? (
        <section className="grid gap-1.5 rounded-xl border border-line bg-card p-4">
          <h3 className="text-[12px] font-semibold text-muted">
            {t.violations.theWarning}
          </h3>
          <p className="text-[11.5px] text-faint">
            {fill(t.violations.warnedOn, { date: violation.warnedAt })}
          </p>
          {violation.warningNote ? (
            <p className="text-[13px] leading-relaxed text-text">
              {violation.warningNote}
            </p>
          ) : null}
        </section>
      ) : null}

      {/*
        The money, when this reader may see it.

        `moneyHidden` is stated rather than shown as «—»: a dash where an amount belongs claims the
        fine was ZERO, which is a different fact and the opposite of the truth.
      */}
      {moneyHidden ? (
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-faint">
          {t.violations.moneyHidden}
        </p>
      ) : fine ? (
        <section className="grid gap-2 rounded-xl border border-line bg-card p-4">
          <h3 className="text-[12px] font-semibold text-muted">{t.violations.theFine}</h3>

          <p
            className={`text-[13px] ${violation.waived ? 'text-faint line-through' : 'text-text'}`}
          >
            <Ltr>{fine}</Ltr>
          </p>

          {violation.customerCompensationAmount ? (
            <p className="text-[12px] text-text2">
              {fill(t.violations.compensation, {
                amount: `${violation.customerCompensationAmount} ${violation.fineCurrency ?? ''}`,
              })}
            </p>
          ) : null}

          {violation.fineReason ? (
            <p className="text-[12.5px] leading-relaxed text-text2">
              {fill(t.violations.fineReason, { reason: violation.fineReason })}
            </p>
          ) : null}

          <p className="text-[11.5px] text-faint">
            {violation.collectedAt
              ? fill(t.violations.collectedOnLabel, { date: violation.collectedAt })
              : t.violations.notCollected}
          </p>
        </section>
      ) : null}

      {/*
        The waiver — the pair, never the net alone.

        Bashar's rule: enforcement is not solved by deleting history. The fine above stays struck
        through and legible and this states the decision beside it, because a record that says a
        decision happened and refuses to say what it was is worse for the partner than no record.
      */}
      {violation.waived ? (
        <section className="grid gap-1.5 rounded-xl border border-ok/40 bg-ok/5 p-4">
          <h3 className="text-[12px] font-semibold text-ok">{t.violations.theWaiver}</h3>
          {violation.waivedReason ? (
            <p className="text-[13px] leading-relaxed text-text">
              {violation.waivedReason}
            </p>
          ) : null}
        </section>
      ) : null}

      <p className="text-[12px] leading-relaxed text-faint">
        {t.violations.noRankingEffect}
      </p>
      <p className="text-[12px] leading-relaxed text-faint">{t.violations.appeal}</p>
    </>,
  );
}

function Fact({
  label,
  children,
}: {
  readonly label: string;
  readonly children: React.ReactNode;
}) {
  return (
    <div className="grid gap-0.5">
      <dt className="text-[11.5px] text-faint">{label}</dt>
      <dd className="text-[12.5px] text-text">{children}</dd>
    </div>
  );
}
