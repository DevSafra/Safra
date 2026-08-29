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
 * one session, and the SPA transition is worth keeping. This is only for the places where the session
 * itself begins, ends, or is revoked.
 *
 * ## It lives here because two apps learnt this the hard way and one of them twice
 *
 * The customer app fixed it on 2026-08-12 and kept the fix to itself. The console and the partner
 * portal went on doing `router.refresh()` then `router.push()` at every sign-in, sign-out and 2FA
 * enrolment, and the console's version produced a worse failure than a stale header — see
 * `replaceInto`. A helper in one app is a lesson that does not travel; this one now does.
 */
export function reloadInto(url: string): void {
  /*
    `assign`, not `replace`: the page being left is a form the reader may legitimately want back —
    a registration, a password reset — and leaving it in history is harmless.
  */
  window.location.assign(url);
}

/**
 * The same full document load, WITHOUT leaving the page behind in history.
 *
 * ## The bug this fixes
 *
 * Reported by Bashar (2026-08-29): open `/messages/CNV-024637` signed out, sign in, press «رجوع» —
 * and land back on the sign-in page.
 *
 * A deep link redirects to `/login?next=/messages/CNV-024637`. The form then ran `router.refresh()`
 * and `router.push(next)` — two navigations at once, and they disagree. `refresh()` refetches the
 * route the browser is ON, which is `/login`; the middleware now sees a valid session there and
 * answers «you have no business here» with a redirect to `/`. Meanwhile `push()` is transitioning to
 * the thread. Whichever settles last decides, so the address bar can be left reading `/login?next=…`
 * over a page showing the thread — and any navigation from that state can put the reader back on the
 * sign-in form. It is timing-dependent, which is why it looked intermittent.
 *
 * ## Why `replace` and not `assign` here
 *
 * A sign-in page is not somewhere a signed-in person can return to: the middleware bounces it to the
 * dashboard. Leaving it in history makes the browser's own back button a trapdoor — press it and you
 * are somewhere you did not ask to be. `replace` removes the entry, so back goes wherever the reader
 * actually came from.
 */
export function replaceInto(url: string): void {
  window.location.replace(url);
}
