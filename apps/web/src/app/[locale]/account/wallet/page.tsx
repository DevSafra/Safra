import type { Metadata } from 'next';
import Link from 'next/link';
import { getTranslations } from 'next-intl/server';

import { AccountShell } from '@/components/account-shell';
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

  const t = await getTranslations('account');

  const [wallet, transactions] = await Promise.all([
    getMyWallet(),
    getMyWalletTransactions(25, cursor || undefined),
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
          {/* ── §6.1's panel ───────────────────────────────────────────────── */}
          <section
            className="rounded-[18px] border p-[26px]"
            style={{
              background: 'linear-gradient(135deg, var(--color-band), var(--color-hero))',
              borderColor: 'rgba(var(--goldA), 0.35)',
            }}
          >
            <p className="text-[12px] font-extrabold tracking-[0.08em] text-gold">
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
                tone="text-gold"
              />
            </div>

            <div
              className="mt-[14px] flex flex-wrap items-baseline justify-between gap-3 border-t pt-[14px]"
              style={{ borderColor: 'rgba(var(--goldA), 0.2)' }}
            >
              <span className="text-sm text-muted">{t('walletTotalLabel')}</span>
              {/*
                The wallet's own balance, not the two cards added up.

                They are equal by construction — the split is derived FROM this figure and clamped to it
                — and printing the stored number rather than a sum is what makes that checkable. A total
                computed on the page could disagree with the balance the API holds; this one cannot.
              */}
              <span className="text-[16px] font-extrabold text-gold" dir="ltr">
                {formatMoney(balance.balance, balance.currencyCode, locale, {
                  exact: true,
                })}
              </span>
            </div>

            <p className="mt-3 text-xs leading-relaxed text-muted">
              {t('walletCombineNote')}
            </p>
          </section>

          {/* ── The statement, below the panel as §6.1 specifies ────────────── */}
          <section className="mt-8">
            <h2 className="font-display text-xl text-text">{t('walletStatement')}</h2>

            {entries && entries.items.length > 0 ? (
              <>
                <ul className="mt-3 space-y-2 text-sm">
                  {entries.items.map((entry) => (
                    <li
                      key={entry.id}
                      className="flex items-baseline justify-between gap-3 border-b border-line/50 pb-2 last:border-0"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-text">
                          {dynamicMessage(t, `reason.${entry.reason}`, entry.reason)}
                        </span>
                        <span className="block text-xs text-faint">
                          {entry.createdAt.slice(0, 10)}
                          {entry.bookingReference ? ` · ${entry.bookingReference}` : ''}
                        </span>
                      </span>
                      {/*
                        Signed, because a statement showing "10.00" for both a credit and a debit is
                        unreadable — the direction is the single most important thing on the line.
                      */}
                      <span
                        dir="ltr"
                        className={
                          entry.direction === 'credit'
                            ? 'shrink-0 text-ok'
                            : 'shrink-0 text-muted'
                        }
                      >
                        {entry.direction === 'credit' ? '+' : '−'}
                        {formatMoney(entry.amount, balance.currencyCode, locale)}
                      </span>
                    </li>
                  ))}
                </ul>

                {cursor || entries.nextCursor ? (
                  <nav
                    aria-label={t('walletStatement')}
                    className="mt-5 flex flex-wrap items-center gap-2"
                  >
                    {cursor ? (
                      <Link
                        href={`/${locale}/account/wallet`}
                        className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                      >
                        {t('firstPage')}
                      </Link>
                    ) : null}

                    {entries.nextCursor ? (
                      <Link
                        href={`/${locale}/account/wallet?cursor=${encodeURIComponent(entries.nextCursor)}`}
                        className="inline-flex min-h-10 items-center rounded-lg border border-line px-4 text-sm text-muted lg:min-h-0 lg:py-2"
                      >
                        {t('loadMore')}
                      </Link>
                    ) : null}
                  </nav>
                ) : null}
              </>
            ) : (
              <p className="mt-3 text-sm text-faint">{t('nothingWaiting')}</p>
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
    <div
      className="rounded-[14px] border px-5 py-[18px]"
      style={{
        background: 'rgba(var(--goldA), 0.06)',
        borderColor: 'rgba(var(--goldA), 0.22)',
      }}
    >
      <p className="text-sm text-muted">{title}</p>
      {/*
        36px/800, the handoff's figure size.

        The amount is ISOLATED rather than carrying `dir="ltr"`: an amount is a Latin run and needs its
        own order, but `dir` also flips the element's start edge, which left both figures hugging the
        left of an Arabic card while their titles sat on the right.
      */}
      <p className={`mt-1 text-[36px] leading-tight font-extrabold ${tone}`}>
        {ltrIsolate(amount)}
      </p>
      <p className="mt-2 text-[11.5px] leading-relaxed text-faint">{caption}</p>
    </div>
  );
}
