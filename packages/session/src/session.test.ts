import { describe, expect, it } from 'vitest';

import {
  CUSTOMER_SESSION_COOKIE,
  REFRESH_MARGIN_MS,
  STAFF_SESSION_COOKIE,
  decodeSession,
  encodeSession,
  hasTwoFactor,
  needsRefresh,
  readClaim,
  readStringArrayClaim,
  sessionCookieOptions,
  sessionPermissions,
  sessionFrom,
  type Session,
} from './session.js';

/**
 * The session cookie's encode/decode path.
 *
 * Worth testing precisely because its failure modes are silent: a decode that throws
 * turns every page into a 500, a decode that is too permissive keeps a half-valid
 * session alive, and an expiry calculation that is off by a factor of a thousand
 * either logs everyone out constantly or never refreshes at all.
 */
/*
  No `permissions`. The cookie stopped carrying them on 2026-09-04, when the super admin's session
  crossed 4096 bytes and browsers began dropping it silently — see the class note in `session.ts`
  and `session-size.test.ts`. They live in the signed token, which is where `sessionPermissions`
  has always read them from.
*/
const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'customer@safra.test',
  role: 'customer' as const,
  preferredLocale: 'ar' as const,
};

function session(overrides: Partial<Session> = {}): Session {
  return {
    accessToken: 'header.payload.signature',
    refreshToken: 'r'.repeat(43),
    user: USER,
    expiresAt: Date.now() + 900_000,
    ...overrides,
  };
}

describe('encode / decode', () => {
  it('round-trips a session', () => {
    const original = session();

    expect(decodeSession(encodeSession(original))).toStrictEqual(original);
  });

  /**
   * A cookie issued BEFORE the permission list was removed still parses.
   *
   * This is what makes the fix free of a forced sign-out: `z.object` strips keys it does not
   * declare, so an existing session decodes and simply loses a field nothing read. Without this
   * assertion the change looks safe and would in fact log out every signed-in member of staff at
   * the moment it deployed.
   */
  it('still accepts a cookie written before permissions were dropped', () => {
    const legacy = JSON.stringify({
      ...session(),
      user: { ...USER, permissions: ['booking.read_own', 'wallet.read'] },
    });
    const decoded = decodeSession(legacy);

    expect(decoded).not.toBeNull();
    expect(decoded?.user.email).toBe(USER.email);
    expect(decoded?.user).not.toHaveProperty('permissions');
  });

  it('returns null for an absent cookie', () => {
    expect(decodeSession(undefined)).toBeNull();
    expect(decodeSession('')).toBeNull();
  });

  /**
   * A cookie left over from an older shape must sign the customer out cleanly, not
   * throw. Every page reads this, so an exception here is a site-wide 500.
   */
  it('returns null rather than throwing on malformed JSON', () => {
    expect(decodeSession('{not json')).toBeNull();
    expect(decodeSession('null')).toBeNull();
    expect(decodeSession('"a string"')).toBeNull();
  });

  it('rejects a session missing a required field', () => {
    const { refreshToken: _dropped, ...incomplete } = session();

    expect(decodeSession(JSON.stringify(incomplete))).toBeNull();
  });

  it('rejects a session whose user fails the shared schema', () => {
    const bad = { ...session(), user: { ...USER, role: 'god_mode' } };

    expect(decodeSession(JSON.stringify(bad))).toBeNull();
  });

  it('rejects an empty access token rather than treating it as present', () => {
    expect(decodeSession(JSON.stringify(session({ accessToken: '' })))).toBeNull();
  });
});

describe('sessionFrom', () => {
  /**
   * `expiresIn` is SECONDS by OAuth convention and `expiresAt` is milliseconds.
   * Confusing the two is the classic version of this bug: treating 900 as
   * milliseconds expires the session almost immediately.
   */
  it('converts expiresIn seconds into an absolute millisecond deadline', () => {
    const now = 1_700_000_000_000;

    const built = sessionFrom(
      { accessToken: 'a.b.c', expiresIn: 900, user: USER },
      'refresh',
      now,
    );

    expect(built.expiresAt).toBe(now + 900_000);
  });
});

describe('needsRefresh', () => {
  it('is false for a token with plenty of life', () => {
    const now = 1_700_000_000_000;

    expect(needsRefresh(session({ expiresAt: now + 600_000 }), now)).toBe(false);
  });

  it('is true once the token has expired', () => {
    const now = 1_700_000_000_000;

    expect(needsRefresh(session({ expiresAt: now - 1 }), now)).toBe(true);
  });

  /**
   * The margin is the point. A token still valid when middleware checks it can
   * expire during the render that follows, and that page has no way to recover.
   */
  it('is true inside the safety margin, before actual expiry', () => {
    const now = 1_700_000_000_000;
    const expiring = session({ expiresAt: now + REFRESH_MARGIN_MS - 1 });

    expect(needsRefresh(expiring, now)).toBe(true);
  });

  it('is false just outside the margin', () => {
    const now = 1_700_000_000_000;
    const fine = session({ expiresAt: now + REFRESH_MARGIN_MS + 1 });

    expect(needsRefresh(fine, now)).toBe(false);
  });
});

