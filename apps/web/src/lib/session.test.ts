import { describe, expect, it } from 'vitest';

import {
  REFRESH_MARGIN_MS,
  decodeSession,
  encodeSession,
  needsRefresh,
  readClaim,
  sessionCookieOptions,
  sessionFrom,
  type Session,
} from './session';

/**
 * The session cookie's encode/decode path.
 *
 * Worth testing precisely because its failure modes are silent: a decode that throws
 * turns every page into a 500, a decode that is too permissive keeps a half-valid
 * session alive, and an expiry calculation that is off by a factor of a thousand
 * either logs everyone out constantly or never refreshes at all.
 */
const USER = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'customer@safra.test',
  role: 'customer' as const,
  preferredLocale: 'ar' as const,
  permissions: ['booking.read_own', 'wallet.read'],
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
