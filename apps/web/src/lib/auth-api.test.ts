import { describe, expect, it } from 'vitest';

import { readSetCookie } from './auth-api';

/**
 * Reading the API's rotated refresh token out of `Set-Cookie`.
 *
 * The failure here is quiet and delayed: miss the rotated token and the session
 * keeps working until the NEXT rotation, at which point the API rejects a spent
 * token and the customer is signed out for no visible reason. Worse, the API burns
 * a whole token family on replay detection, so sending a stale one looks like an
 * attack rather than a bug.
 */
describe('readSetCookie', () => {
  function headers(...cookies: string[]): Headers {
    const h = new Headers();
    for (const cookie of cookies) h.append('set-cookie', cookie);
    return h;
  }

  it('reads the value of the named cookie', () => {
    const h = headers('safra_refresh=abc123; Path=/api/v1/auth; HttpOnly');

    expect(readSetCookie(h, 'safra_refresh')).toBe('abc123');
  });

  /**
   * The reason this uses `getSetCookie()` rather than `get()`. A plain `get()` joins
   * multiple Set-Cookie headers with a comma, and cookie ATTRIBUTES legitimately
   * contain commas (`Expires=Wed, 09 Jun 2027`), so splitting the joined string
   * lands in the wrong place.
   */
  it('picks the right cookie when several are set', () => {
    const h = headers(
      'other=first; Path=/',
      'safra_refresh=wanted; Path=/api/v1/auth; Expires=Wed, 09 Jun 2027 10:18:14 GMT',
      'another=last; Path=/',
    );

    expect(readSetCookie(h, 'safra_refresh')).toBe('wanted');
  });

  it('returns undefined when the cookie is absent', () => {
    expect(readSetCookie(headers('other=1'), 'safra_refresh')).toBeUndefined();
  });

  it('returns undefined when there are no Set-Cookie headers at all', () => {
    expect(readSetCookie(new Headers(), 'safra_refresh')).toBeUndefined();
  });

  /**
   * A CLEARED cookie arrives as an empty value. Treating that as a token would
   * store the empty string and produce a session that fails every refresh.
   */
  it('treats a cleared cookie as absent', () => {
    const h = headers('safra_refresh=; Path=/api/v1/auth; Max-Age=0');

    expect(readSetCookie(h, 'safra_refresh')).toBeUndefined();
  });

  it('does not match a cookie whose name merely shares a prefix', () => {
    const h = headers('safra_refresh_old=nope; Path=/');

    expect(readSetCookie(h, 'safra_refresh')).toBeUndefined();
  });

  it('tolerates a malformed header without throwing', () => {
    expect(
      readSetCookie(headers('garbage-without-equals'), 'safra_refresh'),
    ).toBeUndefined();
  });
});