describe('cookie attributes', () => {
  /** Rule 1: HttpOnly and SameSite=Strict are not optional on a session cookie. */
  it('is HttpOnly, SameSite=Strict and site-wide', () => {
    const options = sessionCookieOptions(3600);

    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('strict');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(3600);
  });

  /**
   * A Secure cookie is dropped over plain HTTP, so hardcoding it would make local
   * development appear to sign in and then immediately forget.
   */
  it('follows NODE_ENV for Secure', () => {
    expect(sessionCookieOptions(1).secure).toBe(process.env.NODE_ENV === 'production');
  });
});

describe('cookie names', () => {
  /**
   * Not tidiness — correctness. Cookies are scoped by domain and IGNORE the port, so
   * a customer session on `localhost:3000` and a staff session on `localhost:3001`
   * would be the same cookie if these matched. In development that means signing
   * into the admin app silently replaces the customer session, or the public app
   * starts rendering with staff claims.
   */
  it('differ between the customer and staff apps', () => {
    expect(CUSTOMER_SESSION_COOKIE).not.toBe(STAFF_SESSION_COOKIE);
  });
});

describe('hasTwoFactor', () => {
  function tokenWith(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `header.${encoded}.signature`;
  }

  it('is true when the claim says so', () => {
    expect(hasTwoFactor(session({ accessToken: tokenWith({ totpEnabled: true }) }))).toBe(
      true,
    );
  });

  /**
   * Absent must mean NOT enrolled. A token minted before the claim existed would
   * otherwise wave its holder straight past the enrolment gate.
   */
  it('is false when the claim is absent', () => {
    expect(hasTwoFactor(session({ accessToken: tokenWith({ sub: 'u1' }) }))).toBe(false);
  });

  it('is false for anything that is not literally true', () => {
    for (const value of ['true', 1, 'yes', {}, null]) {
      expect(
        hasTwoFactor(session({ accessToken: tokenWith({ totpEnabled: value }) })),
      ).toBe(false);
    }
  });

  it('is false for a malformed token rather than throwing', () => {
    expect(hasTwoFactor(session({ accessToken: 'not-a-jwt' }))).toBe(false);
  });
});

describe('readClaim', () => {
  /** Built by hand so the test does not depend on a JWT library agreeing with us. */
  function jwt(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `header.${encoded}.signature`;
  }

  it('reads a claim from the payload', () => {
    const token = jwt({ sub: 'user-1', customerProfileId: 'profile-9' });

    expect(readClaim(token, 'customerProfileId')).toBe('profile-9');
  });

  /**
   * base64url uses `-` and `_` and drops padding; `atob` accepts neither. A payload
   * whose base64 happens to contain those characters is the case that breaks a naive
   * decoder, and it only shows up for some users.
   */
  it('handles a base64url payload needing padding and character swaps', () => {
    const token = jwt({ customerProfileId: 'a?b>c~d', note: 'ÿÿÿ' });

    expect(readClaim(token, 'customerProfileId')).toBe('a?b>c~d');
  });

  it('returns null for a claim that is absent', () => {
    expect(readClaim(jwt({ sub: 'user-1' }), 'customerProfileId')).toBeNull();
  });

  it('returns null for a non-string claim rather than coercing it', () => {
    expect(readClaim(jwt({ customerProfileId: 42 }), 'customerProfileId')).toBeNull();
  });

  it('returns null for a malformed token instead of throwing', () => {
    expect(readClaim('not-a-jwt', 'sub')).toBeNull();
    expect(readClaim('a.!!!not-base64!!!.c', 'sub')).toBeNull();
    expect(readClaim('', 'sub')).toBeNull();
  });
});

/**
 * The reader's own capabilities, for deciding what a nav OFFERS.
 *
 * Every case here is about the answer when the claim is NOT a clean list of strings. Both apps
 * gate their navigation on this, so a malformed claim that yielded something truthy would draw a
 * nav from a value nobody vouched for.
 */
describe('sessionPermissions', () => {
  function tokenWith(payload: Record<string, unknown>): string {
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    return `header.${encoded}.signature`;
  }

  it('reads the list the API signed', () => {
    const token = tokenWith({ permissions: ['booking.read_all', 'staff.manage'] });

    expect(sessionPermissions(session({ accessToken: token }))).toEqual([
      'booking.read_all',
      'staff.manage',
    ]);
  });

  /**
   * Absent means EMPTY, which downstream means "opens nothing".
   *
   * The safe direction for a value that decides what a nav shows: a token minted before this claim
   * existed draws a nav with nothing in it, which somebody reports. The opposite default draws
   * every link for everybody, which nobody reports because it looks correct.
   */
  it('is empty when the claim is absent, and for a malformed token', () => {
    expect(
      sessionPermissions(session({ accessToken: tokenWith({ sub: 'u1' }) })),
    ).toEqual([]);
    expect(sessionPermissions(session({ accessToken: 'not-a-jwt' }))).toEqual([]);
  });

  it('is empty for a claim that is not a list at all', () => {
    for (const value of ['booking.read_all', 42, { 0: 'booking.read_all' }, null]) {
      expect(
        sessionPermissions(session({ accessToken: tokenWith({ permissions: value }) })),
        JSON.stringify(value),
      ).toEqual([]);
    }
  });

  /** A mixed list keeps the strings and DROPS the rest, rather than passing `7` on to `.includes`. */
  it('drops non-string entries from a mixed list', () => {
    const token = tokenWith({
      permissions: ['booking.read_all', 7, null, 'staff.manage'],
    });

    expect(readStringArrayClaim(token, 'permissions')).toEqual([
      'booking.read_all',
      'staff.manage',
    ]);
  });
});
