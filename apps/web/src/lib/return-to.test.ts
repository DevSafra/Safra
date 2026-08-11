import { describe, expect, it } from 'vitest';

import { RETURN_PARAM, returnParam, returnTo } from './return-to';

/**
 * The back control's destination, and why this is a security test rather than a navigation one.
 *
 * The obvious implementation — read a path out of the query and follow it — is an open redirect: a
 * crafted link turns the back button on OUR page into a hop somewhere else, and the reader has no
 * reason to distrust it. So the parameter carries a KEY and the href is built from a literal.
 *
 * These assertions are that guarantee. If somebody later "improves" this to accept a path, the forged
 * cases below start failing, which is the point of writing them down.
 */
describe('returnTo — honouring a known origin', () => {
  it.each([
    ['bookings', '/ar/account/bookings'],
    ['reviews', '/ar/account/reviews'],
    ['wallet', '/ar/account/wallet'],
    ['account', '/ar/account'],
    ['search', '/ar/search'],
    ['home', '/ar'],
  ])('sends %s to %s', (from, expected) => {
    expect(returnTo('ar', from, 'home')).toBe(expected);
  });

  it('prefixes the locale it is given, not a hard-coded one', () => {
    expect(returnTo('de', 'bookings', 'home')).toBe('/de/account/bookings');
    expect(returnTo('en', 'wallet', 'home')).toBe('/en/account/wallet');
  });
});

describe('returnTo — falling back', () => {
  it('uses the fallback when no origin is given', () => {
    expect(returnTo('ar', undefined, 'reviews')).toBe('/ar/account/reviews');
  });

  it('uses the fallback for an unknown key rather than erroring', () => {
    expect(returnTo('ar', 'nowhere-in-particular', 'account')).toBe('/ar/account');
  });

  /*
    A repeated parameter arrives as an ARRAY. Ignored rather than guessed at: `?from=a&from=b` has no
    single answer, and picking one would be inventing intent.
  */
  it('ignores a repeated parameter', () => {
    expect(returnTo('ar', ['bookings', 'wallet'], 'home')).toBe('/ar');
  });
});

/**
 * The forged cases. Every one must be IGNORED, not followed.
 *
 * Each is a real redirect technique: an absolute URL, a protocol-relative host, traversal, header
 * injection, an encoded slash, and a javascript: scheme.
 */
describe('returnTo — a forged origin cannot redirect anywhere', () => {
  it.each([
    'https://evil.example.com',
    'http://evil.example.com',
    '//evil.example.com',
    '/../../etc/passwd',
    '../../../',
    '/ar/account ',
    '%2f%2fevil.example.com',
    'javascript:alert(1)',
    'HOME',
    ' home',
    'home ',
  ])('ignores %j', (forged) => {
    /* The fallback, and nothing else. */
    expect(returnTo('ar', forged, 'home')).toBe('/ar');
  });

  /**
   * The invariant behind all of the above, stated once.
   *
   * Whatever arrives, the result is a locale-prefixed path built in this module — never an absolute
   * URL, never a scheme, never a traversal.
   */
  it.each([
    'https://evil.example.com',
    '//evil.example.com',
    '../..',
    'bookings',
    undefined,
  ])('always returns a same-origin path for %j', (input) => {
    const href = returnTo('en', input, 'home');

    expect(href.startsWith('/en')).toBe(true);
    expect(href).not.toContain('//');
    expect(href).not.toContain(':');
    expect(href).not.toContain('..');
  });

  /* `Object.prototype` keys are not origins. `hasOwnProperty` is why, and this proves it. */
  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])(
    'does not treat the prototype key %s as an origin',
    (key) => {
      expect(returnTo('ar', key, 'home')).toBe('/ar');
    },
  );
});

describe('returnParam', () => {
  it('writes the parameter the reading half looks for', () => {
    expect(returnParam('bookings')).toBe(`${RETURN_PARAM}=bookings`);
  });

  /* Round trip: what a list writes is what a detail screen resolves. */
  it.each(['bookings', 'reviews', 'wallet', 'account', 'search', 'home'] as const)(
    'round-trips %s',
    (origin) => {
      const value = new URLSearchParams(returnParam(origin)).get(RETURN_PARAM);

      expect(returnTo('ar', value ?? undefined, 'search')).toBe(
        returnTo('ar', origin, 'search'),
      );
    },
  );
});
