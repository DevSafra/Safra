/**
 * Telling the API which visitor a server-side call is made for.
 *
 * ## Why every server-side call needs this (Bashar, 2026-10-06)
 *
 * All three apps call the API from their own servers, so without it the API sees the WEB SERVER's
 * address on every call and every visitor of one instance shares one rate-limit bucket: thirty
 * session refreshes a minute for the whole site, sixty quotes, a hundred and twenty per route. One
 * script, or an ordinary busy minute, and account pages kept an expired session, checkout read
 * «غير متاح» and property pages 404'd for everybody.
 *
 * So every call to the API from a server — a page's data, a route handler, the middleware's
 * refresh — sends the visitor's address with a secret only SAFRA's own servers hold. The API honours
 * the address only when the secret matches (`apps/api/src/common/http/internal-caller.ts`), so a
 * client on the internet sending the same header is just a client. The header names are mirrored
 * there; its test drives the API's middleware with `internalCallerHeaders` so they cannot drift.
 *
 * Runtime-agnostic, like the rest of this package: middleware imports it on the Edge runtime.
 */
export const INTERNAL_CALLER_HEADER = 'x-safra-internal-caller';
export const VISITOR_ADDRESS_HEADER = 'x-safra-visitor-ip';

/**
 * How many proxies APPEND to `X-Forwarded-For` between the visitor and this server.
 *
 * ## The deployment contract — the one value to revisit when hosting is chosen
 *
 * The edge in front of each site (load balancer, CDN, ingress) MUST append the address it received
 * the connection from to `X-Forwarded-For`, or replace the header with it. Every proxy appends to
 * the RIGHT, so the visitor is this many entries from the right-hand end, and everything to the left
 * of that is whatever the client chose to send — never read it.
 *
 * - One edge (a load balancer, or nginx with `$proxy_add_x_forwarded_for`): `1`.
 * - A CDN in front of a load balancer, both appending: `2`.
 *
 * Get this wrong in the SMALL direction and every visitor becomes the edge's own address — one
 * shared bucket again. Get it wrong in the LARGE direction and the visitor can choose their address
 * by sending the header themselves. With NO proxy at all, Next fills a missing header from the socket
 * but keeps one the client sent, so a site exposed directly to the internet must not be deployed.
 */
const EDGE_HOPS = 1;

/**
 * IPv4 or IPv6 characters and nothing else. A shape check, not a parse: the API runs `isIP` on it
 * before use. This only keeps text that could never be an address off the wire.
 */
const ADDRESS_SHAPE = /^[0-9A-Fa-f:.]{2,45}$/;

/**
 * Only `get`, so a route handler's `request.headers` and a page's `await headers()` — which is
 * read-only — both fit.
 */
type IncomingHeaders = Pick<Headers, 'get'>;

/** The visitor's address, as the edge proxy recorded it — or null when there is none to trust. */
export function visitorAddress(incoming: IncomingHeaders): string | null {
  const chain = incoming.get('x-forwarded-for');

  if (!chain) return null;

  const hops = chain
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0);
  const address = hops[hops.length - EDGE_HOPS];

  return address !== undefined && ADDRESS_SHAPE.test(address) ? address : null;
}

/**
 * The two headers that put a server-side call on the VISITOR's rate limit, or none.
 *
 * Empty when `INTERNAL_CALLER_SECRET` is unset — local development without it behaves as it always
 * has, every visitor counting as the web server — and empty when there is no visitor address, which
 * leaves the API on its own answer rather than on a guess.
 *
 * Read per call rather than at module load so a test can set it, and because the value comes from
 * the deployment rather than from the build.
 *
 * ## Never on a CACHED fetch
 *
 * Next keys its data cache on the request headers, so a visitor's address in a `revalidate: N` fetch
 * would give each visitor a private copy of the catalogue. Those calls are made once per cache
 * window, not per visitor, and stay on the server's own budget.
 */
export function internalCallerHeaders(incoming: IncomingHeaders): Record<string, string> {
  const secret = process.env['INTERNAL_CALLER_SECRET'];

  if (!secret) return {};

  const address = visitorAddress(incoming);

  if (address === null) return {};

  return { [INTERNAL_CALLER_HEADER]: secret, [VISITOR_ADDRESS_HEADER]: address };
}
