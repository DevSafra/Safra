import { NextResponse } from 'next/server';

import { ERROR } from '@safra/contracts';
import { isSameOrigin } from '@safra/session';

/**
 * The refusal every state-changing route handler on the customer site starts with.
 *
 * The session is an HttpOnly cookie, and a browser attaches it to a form another site posts here as
 * readily as to our own — `SameSite` narrows that, but it is a property of the cookie, and the sign-in
 * route acts before any cookie exists: login CSRF signs the visitor into the ATTACKER's account so
 * that what they book or save next lands where the attacker can read it.
 *
 * `isSameOrigin` compares `Origin` with `Host`, never with the address the server is bound to, and
 * accepts a request with no `Origin` (non-browser clients) — see its note. Returned as a value rather
 * than thrown so each handler reads `const refused = refuseCrossOrigin(request); if (refused) return
 * refused;` as its first line, which the sweep in `cross-origin.test.ts` checks for.
 */
export function refuseCrossOrigin(request: Request): NextResponse | null {
  if (isSameOrigin(request)) return null;

  return NextResponse.json({ code: ERROR.REQUEST_CROSS_ORIGIN }, { status: 403 });
}
