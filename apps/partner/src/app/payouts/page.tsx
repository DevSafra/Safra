import Link from 'next/link';

import {
  getMyPayoutAccounts,
  getMyPayouts,
  getMyFines,
  getMyRecoveries,
  getMyWithheldPayouts,
  type PartnerFine,
  type PartnerRecovery,
  type WithheldBooking,
  type PartnerPayout,
  sidebarBadges,
} from '@/lib/api';
import { requireVerifiedPartner, sectionAccess } from '@/lib/gate';
import { Shell } from '@/components/shell';
import { SectionRefusal } from '@/components/section-refusal';
import { Ltr } from '@/components/ltr';
import { amount, count } from '@/lib/format';
import { addMoney } from '@/lib/money';
import {
  disputeKind,
  disputeStatus,
  fill,
  payoutStatus,
  plural,
  t,
  violationKind,
} from '@/lib/strings';
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
  const [payouts, accounts, withheld, recoveries, fines] = await Promise.all([
    getMyPayouts(),
    getMyPayoutAccounts(),
    getMyWithheldPayouts(),
    getMyRecoveries(),
    getMyFines(),
  ]);

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
            <p className="rounded-card border border-bad/40 bg-bad/5 px-3.5 py-2.5 text-[14px] leading-relaxed text-text">
              {t.suspension.payoutsFrozen}
            </p>
          ) : null}

          <Summary
            payouts={payouts}
            accounts={
              accounts === 'failed' || accounts === 'unauthenticated' ? [] : accounts
            }
          />

          {/*
            What is being HELD, directly under the summary it explains.

            A booking under an open dispute is excluded from accrual silently: the partner's
            payable did not appear and nothing said why. The page carried the rule as a sentence
            and no figure — while the console showed SAFRA «مستحقات مجمّدة: 19». Placed here
            because it is the answer to «why is my pending total lower than I expected», and that
            question is asked while looking at the total.
          */}
          <Withheld
            rows={
              withheld === 'failed' || withheld === 'unauthenticated'
                ? []
                : withheld.withheld
            }
            payouts={payouts}
          />

          {/*
            The other reason a total can be lower than expected, and the one that runs backwards.

            Beside «مستحقات مجمّدة» deliberately: a partner looking at a smaller figure asks one
            question, and there are now two answers to it — money held because a stay is disputed,
            and money owed back because a stay was refunded after it was paid. Neither is
            discoverable from the number itself.
          */}
          <Recoveries
            rows={
              recoveries === 'failed' || recoveries === 'unauthenticated'
                ? []
                : recoveries.recoveries
            }
          />

          {/*
            And the third reason a total can be lower than expected — a PENALTY rather than a
            correction. Its own panel by instruction: «Keep fines and recoveries as separate
            concepts and separate balances» (Bashar, 2026-09-07). One panel for both would make a
            partner work out which kind each row was before they could act on it, and a fine is
            the one they can appeal.
          */}
          <Fines
            rows={fines === 'failed' || fines === 'unauthenticated' ? [] : fines.fines}
          />

          {payouts.length === 0 ? (
            <p className="rounded-card border border-line bg-card p-5 text-center text-[14px] text-faint">
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

          <p className="text-[13px] leading-relaxed text-faint">{t.payouts.note}</p>
          <p className="text-[13px] leading-relaxed text-faint">{t.payouts.readOnly}</p>
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
      {/*
        One constant route to where destinations are maintained.

        The only link across to الإعدادات used to sit inside the «no account yet» warning, so a
        partner who HAD an account could read which one their money goes to and had no way to reach
        the screen that changes it — they had to already know الإعدادات existed. `accountsLink` was
        written for this and had no caller.

        In the header rather than beside the state message, because navigation is not a property of
        the state: where the accounts live is the same fact whether one is set up or not, and a link
        that appears and disappears teaches a reader nothing about where things are.
      */}
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="text-[13px] font-bold tracking-wide text-faint">
          {t.payouts.summaryHeading}
        </span>
        <Link
          href="/settings"
          className="inline-flex min-h-10 items-center text-[13px] font-semibold text-gold-read underline underline-offset-2 lg:min-h-0"
        >
          {t.payouts.accountsLink}
        </Link>
      </span>

      <p className="text-[16px] leading-relaxed font-semibold text-text">
        {pending && currency && open.length > 0 ? (
          plural(t.payouts.summaryPending, {
            amount: amount(pending, currency),
            n: open.length,
          })
        ) : (
          <span className="text-muted">{t.payouts.summaryNothingPending}</span>
        )}
      </p>

      <p className="text-[14px] leading-relaxed text-muted">
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
        <p className="text-[13px] text-faint">
          {fill(t.payouts.summaryTo, {
            account: `${verified.bankName ?? ''} ····${verified.last4}`.trim(),
          })}
        </p>
      ) : (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-warn/40 bg-warn/5 px-3 py-2 text-[13px] leading-relaxed text-warn">
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

/**
 * Fines still outstanding, and how much of each has been taken.
 *
 * ## Its own panel, not a row in the recoveries one
 *
 * Bashar, 2026-09-07: «Keep fines and recoveries as separate concepts and separate balances.» The
 * two look alike on a screen and are not alike to the person paying them — a fine is a penalty with
 * a ladder and an appeal, a recovery is a correction of money that was never owed. Merging them
 * would make a partner establish which kind a row was before they could do anything about it.
 *
 * ## Each fine names its kind and its booking
 *
 * A penalty with no cause cannot be appealed. «تقويم غير محدَّث على الحجز BKG-…» is something a
 * partner can check and contest; «غرامة $10» is a demand.
 *
 * ## And how much has already gone
 *
 * «how deductions are applied over time» was the explicit requirement, so a partly collected fine
 * shows what has been taken beside what remains rather than only the balance.
 */
function Fines({ rows }: { readonly rows: readonly PartnerFine[] }) {
  if (rows.length === 0) return null;

  /* Per currency: a platform settling in several must never add across them. */
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(
      row.currencyCode,
      (totals.get(row.currencyCode) ?? 0) + Number(row.outstanding),
    );
  }

  return (
    <section
      data-fines
      className="grid gap-3 rounded-card border border-line2 bg-field p-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-bold text-text">{t.payouts.fineTitle}</h2>
        <span className="ms-auto text-[14px] font-bold tabular-nums text-text">
          {t.payouts.fineOutstanding}:{' '}
          {[...totals].map(([code, sum]) => amount(sum.toFixed(2), code)).join(' · ')}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-text2">{t.payouts.fineNote}</p>

      <ul className="grid gap-1.5">
        {rows.map((row) => (
          <li
            key={`${row.kind}-${row.bookingReference ?? ''}-${row.createdAt}`}
            data-fine={row.bookingReference ?? row.kind}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-[13px]"
          >
            <span className="font-semibold text-text">{violationKind(row.kind)}</span>

            {row.bookingReference ? (
              <span className="text-muted">
                {t.payouts.fineOnBooking}{' '}
                <Ltr className="font-semibold text-sky">{row.bookingReference}</Ltr>
              </span>
            ) : null}

            {/* Only when some has gone: «خُصم ٠» on a fresh fine is noise. */}
            {Number(row.collected) > 0 ? (
              <span className="text-faint">
                {t.payouts.fineCollected}:{' '}
                <Ltr>{amount(row.collected, row.currencyCode)}</Ltr>
              </span>
            ) : null}

            <span className="ms-auto font-bold tabular-nums text-text">
              <Ltr>{amount(row.outstanding, row.currencyCode)}</Ltr>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * What this partner owes back, said before it is taken.
 *
 * ## Why it is on this page
 *
 * Bashar, 2026-09-07: «The outstanding recovery amount should be visible to finance, operations
 * and the partner.» A balance a partner meets only as a smaller transfer is the asymmetry this
 * review keeps finding — the console knowing a figure the business whose money it is does not.
 *
 * It sits beside «مستحقات مجمّدة» because both answer the same question from opposite directions:
 * money held because a stay is disputed, and money owed back because a stay was refunded after it
 * had already been paid out.
 *
 * ## Each balance names its booking
 *
 * A debt with no cause cannot be disputed. The guest is not named: the partner is a party to the
 * money and not to the refund, which is the same line `Withheld` draws.
 *
 * ## Nothing is drawn when nothing is owed
 *
 * The overwhelmingly common case, and an empty amber panel on every partner's payouts page would
 * teach them to ignore the one that matters.
 */
function Recoveries({ rows }: { readonly rows: readonly PartnerRecovery[] }) {
  if (rows.length === 0) return null;

  /* Per currency, because a platform that settles in five must never add across them. */
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(
      row.currencyCode,
      (totals.get(row.currencyCode) ?? 0) + Number(row.outstanding),
    );
  }

  return (
    <section
      data-recoveries
      className="grid gap-3 rounded-card border border-line2 bg-field p-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-bold text-text">{t.payouts.recoveryTitle}</h2>
        <span className="ms-auto text-[14px] font-bold tabular-nums text-text">
          {t.payouts.recoveryOutstanding}:{' '}
          {[...totals].map(([code, sum]) => amount(sum.toFixed(2), code)).join(' · ')}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-text2">{t.payouts.recoveryNote}</p>

      <ul className="grid gap-1.5">
        {rows.map((row) => (
          <li
            key={row.bookingReference}
            data-recovery={row.bookingReference}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-line px-3 py-2 text-[13px]"
          >
            <span className="text-muted">
              {t.payouts.recoveryFromBooking}{' '}
              <Ltr className="font-semibold text-sky">{row.bookingReference}</Ltr>
            </span>

            {/*
              What has come back already, only when some has. «استُعيد 0» on a fresh balance is
              noise, and the outstanding figure beside it already implies it.
            */}
            {Number(row.recovered) > 0 ? (
              <span className="text-faint">
                {t.payouts.recoveryCollected}:{' '}
                <Ltr>{amount(row.recovered, row.currencyCode)}</Ltr>
              </span>
            ) : null}

            <span className="ms-auto font-bold tabular-nums text-text">
              <Ltr>{amount(row.outstanding, row.currencyCode)}</Ltr>
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Bookings whose payable an open dispute is holding.
 *
 * Absent entirely when nothing is held — a heading over an empty list tells a partner they have a
 * problem they do not have. Every amount carries its currency, per the standing rule: SAFRA prices
 * in five and settles in one, and a bare figure here is money nobody can act on.
 */
function Withheld({
  rows,
  payouts,
}: {
  readonly rows: readonly WithheldBooking[];
  /** The partner's own transfers, so a blocked one can be named with the sum it is holding. */
  readonly payouts: readonly PartnerPayout[];
}) {
  if (rows.length === 0) return null;

  /*
    Totalled PER CURRENCY, not summed across them.

    A partner may hold bookings priced in dollars and in lira; adding those together produces a
    number that is not money. The same reasoning the payout groups already follow.
  */
  const totals = new Map<string, number>();

  for (const row of rows) {
    totals.set(
      row.currencyCode,
      (totals.get(row.currencyCode) ?? 0) + Number(row.amount),
    );
  }

  /* The transfers these stays are stopping, each named once however many stays point at it. */
  const references = [
    ...new Set(rows.map((row) => row.payoutReference).filter((one) => one !== null)),
  ];
  const blocked = references
    .map((reference) => payouts.find((one) => one.reference === reference))
    .filter((one): one is PartnerPayout => one !== undefined);

  return (
    <section
      data-withheld
      className="grid gap-3 rounded-card border border-[rgba(var(--warnA),0.35)] bg-[rgba(var(--warnA),0.05)] p-5"
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-[14px] font-bold text-warn">{t.payouts.withheldHeading}</h2>
        <span className="ms-auto text-[14px] font-bold tabular-nums text-warn">
          {t.payouts.withheldTotal}:{' '}
          {[...totals].map(([code, sum]) => amount(sum.toFixed(2), code)).join(' · ')}
        </span>
      </div>

      <p className="text-[13px] leading-relaxed text-text2">{t.payouts.withheldNote}</p>

      {/*
        The sum actually stopped, said ONCE.

        Two things were wrong with saying it per row. It repeated identically on every stay
        blocking the same transfer — six rows, six copies of one sentence. And the header total was
        the disputed stays' own value, $344.10, while the money that cannot move is the whole
        transfer, $3,248.49: a true figure telling the wrong story, which is the shape this whole
        review keeps finding.
      */}
      {blocked.length > 0 ? (
        <p className="text-[13px] font-semibold text-warn">
          {blocked.length === 1
            ? fill(t.payouts.withheldBlocking, {
                reference: blocked[0]!.reference,
                amount: amount(blocked[0]!.netAmount, blocked[0]!.currencyCode),
              })
            : fill(t.payouts.withheldBlockingMany, {
                references: blocked.map((one) => one.reference).join(' · '),
              })}
        </p>
      ) : null}

      <ul className="grid gap-2">
        {rows.map((row) => (
          <li
            key={row.reference}
            className="grid gap-1 rounded-lg border border-line2 bg-card p-3 text-[13px]"
          >
            <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <Ltr className="font-mono text-[14px] text-text2">{row.reference}</Ltr>
              <span className="ms-auto font-bold tabular-nums text-text">
                {amount(row.amount, row.currencyCode)}
              </span>
            </div>
            <p className="text-[14px] text-faint">
              {t.payouts.withheldStay}: <Ltr>{row.checkIn}</Ltr> ←{' '}
              <Ltr>{row.checkOut}</Ltr> · {t.payouts.withheldOpened}:{' '}
              <Ltr>{row.openedAt.slice(0, 10)}</Ltr>
            </p>

            {/*
              ── why, and what has to happen (finding 209) ─────────────────────

              The reference used to sit in the line above as plain text, so «which dispute» was
              answered and «what is it about» was a navigation task. It is a LINK now — the dispute
              has its own screen since 223 — and it carries the complaint's kind and its state, so
              the row says what the money is waiting on rather than only that it is waiting.
            */}
            <p className="text-[14px] text-muted">
              {t.payouts.withheldWhy}: {disputeKind(row.disputeKind)} ·{' '}
              {disputeStatus(row.disputeStatus)} ·{' '}
              <Link
                href={`/disputes/${row.disputeReference}`}
                className="text-sky hover:underline"
              >
                <Ltr>{row.disputeReference}</Ltr>
              </Link>
            </p>

            {/*
              The release condition, and the ACTION where the action is theirs.

              A partner who has not answered is the reason the decision has not been taken — «the
              partner should not need to translate» applies to their own next step too. Once they
              have answered, the honest statement is that it is with SAFRA, which is also the
              reassurance they came to the page for.
            */}
            {row.responseCount === 0 ? (
              <p className="text-[14px] font-semibold leading-relaxed text-warn">
                {t.payouts.withheldReleaseNeedsYou}{' '}
                <Link
                  href={`/disputes/${row.disputeReference}`}
                  className="text-sky hover:underline"
                >
                  {t.payouts.withheldOpen}
                </Link>
              </p>
            ) : (
              <p className="text-[14px] leading-relaxed text-faint">
                {plural(t.payouts.withheldResponded, { count: row.responseCount })}{' '}
                {t.payouts.withheldRelease}
              </p>
            )}
          </li>
        ))}
      </ul>
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
      <h2 className="text-[13px] font-bold tracking-wide text-faint">
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
  const recovered = Number(payout.recoveryAmount) > 0;

  return (
    <Link
      href={`/payouts/${encodeURIComponent(payout.reference)}`}
      className="grid gap-3 rounded-card border border-line bg-card p-4 transition-colors hover:border-gold/40 sm:grid-cols-[1fr_auto] sm:items-center"
    >
      <span className="grid gap-1.5">
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <Ltr className="text-[14px] font-bold text-sky">{payout.reference}</Ltr>
          <span
            className={`rounded-full border px-2.5 py-0.5 text-[13px] font-bold ${TONES[statusTone(payout.status)]}`}
          >
            {payoutStatus(payout.status)}
          </span>
        </span>

        <span className="text-[13px] leading-relaxed text-faint">
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
          <span className="text-[13px] leading-relaxed text-warn">
            {t.payouts.holdReason}: {payout.holdReason}
          </span>
        ) : null}
      </span>

      <span className="grid gap-0.5 sm:justify-items-end sm:text-end">
        <span className="text-[18px] font-extrabold text-gold-read">
          <Ltr>{amount(payout.netAmount, payout.currencyCode)}</Ltr>
        </span>

        {fined ? (
          <span className="text-[14px] text-faint">
            {fill(t.payouts.afterFine, {
              gross: amount(payout.grossAmount, payout.currencyCode),
              fine: amount(payout.fineAmount, payout.currencyCode),
            })}
          </span>
        ) : null}

        {/*
          Why a net can be smaller than the stays add up to, for the OTHER reason.

          `fineAmount` was on the payload and on no screen until somebody noticed a partner
          opening a support ticket about a figure the data already explained. `recoveryAmount`
          arrived on 2026-09-07 and would have been the same defect on the same screen, so it says
          so here from the start — and only when it is not zero, because «ناقص 0» is noise.
        */}
        {recovered ? (
          <span className="text-[14px] text-faint">
            {fill(t.payouts.afterRecovery, {
              gross: amount(payout.grossAmount, payout.currencyCode),
              recovery: amount(payout.recoveryAmount, payout.currencyCode),
            })}
          </span>
        ) : null}
      </span>
    </Link>
  );
}
