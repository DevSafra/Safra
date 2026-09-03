import Link from 'next/link';

import { getMyPayouts, type PartnerPayout, sidebarBadges } from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { amount, count } from '@/lib/format';
import { payoutStatus, t } from '@/lib/strings';
import { TONES } from '@/lib/tones';
import { statusTone } from '@safra/ui';

/**
 * مستحقاتي — the partner's own transfers.
 *
 * ## Read-only, and it says so
 *
 * A partner cannot release, schedule or pay their own transfer: money leaving SAFRA is never
 * initiated by its recipient. The API enforces that — `PAYOUT_EXECUTE` is a staff permission and
 * the partner controller exposes no write at all — and the screen states it rather than leaving
 * somebody looking for a button that was never there.
 *
 * ## Every row is a recorded event
 *
 * Nothing here is derived from what bookings owe. A partner with earnings and no payout row sees
 * an empty list, which is the truth: SAFRA has not yet recorded a transfer for them.
 */
export const dynamic = 'force-dynamic';

export default async function PayoutsPage() {
  /*
    An EMPLOYEE is told this belongs to the owner, before the fetch that would refuse them.

    `PAYOUT_READ_OWN` is deliberately absent from `PARTNER_EMPLOYEE_PERMISSIONS` — a receptionist
    should not learn what the business earns — so `getMyPayouts()` answers 403, and `partnerFetch`
    reports that as `'unauthenticated'`. The screen would then say «انتهت الجلسة» and send them to
    sign in again over a permission, which cannot help.

    Hiding the sidebar item is not enough on its own and was never meant to be: a bookmark, a link
    pasted into a group chat, or a typed URL all reach this page directly. A hidden control and a
    refused request must not disagree — the rule settled on the joint-contract path — and that cuts
    both ways.
  */
  const [access, profile] = await Promise.all([
    sectionAccess('payouts'),
    requireVerifiedPartner(),
  ]);
  const name =
    profile === 'failed' || profile === 'unauthenticated' ? '' : profile.displayName;

  if (access !== 'open') {
    return (
      <Shell
        title={t.payouts.title}
        partnerName={name}
        active="payouts"
        badges={sidebarBadges(profile)}
      >
        <SectionRefusal access={access} />
      </Shell>
    );
  }

  const payouts = await getMyPayouts();

  /* From the profile the page already holds — `getMyProfile` is `cache()`d, so this costs nothing. */
  const suspended =
    profile !== 'failed' && profile !== 'unauthenticated' && profile.suspension !== null;

  return (
    <Shell
      title={t.payouts.title}
      partnerName={name}
      active="payouts"
      badges={sidebarBadges(profile)}
    >
      {payouts === 'unauthenticated' ? (
        <p className="text-sm text-muted">{t.dashboard.sessionExpired}</p>
      ) : payouts === 'failed' ? (
        <p className="text-sm text-bad">{t.dashboard.loadFailed}</p>
      ) : (
        <div className="grid gap-3.5">
          {/*
            FROZEN is not EMPTY, and the difference is the partner's money.

            A suspended partner's payouts are held, not cancelled (Bashar, 2026-08-24). Without this
            line the screen shows a list that has simply stopped growing, which reads as "SAFRA has
            stopped paying me" — and the sentence they need is that the balance is still theirs.
            Stated ABOVE the list, because it explains what the list is about to show.

            The banner at the top of every screen says the account is on hold; this says what that
            means HERE. The two are not redundant: one is the state, the other is the consequence on
            the one screen that is about money.
          */}
          {suspended ? (
            <p className="rounded-lg border border-bad/40 bg-bad/5 px-3 py-2 text-[12.5px] leading-relaxed text-text">
              {t.suspension.payoutsFrozen}
            </p>
          ) : null}

          <p className="text-[12px] leading-relaxed text-faint">{t.payouts.note}</p>

          {payouts.length === 0 ? (
            <p className="text-sm text-faint">{t.payouts.empty}</p>
          ) : (
            <ul className="grid gap-2.5">
              {payouts.map((payout) => (
                <li key={payout.reference}>
                  <Card payout={payout} />
                </li>
              ))}
            </ul>
          )}

          <p className="rounded-lg border border-dashed border-line px-3 py-2 text-[11.5px] leading-relaxed text-faint">
            {t.payouts.readOnly}
          </p>
        </div>
      )}
    </Shell>
  );
}

/**
 * One payout as a card rather than a table row.
 *
 * The portal has no `<table>` anywhere and a partner reads this on a phone as often as a laptop;
 * six columns of Arabic squeezed into 390px is unreadable, which the responsive rule names
 * explicitly as not being the same thing as responsive.
 */
function Card({ payout }: { readonly payout: PartnerPayout }) {
  return (
    <Link
      href={`/payouts/${encodeURIComponent(payout.reference)}`}
      className="block rounded-card border border-line bg-card p-4 hover:border-gold/40"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Ltr className="text-[13px] font-bold text-sky">{payout.reference}</Ltr>

        <span
          className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[statusTone(payout.status)]}`}
        >
          {payoutStatus(payout.status)}
        </span>

        <span className="ms-auto text-[17px] font-extrabold text-gold-ink">
          <Ltr>{amount(payout.netAmount, payout.currencyCode)}</Ltr>
        </span>
      </div>

      <p className="mt-1.5 text-[11.5px] text-faint">
        <Ltr>
          {payout.periodStart} ← {payout.periodEnd}
        </Ltr>
        {' · '}
        {count(payout.bookingCount)} {t.payouts.colBookings}
        {payout.scheduledFor ? (
          <>
            {' · '}
            {t.payouts.scheduledFor}: <Ltr>{payout.scheduledFor}</Ltr>
          </>
        ) : null}
        {payout.paidAt ? (
          <>
            {' · '}
            {t.payouts.paidAt}: <Ltr>{payout.paidAt.slice(0, 10)}</Ltr>
          </>
        ) : null}
      </p>
    </Link>
  );
}
