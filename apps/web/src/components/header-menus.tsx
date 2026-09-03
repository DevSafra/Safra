'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Modal } from '@safra/ui';

import { Flag } from '@/components/flags';
import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { swapLocale } from '@/lib/locale-path';

/**
 * The language and currency controls in the header, each opening a popup.
 *
 * Bashar, 2026-09-02: «add on it the current language but as a flag, on changing it, a popup window
 * should appear. The same thing with the currency. (same as booking.com)»
 *
 * ## The popup is `Modal` from `@safra/ui`
 *
 * Not `useConfirm()` — that asks a question with two buttons, and these are lists. But not a
 * hand-rolled box either: `Modal` is the shell `ConfirmDialog` and the image lightbox already sit
 * inside, and it owns the five things a popup is easy to get wrong — Escape, the backdrop, the
 * focus trap, returning focus to the trigger, and stopping the page behind from scrolling. That is
 * the whole point of «one popup, designed, used everywhere»: the CONTAINER is shared even when the
 * contents are not.
 *
 * ## Why the two behave differently inside
 *
 * They look like a pair and they are not. **Language is navigation** — three real anchors, so a
 * crawler can follow them and index the alternate-language version of a city page, which is what
 * §5.4 needs and what the footer's picker was built for. **Currency is a preference** — a form
 * POSTing to `/[locale]/currency`, because a GET that writes would let a prefetch or a pasted link
 * change somebody's currency, and Next prefetches every link in the viewport.
 *
 * ## The path comes from the BROWSER
 *
 * `usePathname()` and `useSearchParams()`, not a header the middleware set. The footer's picker
 * learnt this the hard way: `x-safra-pathname` is absent on any path containing a dot and stale in
 * a cached render, and its fallback was the home page — so the control that exists to keep a reader
 * in place sent them to the front door instead (Bashar, 2026-08-18). Reading the query string is
 * also why this needs the Suspense boundary: it opts the subtree out of static prerendering.
 */
export function HeaderMenus({
  locale,
  currency,
  currencies,
  labels,
}: {
  locale: Locale;
  currency: string;
  /** Code and symbol, from the cached catalogue the footer already reads. */
  currencies: readonly { code: string; symbol: string }[];
  labels: {
    language: string;
    currency: string;
    chooseLanguage: string;
    chooseCurrency: string;
    currencyHelp: string;
    close: string;
  };
}) {
  return (
    <div className="flex items-center gap-1">
      <Suspense fallback={<LanguageTrigger locale={locale} label={labels.language} />}>
        <LanguageMenu locale={locale} labels={labels} />
      </Suspense>
      <CurrencyMenu
        locale={locale}
        currency={currency}
        currencies={currencies}
        labels={labels}
      />
    </div>
  );
}

/* ── Language ────────────────────────────────────────────────────────────── */

/**
 * The closed control, and the fallback while the query string is being read.
 *
 * A separate component so the two render identically: a fallback that differed from the real
 * trigger would shift the header's layout the moment the boundary resolved.
 */
function LanguageTrigger({
  locale,
  label,
  onClick,
}: {
  locale: Locale;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      /*
        A stable seam for the browser tests, in the pattern the console's status pills already use
        (`data-status-pill`). The alternative is selecting on the `aria-label`, which is COPY — it
        differs per locale and changes whenever the catalogue does, so a test written against it
        breaks for reasons that have nothing to do with the control.
      */
      data-menu="language"
      aria-label={`${label}: ${LOCALE_LABELS[locale]}`}
      className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-lg px-2.5 py-2 text-sm text-text/85 transition-colors duration-200 ease-out-strong hover:bg-gold/10 hover:text-text sm:min-h-11"
    >
      <Flag locale={locale} className="h-4 w-6" />
      {/*
        The code, not the endonym: «العربية» beside two buttons and a wordmark is a third word on a
        bar that has no room for one. The endonym is in the popup, where it names the row.

        And below `sm` even the code goes — the flag alone is the control, which is what
        booking.com's own phone header does. The `aria-label` carries the full name either way, so
        nothing is lost to a screen reader by dropping two visible letters.
      */}
      <span className="hidden text-xs font-semibold tracking-wide uppercase sm:inline">
        {locale}
      </span>
    </button>
  );
}

