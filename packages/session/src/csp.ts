/**
 * Content-Security-Policy with a per-request nonce.
 *
 * ## Why a nonce, and not hashes
 *
 * Both apps previously declared `script-src 'self'` (plus, in the customer app, one
 * hash for the theme script). That blocked every inline script Next.js emits for
 * hydration — `self.__next_f.push(...)`, the React streaming bootstrap, and the
 * `$RC`/`$RB` Suspense helpers. Measured on 2026-08-03: **18 blocked scripts on the
 * customer home page, 4 on the staff sign-in page with none allowed.** The pages still
 * rendered, because the HTML is server-generated — so the breakage was invisible to a
 * `curl` check and to anything that only asserted a `200`. In a browser, hydration
 * never ran: no form submitted, no button worked, and the console filled with
 * violations.
 *
 * Those scripts cannot be hashed. Their contents are the page's own data, so the hash
 * changes with every render and every content edit. A nonce is the only mechanism that
 * works for the App Router, and Next applies it to its own scripts automatically when
 * it can read one from the request.
 *
 * ## `strict-dynamic`
 *
 * Included so a script the nonce'd bootstrap loads is trusted transitively. Without it
 * Next's chunk loading is blocked, which is the same failure one step further along.
 * It also makes `'self'` redundant in modern browsers — kept anyway for the older ones
 * that ignore `strict-dynamic` and fall back to the source list.
 *
 * ## Why this lives in the shared package
 *
 * The mechanism is identical for both apps and subtle enough that two copies would
 * drift — the request-header step below is easy to omit, and omitting it fails exactly
 * the way described above: silently, and only in a browser. The POLICY differs between
 * the apps and is passed in.
 */

export interface CspOptions {
  /** The nonce for this request, from `createNonce()`. */
  readonly nonce: string;
  /**
   * Where images may come from. The customer app serves partner photography through
   * object storage or a CDN whose host is deployment configuration; the staff console
   * needs no remote images at all.
   */
  readonly imgSrc: string;
  /** Set in production only: it upgrades http subresources and blocks mixed content. */
  readonly upgradeInsecure: boolean;
}

/**
 * A fresh nonce. 128 bits of `crypto.getRandomValues`, base64.
 *
 * `crypto` rather than `node:crypto` so this is usable from Edge middleware. A nonce
 * must be unguessable and must never repeat across requests: a predictable one lets an
 * injected script name it and be trusted.
 */
export function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);

  return btoa(String.fromCharCode(...bytes));
}

/** Builds the policy string. */
export function buildCsp(options: CspOptions): string {
  const { nonce, imgSrc, upgradeInsecure } = options;

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`,
    /**
     * `unsafe-inline` for STYLES only. Next injects critical CSS inline and offers no
     * hash-stable or nonce-able equivalent for it. The exposure is a styling attack
     * rather than script execution, which is the trade every Next deployment makes.
     */
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self'",
    "connect-src 'self'",
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'none'",
    "object-src 'none'",
    ...(upgradeInsecure ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

/**
 * Applies the policy so that Next can see the nonce AND the browser enforces it.
 *
 * Both halves are required and the first is the one that gets forgotten:
 *
 * 1. **On the forwarded REQUEST headers** — Next reads the nonce out of the
 *    `content-security-policy` request header and stamps it onto every script tag it
 *    generates. Without this step the header is served, the browser enforces it, and
 *    Next's own scripts carry no nonce, so everything is blocked.
 * 2. **On the RESPONSE headers** — what the browser actually enforces.
 */
export function cspHeaders(csp: string): {
  request: Record<string, string>;
  response: Record<string, string>;
} {
  return {
    request: { 'content-security-policy': csp },
    response: { 'content-security-policy': csp },
  };
}
