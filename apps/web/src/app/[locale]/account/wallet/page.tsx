import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { SHOW_MORE_STEP, readShown, shownCount } from '@safra/contracts';

import { AccountShell } from '@/components/account-shell';
import { ListMore } from '@/components/list-more';
import { getAccountSummary, getMyWallet, getMyWalletTransactions } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { dynamicMessage } from '@/lib/dynamic-message';
import { formatMoney } from '@/lib/localise';
import { ltrIsolate } from '@/lib/bidi';

/**
 * محفظتي — handoff §6.1, which is the most tightly specified panel in the whole document.
 *
 * One panel on a `bandA → heroA` gradient, gold hairline, 18px radius, 26px padding, a gold eyebrow
 * «محفظة سفرة», then a `minmax(220px, 1fr)` grid of SEPARATE balance cards — the handoff calls that
 * separation "a hard requirement" — and a footer row with the summed total. Two when it was written,
 * three since compensation became a balance of its own (Bashar, 2026-09-01).
 *
 * ## Why the second card reads «—»
 *
 * §6.1 wants a spendable gift-card balance. The schema cannot answer it: `gift_cards` records who
 * BOUGHT a card (`purchased_by_customer_id`) and a free-text `recipient_email`, but nothing links a
 * card to the account that may spend it — a card is redeemed by its code. So the card is drawn, to
 * spec, showing «—» and saying why (Bashar, 2026-08-10).
 *
 * Rendering `0` instead was the alternative and is worse: "null is not zero" is a rule this codebase
 * enforces precisely because an invented financial figure is more damaging than an absent one. The
 * total therefore sums what is KNOWN, which is the wallet alone.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountWalletPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/wallet');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';
  /* How much of the list to show: «عرض المزيد» adds fifteen (see @safra/contracts/show-more). */
  const shown = shownCount(query['shown']);

  const t = await getTranslations('account');

  const [wallet, transactions] = await Promise.all([
    getMyWallet(),
    readShown(
      (limit, after) => getMyWalletTransactions(limit, after),
      shown,
      cursor || undefined,
    ),
  ]);

  const failed = wallet === 'failed' || transactions === 'failed';
  const expired = wallet === 'unauthenticated' || transactions === 'unauthenticated';
  const balance = failed || expired ? null : wallet.wallet;

  /*
    Three parts of one balance, and only two of them are sent (Bashar, 2026-09-01).

    The API sends the total, the gift part and the RESTRICTED part — gift money and compensation
    together, which is the set that may never be paid out. The two figures drawn here are the
    differences: what the customer funded is the balance minus the restricted part, and the
    compensation is the restricted part minus the gift.

    Derived rather than sent because the four figures are not independent — they are one number and
    two cuts through it — and four numbers that must agree are three chances to disagree. The total
    printed beneath them is the stored balance, so a reader can check the arithmetic themselves.

    `Math.max` on the compensation for one wallet in the database: a load test wrote movements whose
    recorded order does not match the order they applied, and its restricted part was clamped down to
    its balance. A negative card would be arithmetic leaking onto a screen.

    `toFixed(2)` because `formatMoney` takes a decimal STRING — the only arithmetic on this page, and
    between figures already exact to the cent.
  */
  const own = balance
    ? (Number(balance.balance) - Number(balance.restrictedBalance)).toFixed(2)
    : '0.00';
  const compensation = balance
    ? Math.max(
        Number(balance.restrictedBalance) - Number(balance.giftBalance),
        0,
      ).toFixed(2)
    : '0.00';
  const entries = failed || expired ? null : transactions;

  return (
    <AccountShell
      locale={locale}
      active="wallet"
      summary={summary}
      title={t('navWallet')}
    >
      {failed ? (
        <p className="text-sm text-bad">{t('loadFailed')}</p>
      ) : expired ? (
        <p className="text-sm text-muted">{t('sessionExpired')}</p>
      ) : balance === null ? (
        /*
          No wallet is not an error. It is the ordinary state for a customer who has never been
          compensated, and rendering it as a failure would alarm almost everybody.
        */
        <p className="rounded-lg border border-line bg-card p-4 text-sm text-faint">
          {t('walletEmpty')}
        </p>
      ) : (
        <>
          {/*
            ── §6.1's panel ─────────────────────────────────────────────────

            On the page's own card surface, with one soft gold light in the reading-start corner
            (Bashar, 2026-10-07: «I do not like the background colours here»). It was the handoff's
            band-to-hero gradient, a cool lavender, with every balance card washed 6% gold on top of
            it; gold over blue mixes to a muddy grey-beige, which is what he was looking at. Now the
            gold is a hairline and a light, never a tint laid over another colour.

            `100% 0%` is the top RIGHT, where an Arabic reader starts; the same corner the heading
            sits in, so the light falls where the eye lands. In LTR locales it sits at the far end,
            which is quieter and still reads as a single deliberate light.
          */}
          <section
            className="rounded-[18px] border p-[26px]"
            style={{
              background:
                'radial-gradient(120% 140% at 100% 0%, rgba(var(--goldA), 0.10), transparent 55%), var(--color-card)',
              borderColor: 'rgba(var(--goldA), 0.35)',
            }}
          >
            <p className="text-13 font-extrabold tracking-[0.08em] text-gold-read">
              {t('walletEyebrow')}
            </p>

            {/* The handoff's own grid: `repeat(auto-fit, minmax(220px, 1fr))`, gap 18px. */}
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-[18px]">
              {/*
                Three REAL figures now (Bashar, 2026-09-01), and the third is not decoration.

                A compensation buys a stay and can never be taken out in cash or turned into a gift
                card. Printed inside «الرصيد الحالي» it would be money the screen says is available
                and the platform then refuses — the shape this codebase keeps paying for. So it is
                its own card, with its own sentence, beside the money that really is the customer's.

                They still sum to the balance printed beneath them.
              */}
              <BalanceCard
                title={t('walletCurrentTitle')}
                amount={formatMoney(own, balance.currencyCode, locale, { exact: true })}
                caption={t('walletCurrentCaption')}
                tone="text-text"
              />
              <BalanceCard
                title={t('walletCompensationTitle')}
                amount={formatMoney(compensation, balance.currencyCode, locale, {
                  exact: true,
                })}
                caption={t('walletCompensationCaption')}
                tone="text-text"
              />
              <BalanceCard
                title={t('walletGiftTitle')}
                amount={formatMoney(balance.giftBalance, balance.currencyCode, locale, {
                  exact: true,
                })}
                caption={t('walletGiftCaption')}
                tone="text-gold-read"
              />
            </div>

            {/*
              The prototype's footer row (SAFRA 20.08 §6.1): the total and its label together at the
              start, the note on combining balances pushed to the far end of the SAME row on a wide
              screen. It was a second paragraph under the rule, which read as a footnote to the
              panel rather than as the sentence that tells you what the total is for.
            */}
            <div
              className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t pt-[14px]"
              style={{ borderColor: 'rgba(var(--goldA), 0.2)' }}
            >
              <span className="text-sm text-muted">{t('walletTotalLabel')}</span>
              {/*
                The wallet's own balance, not the cards added up.

                They are equal by construction (the split is derived FROM this figure and clamped to
                it), and printing the stored number rather than a sum is what makes that checkable. A
                total computed on the page could disagree with the balance the API holds; this one
                cannot.
              */}
              <span className="text-16 font-extrabold text-gold-read tabular-nums">
                {ltrIsolate(
                  formatMoney(balance.balance, balance.currencyCode, locale, {
                    exact: true,
                  }),
                )}
              </span>
              <span className="max-w-[380px] text-xs leading-[1.8] text-balance text-muted sm:ms-auto">
                {t('walletCombineNote')}
              </span>
            </div>
          </section>

          {/*
            ── The statement, in its own card as the prototype draws it ──────────

            One tile per movement, amount FIRST: on a statement the figure and its direction are the
            thing being read, and the reason explains it. Its colour says which way the money went
            and so does its sign, because colour alone is not an answer for everybody; a drawn arrow
            and a word for screen readers say it a third way.

            Fifteen at a time with «عرض المزيد» at the foot (Bashar, 2026-10-07). The rows a press
            added rise into place, so the eye sees where the old statement ended.
          */}
          <section
            aria-labelledby="wallet-statement"
            className="mt-6 rounded-[15px] border bg-card p-[18px]"
            style={{ borderColor: 'rgba(var(--goldA), 0.14)' }}
          >
            <h2
              id="wallet-statement"
              className="font-display text-lg font-bold text-text"
            >
              {t('walletStatement')}
            </h2>

            {entries && entries.items.length > 0 ? (
              <>
                <ul className="mt-3 grid gap-2">
                  {entries.items.map((entry, index) => {
                    const credit = entry.direction === 'credit';
                    /* Only the rows the last press added; never on the first screenful. */
                    const fresh =
                      shown > SHOW_MORE_STEP && index >= shown - SHOW_MORE_STEP;

                    return (
                      <li
                        key={entry.id}
                        className={`grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-1.5 rounded-[10px] border border-line bg-field px-3.5 py-[11px] sm:grid-cols-[auto_minmax(5.5rem,auto)_1fr_auto] ${fresh ? 'row-rise' : ''}`}
                      >
                        <span
                          aria-hidden="true"
                          className={`grid size-7 shrink-0 place-items-center rounded-full ${
                            credit ? 'bg-ok/12 text-ok' : 'bg-line/60 text-muted'
                          }`}
                        >
                          <svg
                            viewBox="0 0 16 16"
                            className={`size-3.5 ${credit ? '' : 'rotate-180'}`}
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.75"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          >
                            <path d="M8 3v10M4 9l4 4 4-4" />
                          </svg>
                        </span>

                        {/*
                          Signed, because a statement showing «10.00» for both a credit and a debit
                          is unreadable. Isolated rather than `dir="ltr"`, so the minus stays in
                          front of the figure without flipping which side the element sits on.
                        */}
                        <span
                          className={`text-15 font-extrabold tabular-nums ${
                            credit ? 'text-ok' : 'text-text'
                          }`}
                        >
                          <span className="sr-only">
                            {credit ? t('walletIn') : t('walletOut')}{' '}
                          </span>
                          {ltrIsolate(
                            `${credit ? '+' : '−'}${formatMoney(entry.amount, balance.currencyCode, locale)}`,
                          )}
                        </span>

                        {/*
                          Below the figure on a phone, beside it from `sm` up. Squeezed into one
                          row at 390px the reason got the leftovers and broke every two words.
                        */}
                        <span className="col-span-full min-w-0 ps-10 sm:order-none sm:col-span-1 sm:ps-0 max-sm:order-last">
                          <span className="block text-13 text-text">
                            {dynamicMessage(t, `reason.${entry.reason}`, entry.reason)}
                          </span>
                          {entry.bookingReference ? (
                            <span className="block text-xs text-faint">
                              {ltrIsolate(entry.bookingReference)}
                            </span>
                          ) : null}
                        </span>

                        <span className="justify-self-end text-xs text-faint tabular-nums">
                          {ltrIsolate(entry.createdAt.slice(0, 10))}
                        </span>
                      </li>
                    );
                  })}
                </ul>

                <ListMore
                  path={`/${locale}/account/wallet`}
                  cursor={cursor || undefined}
                  shown={shown}
                  nextCursor={entries.nextCursor}
                  labels={{
                    more: t('loadMore'),
                    loading: t('loadingMore'),
                    first: t('firstPage'),
                  }}
                />
              </>
            ) : (
              <p className="mt-3 rounded-[10px] border border-dashed border-line px-4 py-6 text-center text-sm text-muted">
                {t('walletStatementEmpty')}
              </p>
            )}
          </section>
        </>
      )}
    </AccountShell>
  );
}

/** One of §6.1's balance cards. Same box, different figure — the separation is the point. */
function BalanceCard({
  title,
  amount,
  caption,
  tone,
}: {
  readonly title: string;
  readonly amount: string;
  readonly caption: string;
  readonly tone: string;
}) {
  return (
    /*
      A plain neutral tile: the field colour and the ordinary hairline. The figures carry the colour
      (ink for money you hold, gold for gift balance), so the boxes around them do not need to.
    */
    <div className="rounded-card border border-line bg-field px-5 py-[18px]">
      <p className="text-sm text-muted">{title}</p>
      {/*
        36px/800, the handoff's figure size.

        The amount is ISOLATED rather than carrying `dir="ltr"`: an amount is a Latin run and needs its
        own order, but `dir` also flips the element's start edge, which left both figures hugging the
        left of an Arabic card while their titles sat on the right.
      */}
      <p className={`mt-1 text-36 leading-tight font-extrabold ${tone}`}>
        {ltrIsolate(amount)}
      </p>
      <p className="mt-2 text-13 leading-relaxed text-faint">{caption}</p>
    </div>
  );
}
