import Link from 'next/link';

import { getMyDisputes, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { amount } from '@/lib/format';
import { disputeKind, disputeStatus, plural, t } from '@/lib/strings';
import { ltrIsolate } from '@safra/i18n';

/**
 * النزاعات — the complaints that freeze this partner's money, and their side of them.
 *
 * ## Why this screen exists (Bashar, 2026-09-08)
 *
 * *«I do not want SAFRA deciding disputes while only one side is able to participate in the
 * process.»* Before it, a guest complained, the payable froze, SAFRA decided, and the partner was
 * told only when it was over — by a «your payout is released» notice. The only trace they had was
 * a held amount on مستحقاتي with a reference beside it.
 *
 * ## Beside المخالفات, not inside مستحقاتي
 *
 * A fine and a dispute are both charges against the business that somebody has to answer, and a
 * host looking for «why is my money held» reads them together. مستحقاتي answers «what am I owed»,
 * which is a different question and already crowded.
 *
 * ## The amount is the OWNER's
 *
 * An employee holding `dispute.respond_own` reads the allegation and answers it — they were on the
 * desk that night, which is the whole reason the permission is in their set. The frozen figure
 * comes back null for them, dropped at the SELECT, and one line says so: printing «—» where an
 * amount belongs claims the frozen amount is zero, which is a different fact.
 */
export const dynamic = 'force-dynamic';

export default async function DisputesPage() {
  const [access, profile] = await Promise.all([
    sectionAccess('disputes'),
    requireVerifiedPartner(),
  ]);

  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  const shell = (children: React.ReactNode) => (
    <Shell
      title={t.disputes.title}
      partnerName={name}
      active="disputes"
      badges={sidebarBadges(profile)}
    >
      <div className="grid gap-4">{children}</div>
    </Shell>
  );

  if (access !== 'open') return shell(<SectionRefusal access={access} />);

  const page = await getMyDisputes();

  if (page === 'unauthenticated') {
    return shell(<p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>);
  }

  /*
    A failed load says so. It must never render as «no disputes» — this review has found that
    exact shape repeatedly, and here it would tell a partner nothing is wrong while their money
    is held.
  */
  if (page === 'failed') {
    return shell(<p className="text-sm text-bad">{t.disputes.loadFailed}</p>);
  }

  const moneyHidden = page.disputes.some((row) => row.frozenAmount === null);

  return shell(
    <>
      <p className="text-[14px] leading-relaxed text-muted">{t.disputes.intro}</p>

      {moneyHidden && page.disputes.length > 0 ? (
        <p className="rounded-lg border border-line bg-card px-3 py-2 text-[14px] text-faint">
          {t.disputes.moneyHidden}
        </p>
      ) : null}

      {page.disputes.length === 0 ? (
        <p className="text-[14px] text-faint">{t.disputes.empty}</p>
      ) : (
        <ul className="grid gap-3">
          {page.disputes.map((row) => (
            <li
              key={row.reference}
              className="rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/50"
            >
              {/*
                Marked so the browser sweep finds a dispute row and nothing else — the same reason
                the console marks its accounts and its status pills. A test that locates rows by
                their shape passes against a page rendering something else in the same shape.
              */}
              <Link
                href={`/disputes/${row.reference}`}
                data-dispute={row.reference}
                className="block"
              >
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[16px] font-bold text-sky">
                    <Ltr>{row.reference}</Ltr>
                  </span>
                  <span className="text-[13px] text-muted">
                    {disputeStatus(row.status)}
                  </span>
                  <span className="text-[13px] text-faint">{disputeKind(row.kind)}</span>
                  {/*
                    BOTH or neither, and no fallback currency.

                    `frozenAmount` and `currencyCode` are dropped together for a reader without
                    `payout.read_own`, so a `?? 'USD'` here would be unreachable — and the sweep in
                    `currency-default.test.ts` is right to refuse it anyway: a code typed into a
                    component is how a form comes to start on the wrong currency. Requiring both
                    means an amount can never render without the currency it is in.
                  */}
                  {row.frozenAmount !== null && row.currencyCode !== null ? (
                    <span className="ms-auto text-[16px] font-extrabold text-warn">
                      {ltrIsolate(amount(row.frozenAmount, row.currencyCode))}
                    </span>
                  ) : null}
                </div>

                <p className="mt-1.5 text-[14px] text-text">{row.title}</p>

                <p className="mt-1 text-[13px] text-faint">
                  {t.disputes.colBooking}: <Ltr>{row.bookingReference}</Ltr> ·{' '}
                  {t.disputes.colOpened}: {ltrIsolate(row.openedAt.slice(0, 10))} ·{' '}
                  {plural(t.disputes.responseCount, { count: row.responseCount })}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>,
  );
}
