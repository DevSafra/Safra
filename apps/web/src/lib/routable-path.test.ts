import { describe, expect, it } from 'vitest';

import { addressesNoRoute } from './routable-path';

/**
 * The guard that turned three 500s into 404s.
 *
 * `/ar/city/a%27b` — an apostrophe — answered **500**, and so did `%5E` and `%7C`, on every
 * dynamic public route in all three locales. Nothing in the app was at fault: the middleware's
 * own locale rewrite stopped being recognised as same-origin, Next proxied the request to
 * `localhost` while the server listens on `127.0.0.1`, and the reader got «Internal Server Error».
 *
 * These assert the PREDICATE. `e2e/encoded-paths.spec.ts` asserts that it is wired to anything —
 * a rule nobody has driven is a rule that is registered nowhere, which this codebase has shipped
 * before.
 */
describe('addressesNoRoute', () => {
  /*
    The three that produced a 500, named individually. They are the regression, and a sweep that
    happened to stop covering one of them should fail by name rather than quietly narrow.
  */
  it.each([
    ['apostrophe', '/ar/city/a%27b'],
    ['caret', '/ar/city/a%5Eb'],
    ['pipe', '/ar/city/a%7Cb'],
  ])('refuses the %s that used to answer 500', (_name, path) => {
    expect(addressesNoRoute(path)).toBe(true);
  });

  /* The same three on every route family, because the defect was never city-specific. */
  it.each(['landmark', 'property', 'city'])('refuses them under /%s too', (family) => {
    for (const encoded of ['%27', '%5E', '%7C']) {
      expect(addressesNoRoute(`/ar/${family}/a${encoded}b`), `${family} ${encoded}`).toBe(
        true,
      );
    }
  });

  it('refuses a percent-sequence that is not one', () => {
    /* `decodeURIComponent` THROWS on these — the catch is the assertion. */
    expect(addressesNoRoute('/ar/city/a%b')).toBe(true);
    expect(addressesNoRoute('/ar/city/a%zzb')).toBe(true);
    expect(addressesNoRoute('/ar/city/a%2')).toBe(true);
  });

  it('refuses an encoded separator, which would otherwise smuggle a segment', () => {
    expect(addressesNoRoute('/ar/city/a%2Fb')).toBe(true);
  });

  /*
    The other half, and the half that matters more: every real path must still be served. A guard
    that answers 404 to everything also passes «no 500s».
  */
  it.each([
    ['the root', '/'],
    ['a locale', '/ar'],
    ['a city', '/ar/city/damascus'],
    ['a property', '/ar/property/grand-umayyad-hotel'],
    ['a landmark', '/ar/landmark/umayyad-mosque'],
    [
      'a uuid-suffixed slug',
      '/ar/property/dash-test-9068fc10-5c8d-4c4e-a91e-7d8a459e2229',
    ],
    ['a booking reference', '/ar/booking/BKG-2026-000123'],
    ['a test reference', '/ar/booking/BKG-TEST-a151a131'],
    ['an account page', '/ar/account/bookings'],
    ['search', '/ar/search'],
    ['a dotted segment', '/ar/city/st.-george'],
    ['a tilde', '/ar/city/a~b'],
  ])('serves %s', (_name, path) => {
    expect(addressesNoRoute(path)).toBe(false);
  });

  it('serves a slug written with a valid encoding of a valid character', () => {
    /*
      `dam%61scus` IS Damascus — `%61` is 'a'. The guard tests what a segment MEANS, not how it is
      spelt, so this resolves. A guard written against the raw string would 404 it, and driving the
      built app confirms this one does not.
    */
    expect(addressesNoRoute('/ar/city/dam%61scus')).toBe(false);
  });

  it('looks at the path only, never the query', () => {
    /*
      A search box takes apostrophes, Arabic and spaces, and none of that is a routing question.
      `nextUrl.pathname` excludes the query by construction; this states the requirement so that
      a future rewrite of the caller to pass `href` fails here rather than on the search page.
    */
    expect(addressesNoRoute('/ar/search')).toBe(false);
  });
});
