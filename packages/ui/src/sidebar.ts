/**
 * The staff console's sidebar preference.
 *
 * Bashar, 2026-08-05: the sidebar collapses and expands at ANY size, the hamburger is always
 * available, and the choice survives navigation and reload.
 *
 * ## Three states, not two
 *
 * `'shown'` and `'hidden'` are explicit choices. The third is **no choice yet**, and it is not the
 * same as either: with no attribute the CSS shows the sidebar from `lg` up and hides it below,
 * which is the right default in both places. Defaulting to `'shown'` instead would open every
 * phone on a drawer covering the content; defaulting to `'hidden'` would take the sidebar away
 * from every desktop that has room for it.
 *
 * Once somebody presses the button their choice applies at every width, because that is what
 * "the user can always choose" means.
 *
 * ## Why an attribute on `<html>` and not React state
 *
 * The layout depends on it, so it has to be right in the first painted frame. React state is
 * resolved after hydration, which would show the wrong layout and then jump — worse for a 220px
 * column than for a colour. The attribute is applied by a blocking pre-paint script, exactly as
 * the theme is, and the CSS in `globals.css` keys off it.
 *
 * Toggling is then a DOM write, not a navigation: instant, and no server round trip.
 */

export type SidebarState = 'shown' | 'hidden';

/** Where the choice is persisted. */
export const SIDEBAR_STORAGE_KEY = 'safra-sidebar';

/** The attribute the CSS keys off, on `<html>`. */
export const SIDEBAR_ATTRIBUTE = 'sidebar';

/**
 * The pre-paint sidebar script.
 *
 * Concatenated with `THEME_SCRIPT` into the console's single inline script, so there is one
 * nonce'd `<script>` rather than two. Kept as its own constant because the customer app renders
 * the theme half and has no sidebar.
 *
 * Dependency-free and wrapped in `try` for the same reasons as the theme script: it runs before
 * anything else on the page, and reading `localStorage` throws in private browsing.
 */
export const SIDEBAR_SCRIPT = `try{var b=localStorage.getItem('${SIDEBAR_STORAGE_KEY}');if(b==='shown'||b==='hidden'){document.documentElement.dataset.${SIDEBAR_ATTRIBUTE}=b}}catch(e){}`;

/** The width from which the sidebar is a column rather than a drawer. Tailwind's `lg`. */
const COLUMN_BREAKPOINT = '(min-width: 64rem)';

/**
 * Whether the sidebar is currently on screen.
 *
 * Reads the DOM, then falls back to the SAME rule the CSS uses for the no-choice case — a media
 * query, not an assumption. Getting this wrong flips the button's label and `aria-expanded` out of
 * step with the page, which for a screen-reader user is worse than no button at all.
 *
 * Browser-only; callers are client components in an effect or an event handler.
 */
export function sidebarVisible(): boolean {
  const explicit = document.documentElement.dataset[SIDEBAR_ATTRIBUTE];

  if (explicit === 'shown') return true;
  if (explicit === 'hidden') return false;

  return window.matchMedia(COLUMN_BREAKPOINT).matches;
}

/**
 * Applies a sidebar state and persists it.
 *
 * Storage is best-effort: a failure means the choice does not survive a reload, which is worth
 * strictly less than the page continuing to work.
 */
export function applySidebar(state: SidebarState): void {
  document.documentElement.dataset[SIDEBAR_ATTRIBUTE] = state;

  try {
    localStorage.setItem(SIDEBAR_STORAGE_KEY, state);
  } catch {
    // Private browsing. The choice holds for this page view and is not remembered.
  }
}
