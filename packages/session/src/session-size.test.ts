import { describe, expect, it } from 'vitest';

import { PERMISSIONS, ROLE_PERMISSIONS, type AuthUser } from '@safra/contracts';

import {
  COOKIE_BYTE_LIMIT,
  STAFF_SESSION_COOKIE,
  encodeSession,
  sessionFrom,
} from './session.js';

/**
 * The session cookie must stay inside the 4096 bytes a browser will actually keep.
 *
 * ## Why this test exists
 *
 * On 2026-09-04 three permissions were added for the payout-account lifecycle, and the super
 * admin's session cookie went from about 3,970 bytes to **4107**. Browsers drop a cookie larger
 * than 4096 SILENTLY — no error, no console warning, no failed request — so sign-in to the staff
 * console stopped working for the widest role, and every symptom pointed somewhere else: the API
 * answered 200, `Set-Cookie` came back correctly, and the very next request simply had no session
 * and redirected to `/login`. It cost most of an hour and was found by measuring the cookie, which
 * is the one thing nothing in the suite did.
 *
 * The immediate cause was three strings. The real cause was that the permission list was in the
 * cookie twice — inside the signed JWT and again as `user.permissions`, which nothing read — so
 * the cookie had been sitting about 130 bytes from a hard limit for as long as it had existed. Any
 * permission added by anyone, for any feature, would have done it.
 *
 * ## What it asserts, and why the margin
 *
 * The check is against **three quarters** of the limit rather than the limit itself. A test that
 * only fails at 4096 fails on the change that breaks production, which is too late to be useful:
 * the person who adds the sixty-seventh permission finds out by breaking sign-in. Failing at 3072
 * fails while there is a thousand bytes of room and an obvious remedy.
 *
 * It builds the widest session the platform can issue — a super admin, every permission — because
 * that is the account this breaks first and the one nobody tests with.
 */
describe('the session cookie fits in a browser', () => {
  /** A JWT shaped like the API's, so the measurement is of a real cookie rather than a stub. */
  function tokenFor(permissions: readonly string[]): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
      role: 'super_admin',
      permissions,
      locale: 'en',
      totpEnabled: true,
      scope: { kind: 'all_cities', cityIds: [], outside: 'none' },
      sub: '019fbad6-fc44-7d9b-b42b-504d9eed7cc8',
      iat: 1_788_520_015,
      iss: 'safra-api',
      aud: 'safra',
      exp: 1_788_520_915,
    };
    const b64 = (value: unknown) =>
      Buffer.from(JSON.stringify(value)).toString('base64url');

    /* 43 characters is an HS256 signature in base64url — the real one's length. */
    return `${b64(header)}.${b64(payload)}.${'x'.repeat(43)}`;
  }

  /*
    A FULL `AuthUser`, permissions and all — deliberately.

    `sessionFrom` takes the narrower `SessionUser`, and handing it the wide shape is the whole point:
    it proves the permission list is dropped on the way into the cookie rather than merely absent
    from a caller that never had it. A narrow literal here would be a test of the type, not of the
    behaviour.
  */
  function authUser(permissions: readonly string[]): AuthUser {
    return {
      id: '019fbad6-fc44-7d9b-b42b-504d9eed7cc8',
      email: 'ops@safra.test',
      role: 'super_admin',
      preferredLocale: 'en',
      permissions: [...permissions],
    };
  }

  function cookieBytes(permissions: readonly string[]): number {
    const session = sessionFrom(
      {
        accessToken: tokenFor(permissions),
        expiresIn: 900,
        user: authUser(permissions),
      },
      /* A refresh token is 32 random bytes, hex-encoded by the API. */
      'k'.repeat(64),
    );

    /*
      URL-encoded, because that is what is actually sent. `encodeURIComponent` roughly TRIPLES
      every brace and quote in the JSON — measuring the raw string would understate the real
      cookie by more than a thousand bytes and the test would pass while the browser dropped it.
    */
    const value = encodeURIComponent(encodeSession(session));

    return Buffer.byteLength(`${STAFF_SESSION_COOKIE}=${value}`, 'utf8');
  }

  const everyPermission = Object.values(PERMISSIONS);

  it('a super admin holding every permission fits with room to spare', () => {
    const bytes = cookieBytes(everyPermission);

    expect(
      bytes,
      `The staff session cookie is ${bytes} bytes. A browser DROPS anything over ` +
        `${COOKIE_BYTE_LIMIT}, silently — sign-in then fails with no error anywhere. ` +
        'Do not raise this threshold: take something out of the cookie or out of the token.',
    ).toBeLessThan(COOKIE_BYTE_LIMIT * 0.75);
  });

  it('every role fits, not only the widest', () => {
    for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS)) {
      expect(cookieBytes(permissions), role).toBeLessThan(COOKIE_BYTE_LIMIT * 0.75);
    }
  });

  /**
   * The permission list is in the cookie ONCE, in the token, and not beside it.
   *
   * This is the assertion that fails if somebody puts `user.permissions` back — which would not
   * break any test above on the day it happened, because the margin would absorb it, and would
   * instead break sign-in silently some months later when the list grew.
   */
  it('does not carry the permission list outside the token', () => {
    const session = sessionFrom(
      {
        accessToken: tokenFor(everyPermission),
        expiresIn: 900,
        user: authUser(everyPermission),
      },
      'k'.repeat(64),
    );

    expect(session.user).not.toHaveProperty('permissions');
    /* And the general question, not only the field name: the blob is not a permission list. */
    expect(JSON.stringify(session.user)).not.toContain(PERMISSIONS.PAYOUT_EXECUTE);
  });

  /** The control: the measurement can fail, so a green result means something. */
  it('measures a real cookie — a hundred more permissions would not fit', () => {
    const bloated = [
      ...everyPermission,
      ...Array.from({ length: 100 }, (_, i) => `synthetic.permission_number_${i}`),
    ];

    expect(cookieBytes(bloated)).toBeGreaterThan(COOKIE_BYTE_LIMIT);
  });
});
