'use client';

import { useEffect, useState } from 'react';

import {
  ORNAMENT_CRESCENT,
  ORNAMENT_SUN,
  applyTheme,
  currentTheme,
  type Theme,
} from '@safra/ui';

import { t } from '@/lib/strings';

/**
 * Light/dark toggle for the staff console (Bashar, 2026-08-04).
 *
 * The console was dark-only — the gap report recorded that as a deliberate omission, since the
 * handoff's light palette (§9.2) existed but only the public app shipped a toggle. It does not
 * any more; the palette is in `globals.css` and this is the control.
 *
 * ## State is read from the DOM, not held here
 *
 * `ThemeScript` has already applied the saved value before this mounts, so initialising from
 * anything else means the icon can disagree with the screen.
 *
 * ## Why the first render is deliberately the dark icon
 *
 * There is no theme to read during server rendering — the choice lives in `localStorage`, which
 * only exists in the browser. Rendering the crescent and correcting it in the effect keeps the
 * markup identical on both sides; branching on anything client-only here is a hydration
 * mismatch, and this console has been broken by one of those before.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    /*
      `'dark'` for the unset case, not the OS preference. The console is designed dark and its
      CSS has no `prefers-color-scheme` rule, so this is what is actually on screen — and it
      keeps a staff member's light-mode laptop from silently relighting the console.
    */
    setTheme(currentTheme('dark'));
  }, []);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';

    setTheme(next);
    applyTheme(next);
  }

  /*
    The label names the DESTINATION, not the current state.

    A button labelled "dark mode" while dark is active is ambiguous read aloud — a screen-reader
    user cannot tell whether it reports a state or offers an action. "Switch to light mode" is
    unambiguous in both directions, and it is the one string here a sighted user never sees.
  */
  const label = theme === 'dark' ? t.dashboard.themeToLight : t.dashboard.themeToDark;

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="grid size-10 shrink-0 cursor-pointer place-items-center rounded-[9px] border border-line bg-field text-sm text-muted transition-colors hover:border-gold hover:text-gold"
    >
      <span aria-hidden>{theme === 'dark' ? ORNAMENT_CRESCENT : ORNAMENT_SUN}</span>
    </button>
  );
}
