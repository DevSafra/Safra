/**
 * A request body as JSON, or a marker saying it was not (audit 2026-10-04).
 *
 * About thirty console routes passed `await request.json()` straight to `proxy`, so a POST with no
 * body or a broken one threw inside the route and answered 500, the shape the rest of the console
 * keeps for "the server broke". `proxy` answers this marker with a coded 400 instead, so every
 * route that reads its body this way refuses malformed input the same way, by construction.
 */
export const MALFORMED_BODY: unique symbol = Symbol('malformed body');

export function jsonBody(request: Request): Promise<unknown> {
  return request.json().catch(() => MALFORMED_BODY);
}
