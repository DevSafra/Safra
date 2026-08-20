'use client';

import { useEffect, useState } from 'react';

import { applyTheme, currentTheme, type Theme, type ThemeSurface } from './theme.js';

/**
 * The two faces of the toggle, as drawings rather than as characters.
 *
 * They were `☀` and `☾` from `ornaments.ts` (Bashar, 2026-08-14: change the icons inside the
 * button). A Unicode glyph in a control is at the mercy of the font that happens to resolve it —
 * `☀` renders as a hairline outline in one family and a filled disc in another, some platforms
 * substitute a colour emoji at a size nothing else on the row matches, and none of it inherits the
 * button's weight. A path scales with the box, takes `currentColor`, and looks the same on every
 * machine.
 *
 * `aria-hidden` on both: the button's `aria-label` already says what pressing it does, and an
 * unlabelled graphic beside that label would be announced twice or as nothing.
 *
 * `size-[18px]` inside a 40px button — the icon is the control's content, not its footprint; the
 * remaining space is the touch target the responsive rule requires below `lg`.
 */
function SunIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
      /*
        `data-theme-icon` so a browser test can say WHICH icon is drawn.

        There is nothing else to assert on: both icons are an `<svg>` with one `<path>`, and a
        test that matched on path data would fail the next time the drawing is redrawn rather than
        when the RULE is broken. The rule is "the icon names the destination", and this attribute
        is the only thing that states which icon this is.
      */
      data-theme-icon="sun"
      className="size-[18px]"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        clipRule="evenodd"
        d="M11.9999 2.40002C12.3182 2.40002 12.6234 2.52645 12.8484 2.7515C13.0735 2.97654 13.1999 3.28176 13.1999 3.60002V4.80002C13.1999 5.11828 13.0735 5.42351 12.8484 5.64855C12.6234 5.8736 12.3182 6.00002 11.9999 6.00002C11.6816 6.00002 11.3764 5.8736 11.1514 5.64855C10.9263 5.42351 10.7999 5.11828 10.7999 4.80002V3.60002C10.7999 3.28176 10.9263 2.97654 11.1514 2.7515C11.3764 2.52645 11.6816 2.40002 11.9999 2.40002ZM16.7999 12C16.7999 13.2731 16.2942 14.494 15.394 15.3941C14.4938 16.2943 13.2729 16.8 11.9999 16.8C10.7269 16.8 9.50596 16.2943 8.60579 15.3941C7.70562 14.494 7.1999 13.2731 7.1999 12C7.1999 10.727 7.70562 9.50609 8.60579 8.60591C9.50596 7.70574 10.7269 7.20002 11.9999 7.20002C13.2729 7.20002 14.4938 7.70574 15.394 8.60591C16.2942 9.50609 16.7999 10.727 16.7999 12ZM16.2431 17.94L17.0915 18.7884C17.3178 19.007 17.6209 19.128 17.9356 19.1252C18.2502 19.1225 18.5512 18.9963 18.7737 18.7738C18.9962 18.5513 19.1224 18.2503 19.1251 17.9357C19.1278 17.6211 19.0069 17.3179 18.7883 17.0916L17.9399 16.2432C17.7136 16.0246 17.4105 15.9037 17.0958 15.9064C16.7812 15.9092 16.4802 16.0354 16.2577 16.2578C16.0352 16.4803 15.909 16.7813 15.9063 17.0959C15.9036 17.4106 16.0245 17.7137 16.2431 17.94ZM18.7871 5.21162C19.0121 5.43666 19.1384 5.74183 19.1384 6.06002C19.1384 6.37822 19.0121 6.68339 18.7871 6.90842L17.9399 7.75682C17.8292 7.87144 17.6968 7.96286 17.5504 8.02575C17.404 8.08864 17.2465 8.12174 17.0872 8.12313C16.9278 8.12451 16.7698 8.09415 16.6224 8.03381C16.4749 7.97347 16.3409 7.88437 16.2282 7.7717C16.1156 7.65903 16.0265 7.52505 15.9661 7.37757C15.9058 7.23009 15.8754 7.07208 15.8768 6.91274C15.8782 6.75341 15.9113 6.59594 15.9742 6.44954C16.0371 6.30313 16.1285 6.17072 16.2431 6.06002L17.0915 5.21162C17.3165 4.98666 17.6217 4.86028 17.9399 4.86028C18.2581 4.86028 18.5621 4.98666 18.7871 5.21162ZM20.3999 13.2C20.7182 13.2 21.0234 13.0736 21.2484 12.8486C21.4735 12.6235 21.5999 12.3183 21.5999 12C21.5999 11.6818 21.4735 11.3765 21.2484 11.1515C21.0234 10.9265 20.7182 10.8 20.3999 10.8H19.1999C18.8816 10.8 18.5764 10.9265 18.3514 11.1515C18.1263 11.3765 17.9999 11.6818 17.9999 12C17.9999 12.3183 18.1263 12.6235 18.3514 12.8486C18.5764 13.0736 18.8816 13.2 19.1999 13.2H20.3999ZM11.9999 18C12.3182 18 12.6234 18.1265 12.8484 18.3515C13.0735 18.5765 13.1999 18.8818 13.1999 19.2V20.4C13.1999 20.7183 13.0735 21.0235 12.8484 21.2486C12.6234 21.4736 12.3182 21.6 11.9999 21.6C11.6816 21.6 11.3764 21.4736 11.1514 21.2486C10.9263 21.0235 10.7999 20.7183 10.7999 20.4V19.2C10.7999 18.8818 10.9263 18.5765 11.1514 18.3515C11.3764 18.1265 11.6816 18 11.9999 18ZM6.0599 7.75682C6.17132 7.86832 6.3036 7.95677 6.4492 8.01714C6.5948 8.07751 6.75086 8.10861 6.90848 8.10867C7.0661 8.10872 7.22218 8.07773 7.36782 8.01747C7.51347 7.9572 7.64581 7.86884 7.7573 7.75742C7.86879 7.64601 7.95725 7.51373 8.01762 7.36813C8.07799 7.22253 8.10909 7.06647 8.10915 6.90885C8.1092 6.75123 8.07821 6.59514 8.01795 6.4495C7.95768 6.30386 7.86932 6.17152 7.7579 6.06002L6.9083 5.21162C6.68198 4.99303 6.37886 4.87208 6.06422 4.87482C5.74958 4.87755 5.44861 5.00375 5.22612 5.22624C5.00363 5.44873 4.87743 5.74971 4.87469 6.06434C4.87196 6.37898 4.99291 6.6821 5.2115 6.90842L6.0599 7.75682ZM7.7567 17.94L6.9083 18.7884C6.68198 19.007 6.37886 19.128 6.06422 19.1252C5.74958 19.1225 5.44861 18.9963 5.22612 18.7738C5.00363 18.5513 4.87743 18.2503 4.87469 17.9357C4.87196 17.6211 4.99291 17.3179 5.2115 17.0916L6.0599 16.2432C6.28623 16.0246 6.58935 15.9037 6.90398 15.9064C7.21862 15.9092 7.51959 16.0354 7.74208 16.2578C7.96457 16.4803 8.09078 16.7813 8.09351 17.0959C8.09625 17.4106 7.97529 17.7137 7.7567 17.94ZM4.7999 13.2C5.11816 13.2 5.42339 13.0736 5.64843 12.8486C5.87347 12.6235 5.9999 12.3183 5.9999 12C5.9999 11.6818 5.87347 11.3765 5.64843 11.1515C5.42339 10.9265 5.11816 10.8 4.7999 10.8H3.5999C3.28164 10.8 2.97642 10.9265 2.75137 11.1515C2.52633 11.3765 2.3999 11.6818 2.3999 12C2.3999 12.3183 2.52633 12.6235 2.75137 12.8486C2.97642 13.0736 3.28164 13.2 3.5999 13.2H4.7999Z"
      />
    </svg>
  );
}

function MoonIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
      focusable="false"
      data-theme-icon="moon"
      className="size-[18px]"
    >
      <path
        fill="currentColor"
        d="M20.7516 15.9516C18.9738 16.7557 16.9932 16.9991 15.0736 16.6491C13.154 16.2992 11.3867 15.3727 10.007 13.993C8.62728 12.6133 7.70076 10.8459 7.35084 8.92637C7.00093 7.00681 7.24424 5.0262 8.04837 3.24841C6.63304 3.88803 5.39401 4.86145 4.43757 6.08516C3.48114 7.30888 2.83584 8.74636 2.55706 10.2743C2.27828 11.8022 2.37432 13.3749 2.83696 14.8576C3.2996 16.3402 4.11501 17.6885 5.21325 18.7867C6.31149 19.885 7.65976 20.7004 9.1424 21.163C10.625 21.6257 12.1978 21.7217 13.7257 21.4429C15.2536 21.1641 16.6911 20.5188 17.9148 19.5624C19.1385 18.606 20.112 17.3669 20.7516 15.9516Z"
      />
    </svg>
  );
}

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
  /**
   * Which app this toggle belongs to, so the choice is stored under that app's own key.
   *
   * Required for the same reason `whenUnset` is: a default would be silently wrong for two of the
   * three surfaces, and the symptom — one app inheriting another's theme — reads as a bug in
   * whichever app you happened to be looking at.
   */
  readonly surface: ThemeSurface;
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
 * ## The icon names the DESTINATION, not the current state (Bashar, 2026-08-19)
 *
 * Light shows a MOON, dark shows a SUN — press it and you get what you see.
 *
 * It was the other way round, and that put the icon at odds with its own label: in dark mode the
 * button said «الوضع الفاتح» — go to light — beside a moon. One control cannot answer "where am
 * I" and "where will this take me" at once, and the label had already chosen, for the reason
 * recorded on `toLightLabel`: a state read aloud is ambiguous, an action is not.
 *
 * ## Why the first render is a fixed choice
 *
 * There is no theme to read during server rendering — the choice lives in `localStorage`, which
 * only exists in the browser. Rendering one icon unconditionally and correcting it in the effect
 * keeps the markup identical on both sides; branching on anything client-only here is a hydration
 * mismatch, and the console has been broken by one of those before.
 */
export function ThemeToggle({
  toLightLabel,
  toDarkLabel,
  whenUnset,
  surface,
}: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>('dark');

  useEffect(() => {
    setTheme(currentTheme(whenUnset));
  }, [whenUnset]);

  function toggle() {
    const next: Theme = theme === 'dark' ? 'light' : 'dark';

    setTheme(next);
    applyTheme(next, surface);
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
      {/* The destination: a moon offers dark, a sun offers light — matching the label above. */}
      {theme === 'dark' ? <SunIcon /> : <MoonIcon />}
    </button>
  );
}
