'use client';

import { useEffect, useState } from 'react';

import { ORNAMENT_CRESCENT, ORNAMENT_SUN } from './ornaments.js';
import { applyTheme, currentTheme, type Theme } from './theme.js';

export interface ThemeToggleProps {
  /**
   * The labels name the DESTINATION, not the current state.
   *
   * A button labelled "dark mode" while dark is active is ambiguous read aloud — a screen-reader
   * user cannot tell whether it reports a state or offers an action. "Switch to light mode" is
   * unambiguous in both directions, and it is the one string here a sighted user never sees.
   */
  readonly toLightLabel: string;
  readonly toDarkLabel: string;
  /**
   * What is actually on screen when nobody has chosen.
   *
   * Required rather than defaulted, for the reason `PasswordField` requires its labels: the answer
   * differs per app and a wrong default is invisible. Both staff surfaces pass `'dark'` — they are
   * designed dark and their CSS has no `prefers-color-scheme` rule, so `'dark'` is the truth about
   * the screen. The customer site, whose CSS does have the media query, would pass `'system'`.
   * Guessing here would put the icon out of step with the page.
   */
  readonly whenUnset: Theme | 'system';
}

/**
 * Light/dark toggle (Bashar, 2026-08-04 for the console; 2026-08-10 for لوحة الشريك).
 *
 * Shared for the same reason as `SidebarToggle`: both staff surfaces carry this control at the foot
 * of the sidebar, and one implementation is what keeps them from drifting.
 *
 * ## State is read from the DOM, not held here
 *
 * The pre-paint theme script has already applied the saved value before this mounts, so
 * initialising from anything else means the icon can disagree with the screen.
 *
 * ## Why the first render is deliberately the dark icon
 *
 * There is no theme to read during server rendering — the choice lives in `localStorage`, which
 * only exists in the browser. Rendering the crescent and correcting it in the effect keeps the
 * markup identical on both sides; branching on anything client-only here is a hydration mismatch,
 * and the console has been broken by one of those before.
 */
export function ThemeToggle({ toLightLabel, toDarkLabel, whenUnset }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(currentTheme(whenUnset));
  }, [whenUnset]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';

    setTheme(next);
    applyTheme(next);
  }

  const label = theme === 'dark' ? toLightLabel : toDarkLabel;

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
