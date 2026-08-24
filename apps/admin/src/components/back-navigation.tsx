'use client';

import { useEffect, useState, type ReactNode } from 'react';

/**
 * Really back — to the page the reader actually came from (Bashar, 2026-08-24).
 *
 * > *"fix the back button navigation on the entire project. It should work as it should and
 * > navigate really back to the previous opened page."*
 *
 * ## What was wrong, and it was not the destination being incorrect
 *
 * «رجوع» has always gone somewhere sensible: `backTarget` REBUILDS the list URL from a literal base
 * path, carrying the page, the filters and the row fragment, and `?from=` lets one screen name the
 * screen it was opened from. That mechanism is good and it stays — it is what makes the trip work
 * with no JavaScript, and what makes a bookmarked detail page land somewhere useful.
 *
 * But a reconstruction is a GUESS at where the reader came from, and it is only right when the
 * caller remembered to say. Eleven of twelve detail screens resolve `?from=`; **two** of the screens
 * that link INTO them emit it. So opening a booking from the dashboard, a staff record from سجل
 * التدقيق, or a partner from a property returned the reader to the plain registry — a page they
 * had not been on, with whatever they had been reading gone.
 *
 * ## The fix is the browser's own history, with the reconstruction as the fallback
 *
 * The anchor keeps its `href`, so this is still a real link: middle-clickable, bookmarkable,
 * keyboard-navigable, and correct with JavaScript switched off. On an ordinary click, if the
 * previous entry is a page of THIS app, the browser goes back to it — the real one, with its scroll
 * position and its state, not a rebuilt approximation.
 *
 * ## Two signals, because ONE of them was an assumption that stopped being true
 *
 * This started as `document.referrer` alone, on the reasoning that the console navigates with real
 * document loads — the row links and section links are plain anchors, deliberately, so `:target`
 * tinting works. That was true when it was written and I made it false myself the same day, by
 * turning the pagination arrows into `<Link scroll={false}>` to stop the viewport jumping. After a
 * soft navigation `document.referrer` is whatever it was when the TAB was opened, so the check
 * silently stops firing and every back control quietly falls through to its rebuilt href.
 *
 * So there are two, and either is enough:
 *
 * - **`document.referrer`** — exact for a document load, which most of this console still is.
 * - **A tab-entry marker in `sessionStorage`** — the customer app's mechanism, which survives soft
 *   navigation. If the reader is not on the page this tab opened on, something of ours is behind
 *   them.
 *
 * Neither is a security boundary. `history.back()` takes no destination; it walks the browser's own
 * stack, which a crafted link cannot write.
 *
 * ## Why it cannot become an open redirect
 *
 * `history.back()` takes no destination. It walks the browser's own stack, which a crafted link
 * cannot write. The `href` is still built from a literal base path and an allow-listed origin —
 * that boundary is untouched, and this adds no second way to choose where the control goes.
 *
 * ## The three guards, each for a case that actually happens
 *
 * - **same origin** — somebody arriving from a search engine must not be sent back out of the app.
 * - **not this same page** — a form that POSTs and redirects to itself leaves its own URL as the
 *   referrer, and going "back" to it would reload the page the reader is trying to leave.
 * - **history to go back to** — a detail page opened in a fresh tab has none, and `back()` there
 *   does nothing at all, which reads as a dead control. The href handles it.
 */
const ENTRY_KEY = 'safra:tab-entry';

export function BackNavigation({
  href,
  ariaLabel,
  className,
  children,
}: {
  readonly href: string;
  readonly ariaLabel: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const [enteredElsewhere, setEnteredElsewhere] = useState(false);

  useEffect(() => {
    /* Read before writing, so the page that opens the tab records itself and reports false. */
    const entry = window.sessionStorage.getItem(ENTRY_KEY);

    if (entry === null) {
      window.sessionStorage.setItem(ENTRY_KEY, window.location.href);
      return;
    }

    setEnteredElsewhere(entry !== window.location.href);
  }, []);

  return (
    <a
      href={href}
      aria-label={ariaLabel}
      className={className}
      onClick={(event) => {
        /*
          Every modifier is left to the browser. Ctrl/⌘-click opens a new tab, shift opens a window,
          and a middle click never reaches this handler — intercepting those would break the one
          property that makes this a link rather than a button.
        */
        if (
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }

        const previous = document.referrer;
        const cameFromHere =
          previous.startsWith(`${window.location.origin}/`) &&
          previous !== window.location.href;

        if ((cameFromHere || enteredElsewhere) && window.history.length > 1) {
          event.preventDefault();
          window.history.back();
        }
      }}
    >
      {children}
    </a>
  );
}
