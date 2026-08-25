'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

import { GIFT_CARD_AMOUNTS, isErrorCode, DEFAULT_MONEY_CURRENCY } from '@safra/contracts';
import { errorMessage } from '@safra/i18n';

import { formatMoney } from '@/lib/localise';
import { ltrIsolate } from '@/lib/bidi';
import type { Locale } from '@/i18n/routing';

/**
 * بطاقات الهدايا's two forms (handoff §6).
 *
 * Bashar, 2026-08-11: a customer should be able to "buy a card or input a card code to receive money in
 * his wallet". Both halves live here because they share the one thing that matters — a code is a BEARER
 * instrument, so neither form may hold one longer than it has to.
 *
 * ## Why these translate and format for themselves
 *
 * The first version took its copy, its money formatter and its error resolver as PROPS from the server
 * component, and that cannot work — in a way `pnpm verify` cannot see. React refuses to serialise a
 * function across the server/client boundary, so every render threw "Functions cannot be passed directly
 * to Client Components" and the page returned a 500 that only a browser reveals.
 *
 * `useTranslations` works here because `NextIntlClientProvider` wraps the app, and `errorMessage` and
 * `formatMoney` are pure lookups — `auth-form.tsx` already does exactly this. The result is simpler than
 * what it replaced: no label bags, no formatter plumbing, and the copy still comes from the catalogue.
 */

/**
 * Turns an API error body into the reader's own sentence.
 *
 * `isErrorCode` is the gate: only codes this project defines are translated. An unrecognised string from
 * upstream becomes the fallback rather than being rendered, so an error body cannot be used to put
 * chosen text on our own page.
 */
function apiMessage(payload: unknown, locale: Locale, fallback: string): string {
  const code =
    payload && typeof payload === 'object' && 'code' in payload
      ? String(payload.code)
      : '';

  return isErrorCode(code) ? errorMessage(code, locale) : fallback;
}

/** An amount, formatted and isolated — it is an LTR run in a sentence that may be Arabic. */
function money(amount: string, currency: string, locale: Locale): string {
  return ltrIsolate(formatMoney(amount, currency, locale, { exact: true }));
}

const BANNER = {
  ok: 'border-ok/40 bg-ok/10 text-ok',
  bad: 'border-bad/40 bg-bad/10 text-bad',
} as const;

const CONTROL =
  'min-h-10 rounded-lg border border-line bg-field px-3 py-2 text-text lg:min-h-0';

const SUBMIT =
  'min-h-10 w-fit cursor-pointer rounded-lg bg-gold px-5 text-sm font-semibold text-bg disabled:cursor-not-allowed disabled:opacity-60 lg:min-h-0 lg:py-2.5';

