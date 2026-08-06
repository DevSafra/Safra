import { z } from 'zod';

import { authUserSchema, type AuthUser } from '@safra/contracts';

/**
 * The session a SAFRA web app holds, in ONE cookie on its own origin.
 *
 * Shared between `apps/web` and `apps/admin` because both face the same problem:
 * the browser never talks to the API directly — every call goes through a Next route
 * handler so the API host stays server-side — and a cookie the browser cannot see is
 * a cookie it cannot send. Each app therefore captures the API's `Set-Cookie` and
 * re-issues the session on its own origin.
 *
 * ## Why this is a package and not a copy
 *
 * The parts that are easy to get subtly wrong — the expiry arithmetic, the refresh
 * margin, the cookie attributes, the redirect guard — are exactly the parts that
 * would drift if each app kept its own. The thin bit that reads the ambient request
 * stays per-app, because it needs `next/headers` and this module must stay importable
 * from the Edge runtime that middleware uses.
 *
 * ## What is in the cookie
 *
 * The access token, the refresh token, and enough identity to render a header.
 * `HttpOnly` keeps all of it out of client JavaScript. The `user` field is DISPLAY
 * STATE ONLY: it is not signed, so someone editing their own cookie can change the
 * name in their own header and nothing follows from it — every authorization decision
 * belongs to the API, which reads the token rather than this blob.
 */
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
 * during the render that follows, and that page has no way to recover. Thirty
 * seconds comfortably covers a slow server render.
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
 * older shape, or a truncated one, must sign the person out cleanly instead of
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
 * silently dropped over plain HTTP and local development would appear to sign in and
 * then immediately forget.
 *
 * `SameSite=Strict`, matching the API. The known cost is that following a link from
 * an email lands anonymous on the first navigation; that is the accepted trade for a
 * session cookie that cannot ride a cross-site request at all.
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
 * Cookie names, one per app.
 *
 * They MUST differ, and not merely for tidiness: cookies are scoped by domain and
 * **ignore the port**, so a customer session on `localhost:3000` and a staff session
 * on `localhost:3001` would otherwise be the same cookie. In development that means
 * signing into the admin app silently replaces the customer session with a staff one
 * — or worse, the public app starts rendering with staff claims.
 */
export const CUSTOMER_SESSION_COOKIE = 'safra_session';
export const STAFF_SESSION_COOKIE = 'safra_admin_session';
/**
 * لوحة الشريك, a fourth app on a fourth port for the same reason the console is a third.
 *
 * A partner is not staff and not a customer: they see their own listings, their own guests' names
 * and their own money, and none of the other two surfaces. Sharing a cookie with either would mean
 * a bug on one becoming a way into the other, which ADR 0001 already rejected once.
 */
export const PARTNER_SESSION_COOKIE = 'safra_partner_session';

/**
 * Pulls one claim out of a JWT payload WITHOUT verifying the signature.
 *
 * Verification is deliberately absent: a web app holds no signing key and has no
 * business making authorization decisions. The API verifies on every request. A
 * forged token here buys nothing but a misleading UI in the forger's own browser.
 *
 * Decoded with `atob` rather than `Buffer` so this stays safe to reference from the
 * Edge runtime as well as from Node.
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

/** As `readClaim`, for a boolean. Anything that is not literally `true` is false. */
export function readBooleanClaim(jwt: string, claim: string): boolean {
  const payload = jwt.split('.')[1];
  if (!payload) return false;

  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

    const decoded: unknown = JSON.parse(atob(padded));

    if (typeof decoded !== 'object' || decoded === null) return false;

    return (decoded as Record<string, unknown>)[claim] === true;
  } catch {
    return false;
  }
}

/**
 * Whether the signed-in account has completed 2FA enrolment.
 *
 * Read from the token, which the API signs, rather than from the `user` blob, which
 * is unsigned display state. The admin app routes an unenrolled staff member to
 * enrolment and nowhere else — but note this is a UX gate, not the control: the API
 * is what must refuse a staff action from an unenrolled account.
 *
 * Defaults to FALSE when the claim is absent, so a token minted before this claim
 * existed sends its holder to enrolment rather than waving them through.
 */
export function hasTwoFactor(session: Session): boolean {
  return readBooleanClaim(session.accessToken, 'totpEnabled');
}
