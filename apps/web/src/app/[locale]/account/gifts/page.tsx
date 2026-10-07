import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { readShown, shownCount } from '@safra/contracts';

import { AccountShell } from '@/components/account-shell';
import { ListMore } from '@/components/list-more';
import { BuyForm, RedeemForm } from '@/components/gift-card-forms';
import { getAccountSummary, getMyGiftCards, getMyWallet } from '@/lib/account';
import { ACCOUNT_METADATA, requireAccount } from '@/lib/account-page';
import { formatMoney } from '@/lib/localise';
import { ltrIsolate } from '@/lib/bidi';
import { localStatus } from '@/lib/status-word';

/**
 * بطاقات الهدايا — handoff §6.
 *
 * Bashar, 2026-08-11: a customer should be able to "buy a card or input a card code to receive money in
 * his wallet". Two flows on one screen, plus the cards this reader has bought.
 *
 * ## What replaced the not-built panel
 *
 * That panel said gift cards are redeemed by their code and nothing linked a card to an account, so no
 * balance could be shown without guessing. Both halves of that are now answered rather than worked
 * around: a code is redeemed INTO the wallet, so there is no second balance to link or to display, and
 * the money lands where every other payment method can already spend it.
 *
 * ## The forms take DATA, never functions
 *
 * The first version passed a copy bag, a money formatter and an error resolver down as props. React
 * cannot serialise a function across the server/client boundary, so every render threw and the page
 * 500ed — invisibly to `pnpm verify`, which is why it took a browser to find. The forms now translate
 * and format for themselves with `useTranslations`; all they receive is the locale and the wallet's
 * currency, both plain strings.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = ACCOUNT_METADATA;

export default async function AccountGiftsPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { locale: requested } = await params;
  const { locale } = await requireAccount(requested, '/gifts');

  const summaryRead = await getAccountSummary();
  const summary =
    summaryRead === 'failed' || summaryRead === 'unauthenticated' ? null : summaryRead;

  const query = await searchParams;
  const cursor = typeof query['cursor'] === 'string' ? query['cursor'] : '';
  /* How much of the list to show: «عرض المزيد» adds fifteen (see @safra/contracts/show-more). */
  const shown = shownCount(query['shown']);

  const t = await getTranslations('account');
  const cards = await readShown(
    (limit, after) => getMyGiftCards(after, limit),
    shown,
    cursor || undefined,
  );

  /*
    The wallet is read for its COMPOSITION, not its total: a card may only be bought with الرصيد الحالي,
    so the figure the form should state is the balance minus the gift part. The summary above carries
    only the total, which is the number that made a refusal look arbitrary.

    A failed read leaves the hint off rather than blocking the form — the API refuses an unaffordable
    purchase on its own authority either way.
  */
  const walletRead = await getMyWallet();
  const wallet =
    walletRead === 'failed' || walletRead === 'unauthenticated'
      ? null
      : walletRead.wallet;

  const walletCurrency = wallet?.currencyCode ?? summary?.counters.walletCurrency ?? '';

  /*
    Balance minus the part that may not become a gift card — the RESTRICTED part, which is gift money
    and compensation together (Bashar, 2026-09-01).

    It was balance minus the gift part, and after compensation joined that rule this line printed a
    figure the purchase would then refuse: «$405.00 available to spend» over a wallet where all 405
    was compensation. That is the exact failure this hint was added for on 2026-08-12 — pick an
    amount the total covers, submit, and get told the rule — reopened by widening the rule and not
    the sentence.

    Both figures come from one read, so they cannot disagree.
  */
  const spendable = wallet
    ? formatMoney(
        Math.max(Number(wallet.balance) - Number(wallet.restrictedBalance), 0).toFixed(2),
        wallet.currencyCode,
        locale,
        { exact: true },
      )
    : '';

  return (
    <AccountShell locale={locale} active="gifts" summary={summary} title={t('navGifts')}>
      <p className="text-sm text-muted">{t('giftsIntro')}</p>

      <div className="mt-4 grid gap-6 lg:grid-cols-2 lg:items-start">
        <RedeemForm locale={locale} />

        <BuyForm locale={locale} walletCurrency={walletCurrency} spendable={spendable} />
      </div>

      {/* ── The cards this reader bought. Never their codes — only the last four. ── */}
      <section className="mt-8">
        <h2 className="font-display text-lg text-text">{t('giftMineTitle')}</h2>

        {cards === 'failed' ? (
          <p className="mt-3 text-sm text-bad">{t('loadFailed')}</p>
        ) : cards === 'unauthenticated' ? (
          <p className="mt-3 text-sm text-muted">{t('sessionExpired')}</p>
        ) : cards.items.length === 0 ? (
          <p className="mt-3 rounded-lg border border-line bg-card p-6 text-center text-sm text-muted">
            {t('giftNoneBought')}
          </p>
        ) : (
          <>
            <ul className="mt-3 space-y-3">
              {cards.items.map((card) => (
                <li
                  key={card.reference}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-line bg-card p-4"
                >
                  <span className="min-w-0">
                    <span className="block font-mono text-sm text-text">
                      {card.reference}
                    </span>
                    <span className="mt-1 block text-xs text-faint">
                      {t('giftCardEnding', { last4: ltrIsolate(card.codeLast4) })}
                      {card.recipientName
                        ? ` · ${t('giftRecipientFor', { name: card.recipientName })}`
                        : ''}
                    </span>
                  </span>

                  <span className="flex flex-col items-end gap-1">
                    <span className="font-semibold text-text" dir="ltr">
                      {formatMoney(card.originalAmount, card.currencyCode, locale, {
                        exact: true,
                      })}
                    </span>
                    <span className="text-sm text-muted">
                      {localStatus('giftCardStatus', card.status, locale)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>

            <ListMore
              path={`/${locale}/account/gifts`}
              cursor={cursor || undefined}
              shown={shown}
              nextCursor={cards.nextCursor}
              labels={{
                more: t('loadMore'),
                loading: t('loadingMore'),
                first: t('firstPage'),
              }}
            />
          </>
        )}
      </section>
    </AccountShell>
  );
}