export function RedeemForm({ locale }: { readonly locale: Locale }) {
  const t = useTranslations('account');
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'ok' | 'bad'; text: string } | null>(
    null,
  );

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy || code.trim() === '') return;

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch(`/${locale}/api/account/gift-cards/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });

      const payload: unknown = await response.json().catch(() => null);

      setBusy(false);

      if (!response.ok) {
        setMessage({
          kind: 'bad',
          text: apiMessage(payload, locale, t('giftRedeemFailed')),
        });

        return;
      }

      /*
        Cleared on success. The field held a code that is now spent: leaving it invites a second submit
        that can only fail, and leaves a spendable-looking string on screen.
      */
      setCode('');

      const result = payload as {
        creditedAmount: string;
        creditedCurrency: string;
        walletBalance: string;
        walletCurrency: string;
      };

      setMessage({
        kind: 'ok',
        text: t('giftRedeemed', {
          amount: money(result.creditedAmount, result.creditedCurrency, locale),
          balance: money(result.walletBalance, result.walletCurrency, locale),
        }),
      });

      /* So the wallet badge in the sidebar and the card list below both catch up. */
      router.refresh();
    } catch {
      setBusy(false);
      setMessage({ kind: 'bad', text: t('giftRedeemFailed') });
    }
  }

  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="grid gap-3 rounded-card border border-line bg-card p-5"
    >
      <h2 className="font-display text-lg text-text">{t('giftRedeemTitle')}</h2>

      {message ? (
        <p
          role="alert"
          className={`rounded-lg border p-3 text-sm ${BANNER[message.kind]}`}
        >
          {message.text}
        </p>
      ) : null}

      <label className="grid gap-1">
        <span className="text-sm text-muted">{t('giftCodeLabel')}</span>
        {/*
          `field-ltr` and a monospace face: a code is a Latin and numeric run on a line that may be
          Arabic, and the grouping is only readable when every symbol has the same width. The class keeps
          the order left to right while leaving the value at the reader's start edge — `dir="ltr"` moved
          it to the left of an Arabic form, which is the bug Bashar reported on الملف الشخصي.

          `autoComplete="off"` with `spellCheck={false}`, because neither a password manager nor a spell
          checker should take an interest in a one-time bearer string.
        */}
        <input
          name="code"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          autoComplete="off"
          spellCheck={false}
          maxLength={64}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          className={`${CONTROL} field-ltr font-mono tracking-wider`}
          required
        />
        <span className="text-xs text-faint">{t('giftCodeHint')}</span>
      </label>

      <button type="submit" disabled={busy} className={SUBMIT}>
        {busy ? t('giftRedeeming') : t('giftRedeemSubmit')}
      </button>
    </form>
  );
}

export function BuyForm({
  locale,
  walletCurrency,
  spendable,
}: {
  readonly locale: Locale;
  /**
   * The wallet's currency, for the amount ladder.
   *
   * The card is issued in whatever the wallet holds, so the ladder has to say so — «50.00» with no
   * currency beside it is the one thing somebody buying a gift must not have to guess. Empty when the
   * reader has no wallet yet, in which case the bare figure is shown rather than a wrong symbol.
   */
  readonly walletCurrency: string;
  /**
   * The part of the balance a card may actually be bought with — الرصيد الحالي, not the total.
   *
   * Shown under the amount, because the alternative is what Bashar hit (2026-08-12): pick an amount the
   * TOTAL covers, submit, and get told the rule. Naming the spendable figure up front turns a refusal
   * into a choice. An empty string when there is no wallet yet, in which case there is nothing to state.
   */
  readonly spendable: string;
}) {
  const t = useTranslations('account');
  const router = useRouter();
  const [amount, setAmount] = useState<string>(GIFT_CARD_AMOUNTS[0]);
  const [recipientName, setRecipientName] = useState('');
  const [recipientEmail, setRecipientEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  /**
   * The bought card's code, in component state and nowhere else.
   *
   * Not in the URL, not in `localStorage`, not in a cookie. It lives exactly as long as this component
   * stays mounted, which is the shortest life that still lets somebody copy it — a navigation loses it,
   * and the panel says so before they navigate.
   */
  const [issued, setIssued] = useState<{ code: string; balance: string } | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();

    if (busy) return;

    setBusy(true);
    setError(null);

    /* Omitted rather than sent blank: the schema treats an absent field as "no recipient given". */
    const body: Record<string, string> = { amount };

    if (recipientName.trim() !== '') body['recipientName'] = recipientName.trim();
    if (recipientEmail.trim() !== '') body['recipientEmail'] = recipientEmail.trim();

    try {
      const response = await fetch(`/${locale}/api/account/gift-cards`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      const payload: unknown = await response.json().catch(() => null);

      setBusy(false);

      if (!response.ok) {
        setError(apiMessage(payload, locale, t('giftBuyFailed')));

        return;
      }

      const result = payload as {
        code: string;
        walletBalance: string;
        walletCurrency: string;
      };

      setIssued({
        code: result.code,
        balance: money(result.walletBalance, result.walletCurrency, locale),
      });
      setRecipientName('');
      setRecipientEmail('');
      setCopied(false);

      /* The list below and the wallet badge both change. */
      router.refresh();
    } catch {
      setBusy(false);
      setError(t('giftBuyFailed'));
    }
  }

  return (
    <div className="grid gap-3 rounded-card border border-line bg-card p-5">
      <h2 className="font-display text-lg text-text">{t('giftBuyTitle')}</h2>
      <p className="text-sm text-muted">{t('giftBuyIntro')}</p>

      {/*
        The code, once.

        Its own panel rather than a line in a banner: it cannot be recovered, so it has to be impossible
        to miss and easy to copy. The sentence under it says plainly that we cannot show it again,
        because a customer who assumes otherwise loses the card.
      */}
      {issued ? (
        <div
          role="alert"
          className="grid gap-2 rounded-lg border border-gold/50 bg-gold/10 p-4"
        >
          <p className="text-sm font-semibold text-gold">{t('giftCodeOnce')}</p>
          <p
            data-gift-code
            dir="ltr"
            className="font-mono text-lg tracking-widest break-all select-all text-text"
          >
            {issued.code}
          </p>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => {
                /* A refused clipboard is not worth a banner — the code carries `select-all`. */
                void navigator.clipboard
                  ?.writeText(issued.code)
                  .then(() => setCopied(true))
                  .catch(() => undefined);
              }}
              className="min-h-10 cursor-pointer rounded-lg border border-gold px-4 text-sm text-gold lg:min-h-0 lg:py-1.5"
            >
              {copied ? t('giftCopied') : t('giftCopy')}
            </button>
            <span className="text-xs text-faint">
              {t('giftBalanceAfter', { balance: issued.balance })}
            </span>
          </div>
          <p className="text-xs leading-relaxed text-muted">{t('giftCodeOnceBody')}</p>
        </div>
      ) : null}

      <form onSubmit={(event) => void submit(event)} className="grid gap-3">
        {error ? (
          <p role="alert" className={`rounded-lg border p-3 text-sm ${BANNER.bad}`}>
            {error}
          </p>
        ) : null}

        <label className="grid gap-1">
          <span className="text-sm text-muted">{t('giftAmountLabel')}</span>
          <select
            name="amount"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className={`${CONTROL} cursor-pointer`}
          >
            {GIFT_CARD_AMOUNTS.map((value) => (
              <option key={value} value={value}>
                {money(value, walletCurrency || DEFAULT_MONEY_CURRENCY, locale)}
              </option>
            ))}
          </select>
          {spendable === '' ? null : (
            <span className="text-xs text-faint">
              {t('giftSpendable', { amount: spendable })}
            </span>
          )}
        </label>

        <label className="grid gap-1">
          <span className="text-sm text-muted">{t('giftRecipientName')}</span>
          <input
            name="recipientName"
            value={recipientName}
            onChange={(event) => setRecipientName(event.target.value)}
            maxLength={120}
            className={CONTROL}
          />
        </label>

        <label className="grid gap-1">
          <span className="text-sm text-muted">{t('giftRecipientEmail')}</span>
          <input
            name="recipientEmail"
            value={recipientEmail}
            onChange={(event) => setRecipientEmail(event.target.value)}
            type="email"
            maxLength={254}
            /* An address is a Latin run; `field-ltr` orders it without moving it off the start edge. */
            className={`${CONTROL} field-ltr`}
          />
          <span className="text-xs text-faint">{t('giftRecipientNote')}</span>
        </label>

        <button type="submit" disabled={busy} className={SUBMIT}>
          {busy ? t('giftBuying') : t('giftBuySubmit')}
        </button>
      </form>
    </div>
  );
}
