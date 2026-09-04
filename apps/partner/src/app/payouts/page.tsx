import Link from 'next/link';

import {
  getMyPayoutAccounts,
  getMyPayouts,
  type PartnerPayout,
  sidebarBadges,
} from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { amount, count } from '@/lib/format';
import { addMoney } from '@/lib/money';
import { fill, payoutStatus, plural, t } from '@/lib/strings';
import { TONES } from '@/lib/tones';
import { payoutIsSettled } from '@safra/contracts';
import { statusTone } from '@safra/ui';

/**
 * مستحقاتي — the partner's own transfers.
 *
 * ## What was wrong with it (Bashar, 2026-09-04: «design the pages … much better»)
 *
 * It listed rows and stopped. A partner opens this screen to answer two questions — «how much is
 * coming to me» and «when» — and neither was on it: no total, no next date, no destination, and
 * the one figure it did show floated at the far edge of a 1080px bar with nothing between it and
 * the reference. The read-only note sat in a dashed box at the bottom corner beside an orphan link.
 *
 * ## What it does now
 *
 * **A sentence, not a row of metric tiles.** The amount awaiting transfer, how many transfers it
 * is spread across, the nearest scheduled date and the account it is going to — read as one
 * statement, because those figures only mean something together. A tile saying «$3,264.30» over
 * the word «قيد التحويل» is a number nobody can act on.
 *
 * **The blocker is stated where it is noticed.** No verified payout account means no money moves,
 * whatever the list says. That sentence belongs at the top of the screen about money, not on
 * another page the partner has not opened.
 *
 * **Two groups.** «قيد الانتظار» and «مكتملة» are the only distinction a partner actually draws,
 * and one flat list made the next payment and last year's history look alike.
 *
 * ## Read-only, and it still says so
 *
 * A partner cannot release, schedule or pay their own transfer: money leaving SAFRA is never
 * initiated by its recipient. The API enforces it — `PAYOUT_EXECUTE` is a staff permission and the
 * partner controller exposes no write — and the screen states it rather than leaving somebody
 * hunting for a button that was never there. It is a footnote now rather than a dashed box,
 * because it explains an absence and does not deserve the weight of a warning.
 */
export const dynamic = 'force-dynamic';

/*
  The split comes from `@safra/contracts`, not from a list written here.

  It WAS written here, as five status strings — `pending`, `released`, `processing` among them —
  and not one of the five is a real `payout_status`. So every open payout fell through to «مكتملة»
  and the summary read «لا مستحقات قيد التحويل» above $3,264.30 that was owed. A second copy of an
  enum is one more than can stay in step, and this is what that costs on a screen about money.
*/

export default async function PayoutsPage() {
  /*
    An EMPLOYEE is told this belongs to the owner, before the fetch that would refuse them.

    `PAYOUT_READ_OWN` is deliberately absent from `PARTNER_EMPLOYEE_PERMISSIONS` — a receptionist
    should not learn what the business earns — so `getMyPayouts()` answers 403, and `partnerFetch`
    reports that as `'unauthenticated'`. The screen would then say «انتهت الجلسة» and send them to
    sign in again over a permission, which cannot help.

    Hiding the sidebar item is not enough on its own and was never meant to be: a bookmark, a link
    pasted into a group chat, or a typed URL all reach this page directly.
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

  /*
    The accounts are read HERE so the summary can name the destination — and say when there is
    none. Both reads are the partner's own and neither blocks the other, so they go together.
  */
  const [payouts, accounts] = await Promise.all([getMyPayouts(), getMyPayoutAccounts()]);

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
        /*
          `max-w-3xl` is a measure decision rather than a taste one. A payout card holds a reference
          and an amount; at 1080px those two facts sat as far apart as the layout allowed, with a
          thousand pixels of nothing between them. The craft floor puts a readable line at 65-75ch
          and this is the same argument applied to a row.
        */
        <div className="grid max-w-3xl gap-4">
          {/*
            FROZEN is not EMPTY, and the difference is the partner's money.

            A suspended partner's payouts are held, not cancelled (Bashar, 2026-08-24). Without
            this the screen shows a list that has simply stopped growing, which reads as «SAFRA has
            stopped paying me» — and the sentence they need is that the balance is still theirs.
          */}
          {suspended ? (
            <p className="rounded-card border border-bad/40 bg-bad/5 px-3.5 py-2.5 text-[12.5px] leading-relaxed text-text">
              {t.suspension.payoutsFrozen}
            </p>
          ) : null}

          <Summary
            payouts={payouts}
            accounts={
              accounts === 'failed' || accounts === 'unauthenticated' ? [] : accounts
            }
          />

          {payouts.length === 0 ? (
            <p className="rounded-card border border-line bg-card p-5 text-center text-[12.5px] text-faint">
              {t.payouts.empty}
            </p>
          ) : (
            <>
              <Group
                heading={t.payouts.groupOpen}
                rows={payouts.filter((one) => !payoutIsSettled(one.status))}
              />
              <Group
                heading={t.payouts.groupSettled}
                rows={payouts.filter((one) => payoutIsSettled(one.status))}
              />
            </>
          )}

          <p className="text-[11.5px] leading-relaxed text-faint2">{t.payouts.note}</p>
          <p className="text-[11.5px] leading-relaxed text-faint2">
            {t.payouts.readOnly}
          </p>
        </div>
      )}
    </Shell>
  );
}

/**
 * The two questions, answered in sentences.
 *
 * Sums are computed over rows that share ONE currency — the partner's own — so `addMoney` is safe
 * here in a way it would not be on a staff screen spanning five. If a partner ever has payouts in
 * two currencies the total would be wrong, so it is only shown when every open row agrees; that is
 * cheaper and more honest than inventing a conversion this screen has no rate for.
 */
