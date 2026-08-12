/**
 * Navigating away from a page after the SESSION changed.
 *
 * ## The bug this fixes
 *
 * Reported by Bashar (2026-08-12): after signing in, the header still offered «تسجيل الدخول», and only a
 * manual reload turned it into «حسابي». The mirror image was worse — after signing OUT the header kept
 * saying «حسابي» until a reload.
 *
 * `SiteHeader` is a server component that reads the session cookie, so the header is baked into the HTML
 * of every route. The forms were doing `router.refresh()` and then `router.push(destination)`, which
 * looks right and is not: `refresh()` refetches the route you are ON — the login page — while `push()`
 * renders the DESTINATION from the client router cache, an entry that may have been prefetched while the
 * old cookie was in force. So the new page arrived wearing the old header.
 *
 * Swapping the order would refresh the destination after landing on it, but only after a visible flash
 * of a header that contradicts what just happened. On authentication state, that is not a good enough
 * answer: "am I signed in" is the one question the chrome must never get wrong, even briefly.
 *
 * ## Why a full document load is the right answer here and nowhere else
 *
 * A real navigation re-runs middleware, re-reads the cookie and re-renders the whole tree, so the header
 * cannot disagree with the session. The cost is one full page load, which at sign-in and sign-out is
 * both expected and unnoticeable — it is the moment a person is already waiting.
 *
 * Everywhere else `router.refresh()` remains correct: saving a favourite or a review changes DATA within
 * one session, and the SPA transition is worth keeping. This is only for the four places where the
 * session itself begins, ends, or is revoked.
 */
export function reloadInto(url: string): void {
  /*
    `assign`, not `replace`: the page being left is a login or a form, and leaving it in history is
    harmless. `replace` would also work, but it removes the reader's ability to press back, which is a
    decision this helper has no business making for every caller.
  */
  window.location.assign(url);
}
