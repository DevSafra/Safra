import Link from 'next/link';

import { getMyViolations, sidebarBadges, type PartnerViolation } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';
import { violationDescription } from '@/lib/violation-description';

/**
 * المخالفات — what SAFRA has charged against this partner, and why (SRS §6.4).
 *
 * ## Read-only, permanently
 *
 * Waiving is `violation.manage`, which is staff. There is no control on this page and there must
 * never be one: a partner arguing with the record in place is not an appeal, it is an edit. The
 * copy points at support instead, which is where an appeal belongs.
 *
 * ## A waived violation STAYS on the list
 *
 * Marked, with its reason. A row that vanished when it was forgiven would be indistinguishable
 * from one that was never written — so a partner who successfully appealed could not tell that
 * SAFRA had acted, and neither could anybody reading the history a year later.
 *
 * ## `moneyHidden` is a sentence, not three dashes
 *
 * An employee without `payout.read_own` gets the three amounts as null — the same withholding as
 * the dashboard's takings, and done at the SELECT so a forgotten spread cannot leak them. Rendering
 * «—» where an amount would go claims the fine was ZERO, which is a different fact and the opposite
 * of the truth. So the amounts are dropped entirely and one line says they are hidden.
 *
 * What remains is everything the screen is FOR: what happened, when, how many times, and what it
 * cost in score. A manager can fix the operational problem — answer faster, keep the calendar
 * current — without being shown the invoice.
 */
export const dynamic = 'force-dynamic';

export default async function ViolationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const raw = params['cursor'];
  const cursor = Array.isArray(raw) ? raw[0] : raw;

  const [access, profile] = await Promise.all([
    sectionAccess('violations'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.violations.title}
      partnerName={name}
      active="violations"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">{children}</div>
    </Shell>
  );

  if (access !== 'open') return shell(<SectionRefusal access={access} />);

  const page = await getMyViolations(cursor);

  if (page === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  if (page === 'failed') {
    return shell(<p className="text-sm text-bad">{t.violations.loadFailed}</p>);
  }

  return shell(
    <>
      <p className="text-[12.5px] leading-relaxed text-muted">{t.violations.intro}</p>

      {/*
        Said ONCE, above the list, rather than per row. A reader who may not see amounts learns it
        as a property of their role, which is what it is — repeating it eleven times would read as
        eleven separate refusals.
      */}
      {page.moneyHidden ? (
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] text-faint">
          {t.violations.moneyHidden}
        </p>
      ) : null}

      {page.items.length === 0 ? (
        <p className="text-sm text-faint">{t.violations.empty}</p>
      ) : (
        <ul id="violations-list" className="grid gap-2.5">
          {page.items.map((violation) => (
            <li key={violation.id}>
              {/*
                The whole row is the link, not a «التفاصيل» word at the end of it.

                A partner reading a list of things the platform holds against them is scanning for
                the one they want to argue about, and a small target at the end of a dense row is a
                control that looks bigger than it is. `block` so the anchor takes the card's size.
              */}
              <Link
                href={`/violations/${encodeURIComponent(violation.id)}`}
                className="block rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
              >
                <Row violation={violation} />
              </Link>
            </li>
          ))}
        </ul>
      )}

      {page.nextCursor ? (
        <Link
          href={`/violations?cursor=${encodeURIComponent(page.nextCursor)}`}
          className="inline-flex min-h-10 w-fit items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
        >
          {t.violations.loadMore}
        </Link>
      ) : null}
    </>,
  );
}