function Summary({
  payouts,
  accounts,
}: {
  readonly payouts: readonly PartnerPayout[];
  readonly accounts: readonly {
    status: string;
    bankName: string | null;
    last4: string;
  }[];
}) {
  const open = payouts.filter((one) => !payoutIsSettled(one.status));
  const settled = payouts.filter((one) => payoutIsSettled(one.status) && one.paidAt);

  const currency = open[0]?.currencyCode;
  const oneCurrency = open.every((one) => one.currencyCode === currency);
  const pending =
    currency && oneCurrency
      ? open.reduce((sum, one) => addMoney(sum, one.netAmount, currency), '0')
      : null;

  const paidCurrency = settled[0]?.currencyCode;
  const paid =
    paidCurrency && settled.every((one) => one.currencyCode === paidCurrency)
      ? settled.reduce((sum, one) => addMoney(sum, one.netAmount, paidCurrency), '0')
      : null;

  /* The earliest date SAFRA has committed to, if any row carries one. */
  const next = open
    .map((one) => one.scheduledFor)
    .filter((one): one is string => one !== null)
    .sort()[0];

  const verified = accounts.find((one) => one.status === 'verified');

  return (
    <section className="grid gap-2 rounded-card border border-line bg-card p-4.5">
      <p className="text-[15px] leading-relaxed font-semibold text-text">
        {pending && currency && open.length > 0 ? (
          plural(t.payouts.summaryPending, {
            amount: amount(pending, currency),
            n: open.length,
          })
        ) : (
          <span className="text-muted">{t.payouts.summaryNothingPending}</span>
        )}
      </p>

      <p className="text-[12.5px] leading-relaxed text-muted">
        {next ? <>{fill(t.payouts.summaryNext, { date: next })} </> : null}
        {paid && paidCurrency && settled.length > 0
          ? fill(t.payouts.summaryPaid, { amount: amount(paid, paidCurrency) })
          : null}
      </p>

      {/*
        The one thing that stops every transfer, said on the screen where it is noticed rather
        than on the one the partner has not opened. It is a warning, not a note: an unverified
        destination means nothing moves however long the list gets.
      */}
      {verified ? (
        <p className="text-[12px] text-faint">
          {fill(t.payouts.summaryTo, {
            account: `${verified.bankName ?? ''} ····${verified.last4}`.trim(),
          })}
        </p>
      ) : (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[12px] leading-relaxed text-warn">
          {t.payouts.summaryNoAccount}
          <Link
            href="/settings"
            className="inline-flex min-h-10 items-center font-bold underline underline-offset-2 lg:min-h-0"
          >
            {t.payouts.summaryAddAccount}
          </Link>
        </p>
      )}
    </section>
  );
}

/** One group, absent entirely when it holds nothing — an empty heading explains nothing. */
function Group({
  heading,
  rows,
}: {
  readonly heading: string;
  readonly rows: readonly PartnerPayout[];
}) {
  if (rows.length === 0) return null;

  return (
    <section className="grid gap-2">
      <h2 className="text-[12px] font-bold tracking-wide text-faint">
        {heading} · {count(rows.length)}
      </h2>

      <ul className="grid gap-2">
        {rows.map((payout) => (
          <li key={payout.reference}>
            <Card payout={payout} />
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * One payout.
 *
 * ## The amount has a column now
 *
 * It used to be `ms-auto` on a flex row, so on a wide screen it sat against the far edge with a
 * thousand pixels of nothing between it and the reference — two facts about the same transfer,
 * placed as far apart as the layout allowed. A two-track grid keeps them a readable distance apart
 * at every width and stacks them on a phone.
 *
 * ## The fine is named
 *
 * `fineAmount` was on the payload and on no screen. A partner reading a net figure that does not
 * match what they expected, with no deduction shown, opens a support ticket — and the answer was
 * always in the data. It appears only when it is not zero, because «ناقص 0» is noise.
 *
 * ## A card, not a table row
 *
 * The portal has no `<table>` anywhere and a partner reads this on a phone as often as a laptop;
 * six columns of Arabic squeezed into 390px is unreadable, which the responsive rule names
 * explicitly as not being the same thing as responsive.
 */
function Card({ payout }: { readonly payout: PartnerPayout }) {
  const fined = Number(payout.fineAmount) > 0;

  return (
    <Link
      href={`/payouts/${encodeURIComponent(payout.reference)}`}
      className="grid gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/40 sm:grid-cols-[1fr_auto] sm:items-center"
    >
      <span className="grid gap-1.5">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Ltr className="text-[13px] font-bold text-sky">{payout.reference}</Ltr>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${TONES[statusTone(payout.status)]}`}
          >
            {payoutStatus(payout.status)}
          </span>
        </span>

        <span className="text-[11.5px] leading-relaxed text-faint">
          <Ltr>
            {payout.periodStart} ← {payout.periodEnd}
          </Ltr>
          {' · '}
          {plural(t.payouts.coveredCount, { n: payout.bookingCount })}
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
        </span>

        {/* A held transfer explains itself here rather than only on its own screen. */}
        {payout.holdReason ? (
          <span className="text-[11.5px] leading-relaxed text-warn">
            {t.payouts.holdReason}: {payout.holdReason}
          </span>
        ) : null}
      </span>

      <span className="grid gap-0.5 sm:justify-items-end sm:text-end">
        <span className="text-[18px] font-extrabold text-gold">
          <Ltr>{amount(payout.netAmount, payout.currencyCode)}</Ltr>
        </span>

        {fined ? (
          <span className="text-[11px] text-faint2">
            {fill(t.payouts.afterFine, {
              gross: amount(payout.grossAmount, payout.currencyCode),
              fine: amount(payout.fineAmount, payout.currencyCode),
            })}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
