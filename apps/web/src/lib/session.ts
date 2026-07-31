import { z } from 'zod';

import { authUserSchema, type AuthUser } from '@safra/contracts';

/**
 * The customer's session, held in ONE cookie on the web origin.
 *
 * ## Why the web app keeps its own cookie rather than reusing the API's
 *
 * The API sets `safra_refresh` scoped to `/api/v1/auth` on the API origin, and the
 * browser never talks to that origin — every call goes through a Next route handler
 * so the API host stays server-side (the same reason the booking and payment proxies
 * exist). A cookie the browser cannot see is a cookie it cannot send, so the
 * handlers capture the API's `Set-Cookie` and re-issue the session here instead.
 *
 * ## What is in it, and what that means
 *
 * The access token, the refresh token, and enough identity to render a header.
 * `HttpOnly` keeps all of it out of client JavaScript, which is the point: an XSS
 * payload on this origin cannot read the tokens.
 *
 * The `user` field is DISPLAY STATE ONLY. It is not signed, so someone editing their
 * own cookie can make the header show a different email — and nothing follows from
 * that, because every authorization decision belongs to the API, which reads the
 * token rather than this blob. Do not gate anything that matters on it.
 *
 * ## SameSite
 *
 * `Strict`, matching the API and rule 1. The known cost is that following a link
 * from an email lands anonymous on the first navigation, because Strict withholds
 * the cookie on cross-site entry; the second navigation is signed in. That is the
 * accepted trade for a session cookie that cannot ride a cross-site request at all.
 *
 * ## Why this module is free of `next/headers`
 *
 * Middleware runs on the Edge runtime and imports these helpers to rotate the
 * session. Pulling `next/headers` in here would break it, so the parts that read
 * the ambient request live in `session-server.ts` instead.
 */
export const SESSION_COOKIE = 'safra_session';

const sessionSchema = z.object({
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  user: authUserSchema,
  /** Epoch milliseconds at which the ACCESS token stops being accepted. */
  expiresAt: z.number().int().positive(),
});

export type Session = z.infer<typeof sessionSchema>;

/**
 * Refresh this far before the access token actually expires.
 *
 * Without a margin, a token that is valid when middleware checks it can expire
 * during the render that follows, and the page fails with a 401 it cannot recover
 * from. Thirty seconds comfortably covers a slow server render.
 */
export const REFRESH_MARGIN_MS = 30_000;

/**
 * How long the cookie itself survives.
 *
 * Tied to the REFRESH token's life, not the access token's: the cookie has to
 * outlive the 15-minute access token or the session would end every quarter hour.
 */
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export function encodeSession(session: Session): string {
  return JSON.stringify(session);
}

/**
 * Parses a cookie value into a session, or null.
 *
 * Null for anything unparseable rather than throwing: a cookie left over from an
 * older shape, or a truncated one, must log the customer out cleanly instead of
 * turning every page into a 500.
 */
export function decodeSession(raw: string | undefined): Session | null {
  if (!raw) return null;

  try {
    const parsed = sessionSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** True when the access token is expired, or close enough that it will be. */
export function needsRefresh(session: Session, now = Date.now()): boolean {
  return session.expiresAt - REFRESH_MARGIN_MS <= now;
}

/** Builds a session from what the API returns on login, register or refresh. */
export function sessionFrom(
  body: { accessToken: string; expiresIn: number; user: AuthUser },
  refreshToken: string,
  now = Date.now(),
): Session {
  return {
    accessToken: body.accessToken,
    refreshToken,
    user: body.user,
    // `expiresIn` is seconds, per OAuth convention.
    expiresAt: now + body.expiresIn * 1000,
  };
}

/**
 * Cookie attributes, in one place.
 *
 * `secure` follows NODE_ENV rather than being hardcoded, because a Secure cookie is
 * silently dropped over plain HTTP and local development would appear to log in and
 * then immediately forget.
 */
export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge: maxAgeSeconds,
  };
}

/**
 * Pulls one claim out of a JWT payload WITHOUT verifying the signature.
 *
 * Verification is deliberately absent: this app holds no signing key and has no
 * business making authorization decisions. The API verifies on every request. A
 * forged token here buys nothing but a misleading UI for the forger's own browser.
 *
 * Decoded with `atob` rather than `Buffer` so the function is safe to reference from
 * the Edge runtime as well as from Node.
 */
export function readClaim(jwt: string, claim: string): string | null {
  const payload = jwt.split('.')[1];
  if (!payload) return null;

  try {
    // base64url → base64, then pad. atob rejects the URL-safe alphabet.
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

    const decoded: unknown = JSON.parse(atob(padded));

    if (typeof decoded !== 'object' || decoded === null) return null;

    const value = (decoded as Record<string, unknown>)[claim];
    return typeof value === 'string' ? value : null;
  } catch {
    return null;
  }
}
