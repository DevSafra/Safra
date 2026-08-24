'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Really back — to the page the reader came from (Bashar, 2026-08-24).
 *
 * The customer app's twin of the console's `BackNavigation`, and it needs a DIFFERENT signal for
 * the same question, which is the whole reason this file exists rather than a shared one.
 *
 * ## Why not `document.referrer`, which the console uses
 *
 * The console navigates with real document loads — plain anchors, deliberately, so `:target`
 * tinting works. Every navigation is a document load there, so `document.referrer` IS the previous
 * page. This app navigates with `next/link`, so a soft navigation leaves `document.referrer` as
 * whatever it was when the TAB was opened. Using it here would mean the check either never fires or
 * fires on a page from ten navigations ago.
 *
 * ## The signal: was this tab opened on this page?
 *
 * One key in `sessionStorage`, written by the first mount in the tab. If the reader is still on
 * that page, nothing of ours is behind them and `back()` would leave the site or do nothing. If
 * they are anywhere else, they arrived by navigating within the app and the previous entry is ours.
 *
 * `sessionStorage` rather than `localStorage` because it is per TAB, which is exactly the scope of
 * a history stack. Two tabs on two products do not share an answer.
 *
 * ## Rendered as a real link either way
 *
 * The `href` is always present, so this is middle-clickable, bookmarkable, keyboard-navigable and
 * correct with JavaScript off — and it is what a reader who opened this page directly gets, which
 * is the case the enhancement cannot serve. The behaviour degrades to exactly what it was.
 *
 * ## It cannot become an open redirect
 *
 * `router.back()` takes no destination; it walks the browser's own stack, which a crafted link
 * cannot write. The `href` is built by the caller from a literal path, unchanged.
 */
const ENTRY_KEY = 'safra:tab-entry';

export function BackNavigation({
  href,
  className,
  children,
}: {
  readonly href: string;
  readonly className: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [canGoBack, setCanGoBack] = useState(false);

  useEffect(() => {
    /*
      Read BEFORE writing, so the page that opens the tab records itself and reports false, and
      every page after it compares against that record. Writing first would make every page look
      like the entry page.
    */
    const entry = window.sessionStorage.getItem(ENTRY_KEY);

    if (entry === null) {
      window.sessionStorage.setItem(ENTRY_KEY, window.location.href);
      return;
    }

    setCanGoBack(entry !== window.location.href && window.history.length > 1);
  }, []);

  return (
    <a
      href={href}
      className={className}
      onClick={(event) => {
        /* Modifiers are the browser's. A new tab has no history and must get the href. */
        if (
          !canGoBack ||
          event.defaultPrevented ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey ||
          event.button !== 0
        ) {
          return;
        }

        event.preventDefault();
        router.back();
      }}
    >
      {children}
    </a>
  );
}
