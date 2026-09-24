import { expect, test } from '@playwright/test';

/**
 * A crafted URL answers 404, on every public route family, in every locale.
 *
 * ## The failure
 *
 * `/ar/city/a%27b` — a city slug containing a percent-encoded apostrophe — answered **500**, and so
 * did `%5E` and `%7C`. On property, city and landmark alike, in all three locales. The API was
 * blameless: it answers `404 landmark.not_found` for exactly that slug and its query is
 * parameterised. The middleware's own locale REWRITE stopped being recognised as same-origin, Next
 * took it for an external target and proxied the request to `localhost` while the server listens on
 * `127.0.0.1` — `Failed to proxy … ECONNREFUSED`, and «Internal Server Error» to the reader.
 *
 * ## Why an HTTP spec and not only the unit test
 *
 * `apps/web/src/lib/routable-path.test.ts` proves the PREDICATE, and a predicate wired to nothing is
 * a state this codebase has shipped: a guard registered nowhere, green in every suite. Only a real
 * request through the real middleware proves the rule is in the path — and the defect was never
 * visible in a unit test, because it lived in the interaction between our rewrite and Next's router.
 *
 * It signs in for nothing, so it costs nothing from the sign-in budget.
 */
test.use({ baseURL: 'http://localhost:3000' });

/**
 * The three that produced a 500, plus the shapes around them.
 *
 * The first three are the regression. The rest are there because a fix aimed at three characters is
 * a fix that the fourth walks around: `%2F` would smuggle a path separator into a segment, `%25` and
 * `%zz` are percent-sequences that do not decode at all, and each of those is a different branch.
 */
const CRAFTED = [
  { name: 'apostrophe', segment: 'a%27b' },
  { name: 'caret', segment: 'a%5Eb' },
  { name: 'pipe', segment: 'a%7Cb' },
  { name: 'encoded separator', segment: 'a%2Fb' },
  { name: 'bare percent', segment: 'a%25b' },
  { name: 'not a percent-sequence', segment: 'a%zzb' },
];

const FAMILIES = ['property', 'city', 'landmark'];
const LOCALES = ['ar', 'en', 'de'];

for (const locale of LOCALES) {
  for (const family of FAMILIES) {
    test(`/${locale}/${family} answers 404 to a crafted slug, never 500`, async ({
      request,
    }) => {
      for (const { name, segment } of CRAFTED) {
        const path = `/${locale}/${family}/${segment}`;
        const response = await request.get(path, { maxRedirects: 0 });

        expect(response.status(), `${path} (${name})`).toBe(404);
      }
    });
  }
}

/**
 * The other half, and the half a «no 500s» assertion cannot give you.
 *
 * A guard that answered 404 to everything would satisfy every test above. These are the paths that
 * must still resolve — including one written with a valid ENCODING of a valid character, because the
 * rule is about what a segment means rather than how it is spelt, and a guard built on the raw
 * string would break it.
 */
test('a real path still resolves, however it is spelt', async ({ request }) => {
  const cases: { path: string; expected: number[]; why: string }[] = [
    { path: '/ar/city/damascus', expected: [200], why: 'a real city' },
    { path: '/ar/city/dam%61scus', expected: [200], why: 'the same city, a as %61' },
    {
      path: '/ar/landmark/umayyad-mosque',
      expected: [307],
      why: 'a landmark redirects into search',
    },
    { path: '/ar/no-such-page', expected: [404], why: 'an ordinary unmatched path' },
    { path: '/ar/account', expected: [307], why: 'a protected page still redirects' },
  ];

  for (const { path, expected, why } of cases) {
    const response = await request.get(path, { maxRedirects: 0 });

    expect(expected, `${path} — ${why}`).toContain(response.status());
  }
});

/**
 * A query string is not a routing question.
 *
 * The search box takes apostrophes, Arabic and spaces every day. The guard reads `nextUrl.pathname`,
 * which excludes the query by construction — this is here so that a future refactor passing the
 * whole href fails in the suite rather than by making search unreachable for anyone typing «فندق».
 */
test('a crafted QUERY string is left alone', async ({ request }) => {
  const response = await request.get(
    '/ar/search?citySlug=damascus&q=%D9%81%D9%86%D8%AF%D9%82%20a%27b%5Ec%7Cd',
    { maxRedirects: 0 },
  );

  expect(response.status()).toBe(200);
});
