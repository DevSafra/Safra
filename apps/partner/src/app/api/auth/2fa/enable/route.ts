import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

import { ERROR, totpEnableSchema } from '@safra/contracts';

import {
  PARTNER_SESSION_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  decodeSession,
  encodeSession,
  sessionCookieOptions,
  sessionFrom,
  type Session,
} from '@safra/session';

import { proxy } from '@/lib/proxy';

/**
 * Commits the pending secret once a live code proves the authenticator has it.
 *
 * Validated here as well as at the API against the same schema, so an obviously malformed code
 * does not spend one of the account's ten attempts a minute — which matters more for a partner
 * than for staff, because a partner who exhausts them has no colleague at the next desk.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const body: unknown = await request.json().catch(() => null);
  const parsed = totpEnableSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json({ code: ERROR.VALIDATION_CODE_SIX_DIGITS }, { status: 400 });
  }

  const answer = await proxy('/auth/2fa/enable', { method: 'POST', body: parsed.data });

  /*
    The REPLACEMENT session is written to the cookie here, and this route is the reason O-sec-14
    was invisible for so long.

    Enabling revokes every session — deliberately, since any session predating the second factor was
    established under weaker authentication. That includes THIS one. `totpEnabled` is a claim signed
    at sign-in, so without writing the new token the reader keeps one saying `false`, and the
    middleware sends them back to `/enrol-2fa` on every navigation. Pressing «حفظتها — متابعة» did
    nothing, for fifteen minutes, and then signed them out when the revoked refresh token failed.

    A caller that ignores `session` reproduces the bug exactly, which is why the contract says so.
  */
  if (answer.ok) {
    const body: unknown = await answer
      .clone()
      .json()
      .catch(() => null);
    /*
      The USER comes from the cookie already in the jar, not from the response — enabling a second
      factor changes the account's authentication and nothing about who they are. Asking
      `/auth/2fa/enable` to repeat the user blob would be a second source for a value that has not
      moved.
    */
    const jar = await cookies();
    const current = decodeSession(jar.get(PARTNER_SESSION_COOKIE)?.value);
    const session = current ? sessionOf(body, current.user) : null;

    if (session) {
      answer.cookies.set(
        PARTNER_SESSION_COOKIE,
        encodeSession(session),
        sessionCookieOptions(SESSION_MAX_AGE_SECONDS),
      );
    }
  }

  return answer;
}

/**
 * The new session out of the response body, or null if it is not shaped like one.
 *
 * Parsed defensively rather than cast: this writes an authentication cookie, and a malformed body
 * must leave the existing one alone rather than replace it with something unusable. The reader is
 * then still stuck — the bug, not a worse one — and the API log says why.
 */
function sessionOf(body: unknown, user: Session['user']): Session | null {
  if (typeof body !== 'object' || body === null) return null;

  const { session } = body as { session?: unknown };

  if (typeof session !== 'object' || session === null) return null;

  const { accessToken, expiresIn, refreshToken } = session as Record<string, unknown>;

  if (
    typeof accessToken !== 'string' ||
    typeof refreshToken !== 'string' ||
    typeof expiresIn !== 'number'
  ) {
    return null;
  }

  return sessionFrom({ accessToken, expiresIn, user }, refreshToken);
}
