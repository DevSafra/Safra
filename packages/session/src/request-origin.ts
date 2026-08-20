/**
 * Where a request actually came from, and where to send it back to — without asking the SERVER
 * where it thinks it lives.
 *
 * ## The bug this exists to prevent, measured 2026-08-20
 *
 * All three apps build with `output: 'standalone'`, which is what the container images run. That
 * server binds to `0.0.0.0` by default, and Next builds `request.url` from the bound address rather
 * than from the `Host` header. So inside a container `new URL(request.url).origin` is
 * `http://0.0.0.0:3000` — not the origin any browser is talking to.
 *
 * Two production failures came out of that one fact, and both were invisible under `next start`
 * because it binds to `localhost` and the two happen to agree:
 *
 * 1. **The customer app's currency switcher answered 403 to every real browser.** Its CSRF guard
 *    compared the `Origin` header against `new URL(request.url).origin`. Browsers always send
 *    `Origin` on a POST, so the comparison was `http://localhost:3000` against `http://0.0.0.0:3000`
 *    — never equal. Measured: 403 with a correct same-origin header, 303 with the header removed.
 *    A security check that rejects everyone is not a strict security check, it is an outage.
 * 2. **Every POST-then-redirect sent the browser to `http://0.0.0.0:PORT/…`** — a different origin,
 *    so the session cookie does not travel and the page the operator lands on is not signed in. That
 *    is the rows-per-page bar, the CSV export request, the currency switcher and the partner
 *    sign-out.
 *
 * ## Why a RELATIVE Location rather than a corrected absolute one
 *
 * A relative `Location` takes the host out of the question entirely: the browser resolves it against
 * the URL it already asked for, which is by definition the right one. RFC 7231 §7.1.2 permits it and
 * every browser has followed it for decades. `NextResponse.redirect` insists on an absolute URL, so
 * these return a plain `Response`.
 *
 * It also removes a class of mistake rather than fixing an instance: there is no host to get wrong,
 * no `HOSTNAME` to remember to set in a deployment, and no absolute URL for an open redirect to
 * hide inside.
 */

/** 303 See Other with a RELATIVE `Location` — the answer to a POST that wrote something. */
export function seeOther(path: string, init?: { readonly headers?: Headers }): Response {
  const headers = init?.headers ?? new Headers();

  headers.set('Location', path);

  return new Response(null, { status: 303, headers });
}

/**
 * Whether a state-changing request came from this site.
 *
 * Compares the `Origin` header's host against the `Host` header. Both are set by the browser or
 * rewritten by the proxy in front of it, and neither depends on what address the server happens to
 * be bound to — which is the whole point.
 *
 * ## A missing `Origin` is accepted, deliberately
 *
 * Every browser that matters sends it on a cross-origin POST. Same-origin requests either send it or
 * send nothing, so absence is not evidence of a cross-site request — and refusing on absence would
 * break `curl`, health checks and older clients for no gain.
 *
 * ## `X-Forwarded-Host` is NOT consulted
 *
 * It is a client-supplied header on any route a proxy does not rewrite, and §8 of the register
 * already records the cost of trusting one of those. `Host` is what the request was addressed to; if
 * a proxy rewrites it, it rewrites the value both sides of this comparison see.
 */
export function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin');

  if (!origin) return true;

  const host = request.headers.get('host');

  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    /* An unparseable Origin is not a same-origin request. */
    return false;
  }
}
