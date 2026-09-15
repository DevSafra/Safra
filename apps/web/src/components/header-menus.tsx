'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';

import { Modal } from '@safra/ui';

import { Flag } from '@/components/flags';
import { LOCALE_LABELS, type Locale, routing } from '@/i18n/routing';
import { swapLocale } from '@/lib/locale-path';

/**
 * The LANGUAGE control in the header, opening a popup.
 *
 * There was a currency control beside it until 2026-09-14, when Bashar removed every currency but
 * the dollar: «keep only USD for everything… remove the change currency from the navbar and
 * footer». A picker offering one option is a control that cannot do anything.
 *
 * Bashar, 2026-09-02: «add on it the current language but as a flag, on changing it, a popup window
 * should appear. (same as booking.com)»
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
 * ## Language is NAVIGATION
 *
 * Three real anchors, so a crawler can follow them and index the alternate-language version of a
 * city page — what §5.4 needs, and what the footer's picker was built for. The currency control
 * that used to sit beside it was a preference instead, and POSTed for that reason; with one
 * currency there is no preference left to express.
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
  labels,
}: {
  locale: Locale;
  labels: {
    language: string;
    chooseLanguage: string;
    close: string;
  };
}) {
  return (
    <div className="flex items-center gap-1">
      <Suspense fallback={<LanguageTrigger locale={locale} label={labels.language} />}>
        <LanguageMenu locale={locale} labels={labels} />
      </Suspense>
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
                      <span className="text-[13px] tracking-wide text-faint uppercase">
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
      className="shrink-0 text-gold-read"
    >
      <path d="m5 12.8 4.2 4.2L19 7.4" />
    </svg>
  );
}
