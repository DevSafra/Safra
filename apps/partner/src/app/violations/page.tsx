import Link from 'next/link';

import { getMyViolations, sidebarBadges, type PartnerViolation } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { count } from '@/lib/format';
import { fill, t } from '@/lib/strings';

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
      <div className="mx-auto grid w-full max-w-[760px] gap-4">{children}</div>
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
              <Row violation={violation} />
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
    Present only when the reader may see it AND there is one. Withheld and absent are different
    facts and the row must not conflate them: `moneyHidden` above says which case this is, so a
    missing amount here is unambiguous rather than a silent zero.
  */
  const fine =
    violation.fineAmount && violation.fineCurrency
      ? `${violation.fineAmount} ${violation.fineCurrency}`
      : null;

  return (
    <div className="grid gap-1.5 rounded-xl border border-line bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-semibold text-text">{kind}</p>
        <Ltr className="text-[12px] text-faint">{violation.createdAt}</Ltr>
      </div>

      <p className="text-[12.5px] text-muted">
        {fill(t.violations.occurrence, { n: count(violation.occurrenceNumber) })}
        {violation.bookingReference ? (
          <>
            {' · '}
            {fill(t.violations.booking, { reference: violation.bookingReference })}
          </>
        ) : null}
        {violation.scorePenalty > 0
          ? ` · ${fill(t.violations.scorePenalty, { n: count(violation.scorePenalty) })}`
          : ''}
      </p>

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
        A waived row is marked rather than removed, with the reason SAFRA gave. Without the reason
        the mark says a decision happened and refuses to say what it was, which is worse for the
        partner than not showing the row at all.
      */}
      {violation.waived ? (
        <p className="text-[12.5px] text-ok">
          {violation.waivedReason
            ? fill(t.violations.waivedFor, { reason: violation.waivedReason })
            : t.violations.waived}
        </p>
      ) : (
        <p className="text-[12px] text-faint">
          {violation.collectedAt ? t.violations.collected : t.violations.outstanding}
        </p>
      )}
    </div>
  );
}
