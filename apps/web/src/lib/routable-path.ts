/**
 * A path made of characters we could never have generated, answered as a 404 before routing.
 *
 * ## The failure this replaces
 *
 * `/ar/city/a%27b` answered **500**, and so did `%5E` and `%7C` — an apostrophe, a caret and a
 * pipe, on every dynamic public route. The middleware's own locale REWRITE was the trigger: with
 * those three characters Next stopped recognising the rewrite target as its own origin, took it
 * for an external one and proxied the request to `localhost` while the server listens on
 * `127.0.0.1` — `Failed to proxy … ECONNREFUSED`, and a 500 handed to the reader. Every other
 * character of the 36 swept answered 404 correctly, which is why it survived: it is not a class
 * anybody would think to check, and only three members of it exist.
 *
 * ## Why this is the routing statement, not a workaround
 *
 * **Every identifier SAFRA puts in a path is RFC 3986 "unreserved"** — `[A-Za-z0-9._~-]`. Slugs
 * are lowercase and hyphenated, references are `BKG-2026-000123`, locales are two letters, and
 * every static segment is a word. Checked against the database: of 2,705 property slugs, every
 * city and landmark slug and every booking reference, **none** contains anything else.
 *
 * So a segment that decodes to anything outside that set cannot name a row, a page or a locale.
 * 404 is not a defensive guess here — it is the only answer that was ever available, and saying
 * it BEFORE the rewrite means no future character with the same problem can reach it.
 *
 * It is deliberately stated as an allow-list. A deny-list of «the three that break» would go
 * stale the moment Next changed its mind about a fourth, and the reader would meet a 500 again.
 *
 * **The constraint this writes down:** a route whose segment needs a character outside the
 * unreserved set — an Arabic slug, a space — must widen this set, and will 404 until it does.
 * That is the trade, and it is the right way round: a new route is a deliberate change and a
 * malformed URL is not.
 */
const UNRESERVED_SEGMENT = /^[A-Za-z0-9._~-]*$/;

export function addressesNoRoute(pathname: string): boolean {
  return pathname.split('/').some((segment) => {
    let decoded: string;

    try {
      decoded = decodeURIComponent(segment);
    } catch {
      /* A percent-sequence that is not one — `%zz`, a truncated `%2`. Nothing can match it. */
      return true;
    }

    return !UNRESERVED_SEGMENT.test(decoded);
  });
}
