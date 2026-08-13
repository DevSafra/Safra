/**
 * The light/dark theme mechanism, shared by both apps.
 *
 * ## Why this is in `@safra/ui`
 *
 * The customer app had all of this to itself. The staff console now needs the same thing, and
 * the two must agree on three details or the feature is subtly broken:
 *
 * 1. **The storage key.** Both apps are on the same origin in production, so one key means a
 *    person who picks light on the public site finds the console already light. Two keys would
 *    make that a coin toss.
 * 2. **The attribute.** `data-theme` on `<html>`, read by the CSS in both apps.
 * 3. **The exact script bytes.** See `THEME_SCRIPT` below — this is the one that bites.
 *
 * Copying the script into the console instead would have worked on the day and drifted after
 * it, which is the same argument that put `PasswordField` here.
 */

export type Theme = 'dark' | 'light';

/** Where the choice is persisted. One key for both apps — see the note above. */
export const THEME_STORAGE_KEY = 'safra-theme';

/**
 * The same choice, as a COOKIE, so a server can render `data-theme` itself.
 *
 * ## Why `localStorage` alone was not enough
 *
 * The pre-paint script sets the attribute outside React's knowledge, and that is fine until React
 * re-renders `<html>` — which the customer app does when the visitor changes LOCALE, because
 * `/ar` and `/en` are different layout instances. React writes the props it was given and the
 * attribute is dropped, so a visitor who had chosen light watched the site change colour because
 * they changed the language (reported by Bashar, 2026-08-13).
 *
 * A cookie is readable on the server, so the attribute can be part of the rendered markup and
 * React owns it. `localStorage` is still written: it is what the pre-paint script reads, and that
 * script is what prevents a flash on a cold load.
 *
 * Not `HttpOnly` — it is a display preference, and `applyTheme` writes it from the browser.
 */
export const THEME_COOKIE = 'safra-theme';

/**
 * The pre-paint theme script.
 *
 * A single exported constant so that anything needing to hash THESE EXACT BYTES for a
 * Content-Security-Policy derives it from here. A hash written by hand silently stops matching
 * the moment somebody edits the script: the browser refuses to run it, the theme flashes on
 * every load, and nothing says why.
 *
 * It has to be a blocking inline script. Applying the theme in an effect renders the dark
 * default first and then repaints — a visible flash on every load for anyone who chose light.
 *
 * Deliberately tiny and dependency-free: it runs before anything else on the page, so a syntax
 * error here is a blank screen rather than a degraded one. The `try` covers private browsing,
 * where reading `localStorage` throws.
 */
export const THEME_SCRIPT = `try{var s=localStorage.getItem('${THEME_STORAGE_KEY}');if(s==='light'||s==='dark'){document.documentElement.dataset.theme=s}}catch(e){}`;

/**
 * The theme currently on screen.
 *
 * Reads the DOM rather than storage, because `THEME_SCRIPT` has already reconciled the two by
 * the time any component mounts. Returning the stored value would report `dark` while the screen
 * was light in exactly the case below.
 *
 * ## `whenUnset` — and why the two apps answer it differently
 *
 * With no explicit choice the DOM carries no attribute, and what is rendering depends on what
 * that app's CSS does with `prefers-color-scheme`. The two apps genuinely differ:
 *
 * - **The customer site passes `'system'`.** A public page following the visitor's OS preference
 *   is what a visitor expects, and its CSS has the matching media query.
 * - **The staff console passes `'dark'`.** The console is designed dark (handoff §9.1) and was
 *   dark-only until the toggle existed. Following the OS would silently turn the console light
 *   for every staff member on a light-mode laptop — a change none of them asked for, on the tool
 *   they use all day. Its CSS has no media query, so `'dark'` is also the truth about what is on
 *   screen; answering `'light'` here would put the icon out of step with the page.
 *
 * Browser-only. Callers are client components running in an effect.
 */
export function currentTheme(whenUnset: Theme | 'system' = 'system'): Theme {
  const explicit = document.documentElement.dataset['theme'];

  if (explicit === 'light' || explicit === 'dark') return explicit;
  if (whenUnset !== 'system') return whenUnset;

  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

/**
 * Applies a theme and persists it.
 *
 * Writing the attribute is what changes the screen; the CSS in each app keys off it. Storage is
 * best-effort — a failure means the preference does not survive a reload, which is worth
 * strictly less than the page continuing to work.
 */
export function applyTheme(theme: Theme): void {
  document.documentElement.dataset['theme'] = theme;

  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Private browsing. The choice holds for this page view and is not remembered.
  }

  try {
    /*
      And a cookie, so the SERVER can render the attribute — see `THEME_COOKIE`.

      A year, `SameSite=Lax` so arriving from a link keeps the choice, and `Secure` only where
      there is TLS to be secure about: setting it unconditionally would make the cookie silently
      fail to write on `http://localhost`, which is where this is developed.
    */
    const secure = location.protocol === 'https:' ? '; Secure' : '';

    document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=31536000; SameSite=Lax${secure}`;
  } catch {
    // Nothing to do: the attribute and localStorage above already carry the choice.
  }
}
