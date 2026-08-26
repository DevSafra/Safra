import { DEFAULT_LOCALE } from '@safra/i18n';

import { isLocale } from '@/i18n/routing';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

/**
 * A click on a partner ad (§9.3) — counted, then sent on.
 *
 * ## Why this exists at all
 *
 * The API answers `DeliveredAd.clickPath` as `/api/v1/ads/…/click`, which is ITS path, on ITS
 * origin. The customer app's browser never talks to the API directly — every call goes through a
 * handler like this one, and there is no rewrite — so rendering that path into an `<a href>` would
 * have produced a link to a route this app does not serve. Found by asking what a person clicking
 * the link would actually reach, which is not a question `pnpm verify` can ask.
 *
 * ## The destination still never reaches the browser
 *
 * `redirect: 'manual'` so the API's 302 is READ here rather than followed, and the advertiser's URL
 * is put in a `Location` the browser follows once. The page source carries this path and nothing
 * else, which is what makes a click countable and keeps the target out of anybody's copy-paste.
 *
 * `Referrer-Policy: no-referrer` is set in `next.config.ts` for this path, not here: a `headers()`
 * rule wins over one a route handler sets, so the handler's own header came back as the app-wide
 * `strict-origin-when-cross-origin` when this was driven in a browser. Which city a customer was
 * browsing is ours, not the advertiser's.
 *
 * ## A dead campaign goes home, not to an error
 *
 * The API answers 404 for a campaign that is paused, lapsed or was never live — a bookmarked click
 * URL, or a page left open for a week. That is not a failure the customer caused or can act on, and
 * a JSON body here would be a bare document with no shell and no way back (the defect
 * `no-json-screens.test.ts` exists to prevent). Home is a place they can carry on from.
 */
/*
  ## The `Location` back home is RELATIVE, and that is not a style choice

  The standalone server binds to `0.0.0.0`, and Next derives `request.url` from the bound address
  rather than from the `Host` header — so `new URL('/ar', request.url)` produced
  `http://0.0.0.0:3000/ar`, a different origin, which the browser cannot reach and to which the
  session cookie would not travel. That is the failure `@safra/session`'s `seeOther` exists to
  prevent, and driving this route with `curl` is what showed it. `NextResponse.redirect` insists on
  an absolute URL, so the refusal path returns a plain `Response`.

  The advertiser's URL is necessarily absolute — it is another site — and it is validated below.
*/
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ locale: string; reference: string }> },
): Promise<Response> {
  const { locale, reference } = await params;

  /*
    The locale is VALIDATED before it becomes part of a `Location`.

    It is a path segment, so it arrives URL-decoded: `/%2Fevil.example/api/ads/X/click` matches this
    route with `locale` = `/evil.example`, and `Location: //evil.example` is a protocol-relative URL
    — an open redirect off SAFRA's own domain, which is exactly the phishing primitive this whole
    route exists to avoid handing anybody. An unknown locale falls back to the default rather than
    refusing, because a person who typed a URL wrong should still land somewhere real.
  */
  const home = isLocale(locale) ? locale : DEFAULT_LOCALE;

  const target = await (async (): Promise<string | null> => {
    try {
      const response = await fetch(
        `${API_URL}/api/v1/ads/${encodeURIComponent(reference)}/click`,
        { redirect: 'manual', cache: 'no-store' },
      );

      return response.status === 302 ? response.headers.get('location') : null;
    } catch {
      /* Unreachable API, a timeout, a DNS failure — all the same answer to the customer. */
      return null;
    }
  })();

  /*
    Only http and https leave here.

    The column is already constrained at the boundary — `adTargetUrlSchema` refuses anything else,
    so nothing dangerous can be stored. This is the second guard, on the value as it is about to
    become a `Location`: a redirect built from a row is only as safe as the last thing that wrote
    the row, and this handler is where the browser acts on it.
  */
  if (target === null || !/^https?:\/\//i.test(target)) {
    return new Response(null, { status: 302, headers: { Location: `/${home}` } });
  }

  return new Response(null, { status: 302, headers: { Location: target } });
}