function LanguageMenu({
  locale,
  labels,
}: {
  locale: Locale;
  labels: { language: string; chooseLanguage: string; close: string };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const query = useSearchParams().toString();

  return (
    <>
      <LanguageTrigger
        locale={locale}
        label={labels.language}
        onClick={() => setOpen(true)}
      />

      {open ? (
        <Modal
          title={labels.chooseLanguage}
          onClose={() => setOpen(false)}
          width="max-w-sm"
        >
          <ul className="flex flex-col gap-1">
            {routing.locales.map((code) => {
              const href = `${swapLocale(pathname, code)}${query ? `?${query}` : ''}`;
              const current = code === locale;

              return (
                <li key={code}>
                  {/*
                    A real anchor, and `hrefLang` on it: this popup is where a crawler finds the
                    alternate-language version of whatever page the reader is on.

                    `aria-current="true"` rather than a disabled row — the current language is a
                    legitimate destination (it reloads the page you are on) and removing it would
                    leave the list with no marker for where you already are.
                  */}
                  <Link
                    href={href}
                    hrefLang={code}
                    aria-current={current ? 'true' : undefined}
                    onClick={() => setOpen(false)}
                    className={`flex min-h-11 items-center gap-3 rounded-lg px-3 text-sm transition-colors duration-200 ease-out-strong ${
                      current
                        ? 'bg-gold/10 font-semibold text-text'
                        : 'text-muted hover:bg-field hover:text-text'
                    }`}
                  >
                    <Flag locale={code} className="h-5 w-7 shrink-0" />
                    <span className="flex-1">{LOCALE_LABELS[code]}</span>
                    {current ? (
                      <CheckIcon />
                    ) : (
                      <span className="text-[0.6875rem] tracking-wide text-faint uppercase">
                        {code}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>

          <CloseButton label={labels.close} onClick={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  );
}

/* ── Currency ────────────────────────────────────────────────────────────── */

function CurrencyMenu({
  locale,
  currency,
  currencies,
  labels,
}: {
  locale: Locale;
  currency: string;
  currencies: readonly { code: string; symbol: string }[];
  labels: {
    currency: string;
    chooseCurrency: string;
    currencyHelp: string;
    close: string;
  };
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const query = useSearchParams().toString();

  const symbolOf = (code: string) =>
    currencies.find((one) => one.code === code)?.symbol ?? code;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        data-menu="currency"
        aria-label={`${labels.currency}: ${currency}`}
        className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm text-text/85 transition-colors duration-200 ease-out-strong hover:bg-gold/10 hover:text-text sm:min-h-11"
      >
        <span aria-hidden className="text-[0.9375rem] leading-none">
          {symbolOf(currency)}
        </span>
        <span className="hidden text-xs font-semibold tracking-wide sm:inline">
          {currency}
        </span>
      </button>

      {open ? (
        <Modal
          title={labels.chooseCurrency}
          onClose={() => setOpen(false)}
          width="max-w-sm"
        >
          {/*
            A POST that redirects back, which is the shape `/[locale]/currency` enforces — a GET
            that writes would let a prefetch or a pasted link change somebody's preference.

            `next` carries the reader's current path AND query, so changing currency on
            `/ar/search?citySlug=damascus` returns them to that search rather than to the home
            page. The route rebuilds the destination and refuses anything that is not a single
            leading slash, so this value cannot send them off-origin.
          */}
          <form
            action={`/${locale}/currency`}
            method="post"
            className="flex flex-col gap-1"
          >
            <input
              type="hidden"
              name="next"
              value={`${pathname}${query ? `?${query}` : ''}`}
            />

            {currencies.map(({ code, symbol }) => {
              const current = code === currency;

              return (
                <button
                  key={code}
                  type="submit"
                  name="currency"
                  value={code}
                  aria-current={current ? 'true' : undefined}
                  className={`flex min-h-11 w-full cursor-pointer items-center gap-3 rounded-lg px-3 text-start text-sm transition-colors duration-200 ease-out-strong ${
                    current
                      ? 'bg-gold/10 font-semibold text-text'
                      : 'text-muted hover:bg-field hover:text-text'
                  }`}
                >
                  {/*
                    No box around the symbol (Bashar, 2026-09-03). It was a bordered chip, which
                    read as a control inside a row that is already a button — two nested things to
                    press, and the row's own selected state had to fight it. The fixed width stays:
                    it is what keeps «$», «€» and «ل.س» on one column so the codes beside them line
                    up.
                  */}
                  <span
                    aria-hidden
                    className="grid size-7 shrink-0 place-items-center text-[0.85rem]"
                  >
                    {symbol}
                  </span>
                  <span className="flex-1 tracking-wide">{code}</span>
                  {current ? <CheckIcon /> : null}
                </button>
              );
            })}
          </form>

          {/*
            Said here rather than nowhere: a converted figure is an estimate from one rate a staff
            member typed, and the booking is charged in the listing's own currency. The card prints
            the original underneath for the same reason.
          */}
          <p className="mt-3 text-[0.6875rem] leading-relaxed text-faint">
            {labels.currencyHelp}
          </p>

          <CloseButton label={labels.close} onClick={() => setOpen(false)} />
        </Modal>
      ) : null}
    </>
  );
}

/* ── Shared bits ─────────────────────────────────────────────────────────── */

function CloseButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <div className="mt-4 flex justify-end">
      <button
        type="button"
        onClick={onClick}
        className="min-h-10 cursor-pointer rounded-lg border border-line px-4 text-sm font-semibold text-text transition-[border-color,background-color] duration-200 ease-out-strong hover:border-gold/60 hover:bg-gold/10 sm:min-h-11"
      >
        {label}
      </button>
    </div>
  );
}

function CheckIcon() {
  return (
    <svg
      aria-hidden
      width="1.1em"
      height="1.1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0 text-gold"
    >
      <path d="m5 12.8 4.2 4.2L19 7.4" />
    </svg>
  );
}