/** One charge: what it was, which offence, what it cost — and whether it still stands. */
function Row({ violation }: { violation: PartnerViolation }) {
  /* The raw kind, never `replace(/_/g, ' ')` — an unlabelled one must look unlabelled. */
  const kind = t.violations.kind[violation.kind] ?? violation.kind;
  /*
    The operator's words if somebody wrote them, otherwise the sentence for this KIND.

    The violations that cost a partner money are written by the SLA sweep, which types nothing — so
    without the fallback the fined rows were the ones with no explanation on them.
  */
  const described = violationDescription(violation);

  /*
    Present only when the reader may see it AND there is one. Withheld and absent are different
    facts and the row must not conflate them: `moneyHidden` above says which case this is, so a
    missing amount here is unambiguous rather than a silent zero.
  */
  const fine =
    violation.fineAmount && violation.fineCurrency
      ? `${violation.fineAmount} ${violation.fineCurrency}`
      : null;

  /*
    The balancing entry, on the same terms as the fine: present only when this reader may see money
    AND there is a figure. `waiver.amount` is null for an employee without `payout.read_own`, which
    is WITHHELD rather than zero — so the pair is simply not printed and the reason line below still
    says a waiver happened.
  */
  const waiverMoney =
    violation.waiver?.amount && violation.waiver.currency
      ? `${violation.waiver.amount} ${violation.waiver.currency}`
      : null;

  /*
    Zero in the fine's own currency, not the string '0'. A waiver is always the WHOLE fine — the
    schema takes no partial amount, deliberately, so a caller cannot supply a second figure that
    disagrees with the first — which makes the net exactly zero and lets it be stated rather than
    computed from two numbers that could drift.
  */
  const net = violation.waiver?.currency ? `0 ${violation.waiver.currency}` : '0';

  /* The waiver's own reason wins; `waivedReason` is the older field for rows filed before it. */
  const waivedReason = violation.waiver?.reason ?? violation.waivedReason;

  return (
    <div className="grid gap-1.5 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-semibold text-text">{kind}</p>
          {/* The raw value if the ladder grows a stage nobody labelled — never prettified. */}
          <span className="rounded-md border border-line px-1.5 py-0.5 text-[11px] text-muted">
            {t.violations.stage[violation.stage] ?? violation.stage}
          </span>
        </div>
        <Ltr className="text-[12px] text-faint">{violation.createdAt}</Ltr>
        {/* The affordance, so a card that opens looks like one. */}
        <span className="text-[11.5px] text-gold">{t.violations.open} ←</span>
      </div>

      <p className="text-[12.5px] text-muted">
        {fill(t.violations.occurrence, { n: count(violation.occurrenceNumber) })}
        {violation.bookingReference ? (
          <>
            {' · '}
            {fill(t.violations.booking, { reference: violation.bookingReference })}
          </>
        ) : null}
      </p>

      {/*
        WHAT HAPPENED, in the words of whoever recorded it.

        The first thing the partner needs and the last thing this screen got. The kind
        («تقويم غير محدَّث») is a category; it does not say which calendar, which dates, or what was
        expected. That sentence was required by the console's form, labelled «يقرأه الشريك», and
        stored nowhere until 2026-08-24 — so a business could read that it had been fined and never
        learn what for.

        Given its own line, above the money and below the heading: it is prose, and hanging it off
        the end of the occurrence line with a «·» would bury the only explanation on the row in a
        metadata strip.

        Absent on rows filed before the column existed, and then NOTHING is rendered — not an empty
        line and not «—», which would claim a description exists and is blank.
      */}
      {described ? (
        <p className="text-[12.5px] leading-relaxed text-text">{described}</p>
      ) : null}

      {fine ? (
        <p className="text-[12.5px] text-text">
          {fill(t.violations.fine, { amount: fine })}
          {violation.customerCompensationAmount && violation.fineCurrency
            ? ` · ${fill(t.violations.compensation, {
                amount: `${violation.customerCompensationAmount} ${violation.fineCurrency}`,
              })}`
            : ''}
        </p>
      ) : null}

      {/*
        Why the fine, beneath the figure it explains.

        Rendered only where the figure is: `fineReason` arrives null for a reader without
        `payout.read_own`, the same rule that withholds the amount, so an employee cannot read the
        reason for a fine whose size they may not see.
      */}
      {violation.fineReason ? (
        <p className="text-[12.5px] leading-relaxed text-text2">
          {fill(t.violations.fineReason, { reason: violation.fineReason })}
        </p>
      ) : null}

      {/*
        A waived row is marked rather than removed, with the reason SAFRA gave. Without the reason
        the mark says a decision happened and refuses to say what it was, which is worse for the
        partner than not showing the row at all.
      */}
      {/*
        What the partner was TOLD, and when — shown only once somebody actually warned them.

        Nothing is backfilled to `warned` for exactly this reason: being warned means a person was
        informed, and no row records that having happened for violations filed before the ladder
        existed. A stage inferred from a fine would put words in SAFRA's mouth.
      */}
      {violation.warnedAt ? (
        <p className="text-[12.5px] text-muted">
          {fill(t.violations.warnedOn, { date: violation.warnedAt })}
          {violation.warningNote
            ? ` · ${fill(t.violations.warningNote, { note: violation.warningNote })}`
            : ''}
        </p>
      ) : null}

      {/*
        A waived fine is the PAIR — the charge, the balancing entry, and the net — never «—» and
        never the net alone.

        Bashar's rule (2026-08-24) is that a waiver does not delete or rewrite history: the original
        fine stays permanently visible and a balancing entry cancels it. Rendering only the net, or
        hiding the row, would delete that history one layer above the ledger and leave the partner
        unable to answer what they were charged and what was forgiven.

        `waiverMoney` is null when the amounts were WITHHELD from this reader, and the row then
        still shows that a waiver happened, when, and why — `moneyHidden` above says which case a
        missing figure is, so it cannot be read as zero.
      */}
      {violation.waived || violation.waiver ? (
        <div className="grid gap-1">
          {waiverMoney ? (
            <p className="text-[12.5px] text-ok">
              {fill(t.violations.waivedAmount, { amount: waiverMoney })}
              {' · '}
              {fill(t.violations.net, { amount: net })}
            </p>
          ) : null}
          <p className="text-[12.5px] text-ok">
            {waivedReason
              ? fill(t.violations.waivedFor, { reason: waivedReason })
              : t.violations.waived}
          </p>
          {violation.waiver ? (
            <p className="text-[12px] text-faint">
              {fill(t.violations.waivedOn, { date: violation.waiver.at })}
            </p>
          ) : null}
        </div>
      ) : (
        <p className="text-[12px] text-faint">
          {violation.collectedAt ? t.violations.collected : t.violations.outstanding}
        </p>
      )}
    </div>
  );
}
