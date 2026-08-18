'use client';

import { useEffect } from 'react';
import { usePathname } from 'next/navigation';

import { themeStorageKey } from '@safra/ui';

/**
 * Puts `data-theme` back after a client-side navigation.
 *
 * ## The hole this closes
 *
 * The theme is an attribute on `<html>`, and `<html>` is rendered by the LAYOUT. `/ar` and `/en`
 * are different instances of that layout, so changing language re-renders it and React writes the
 * props it was given — dropping any attribute it did not write itself. The layout therefore emits
 * `data-theme` from the cookie so React owns it.
 *
 * That works only when the render that React reconciles against actually READ the cookie. It does
 * not when the payload is a statically prerendered one (`●` in the build output, which is most of
 * this app), one prefetched earlier in the session, or one served from the browser's cache — none
 * of those saw a cookie, so none carries the attribute, and the theme silently reverts to the
 * default on navigation. Observed here as `data-theme` going from `light` to `null` across a
 * language change, and reported by Bashar (2026-08-18) as the theme changing when he switched
 * language — repeatedly, because each earlier fix removed a different cause of the same symptom.
 *
 * ## Why an effect rather than more server rendering
 *
 * The stored choice is the truth, and it lives in the browser. Anything server-side depends on the
 * render being dynamic, which is a property of caching we do not want to promise on every route —
 * `/ar` alone being static is enough to bring this back. Re-asserting from storage costs one read
 * per navigation and cannot be undone by a cache.
 *
 * It only ever WRITES when the attribute and the stored value disagree, so it does not fight the
 * server, does not run on first paint (`THEME_SCRIPT` has already done that, before paint, which is
 * what stops the flash), and cannot loop.
 */
export function ThemeKeeper() {
  const pathname = usePathname();

  useEffect(() => {
    let stored: string | null;

    try {
      stored = localStorage.getItem(themeStorageKey('web'));
    } catch {
      /* Private browsing. There is no stored choice to restore. */
      return;
    }

    const root = document.documentElement;
    const showing = root.dataset['theme'] ?? null;

    if (stored !== 'dark' && stored !== 'light') {
      /*
        No choice was ever made, so the default is correct — but an attribute may be left over from
        a payload rendered for somebody who HAD chosen. Clearing it returns the page to its default
        rather than leaving another render's answer on screen.
      */
      if (showing !== null) delete root.dataset['theme'];

      return;
    }

    if (showing !== stored) root.dataset['theme'] = stored;
  }, [pathname]);

  return null;
}
