import { expect, test } from '@playwright/test';

/**
 * Every URL the sitemap offers a crawler actually answers.
 *
 * ## Why this did not exist and now does
 *
 * `sitemap.ts` has said since it was written that a listed URL which 404s is «a crawler following a
 * 404 on our own invitation» — and nothing checked it. The document is built from four sources
 * (cities, landmarks, group trips and the locale roots) and a path shape changing in any of them
 * breaks it silently: a sitemap is the one page nobody opens, so the first report would be a
 * coverage drop in Search Console weeks later.
 *
 * Adding جروبات to it (Bashar, 2026-09-28) is what made the absence worth closing rather than
 * noting. This is the check the file's own docblock describes.
 *
 * ## Two assertions, and why they are not the same one
 *
 * «Nothing 404s» is the check every entry must pass: a dead URL spends crawl budget and teaches
 * Google an address we did not mean. «200 without a redirect» is stricter and is applied to the
 * GROUP-TRIP entries only — deliberately, because the landmark entries do not pass it.
 *
 * `/{locale}/landmark/{slug}` is a 307 BY DESIGN: it resolves the landmark and forwards to
 * `/search` with the filter applied, which `landmark/[slug]/page.tsx` argues for at length and is
 * a reasonable build. What makes it a defect in THIS document is the far end — `/search` answers
 * `noindex, follow`, so 125 sitemap entries lead a crawler to a page it is told not to index, and
 * the page built so «فنادق قرب الجامع الأموي» would have somewhere to rank cannot rank. That is a
 * product decision rather than a test's to make: recorded in `docs/FUTURE-WORK.md`, not excused
 * here with an exemption list that would quietly grow.
 */
const BASE = 'http://localhost:3000';

/** The `<loc>` of every entry, in document order. */
async function sitemapUrls(request: {
  get: (url: string) => Promise<{ status: () => number; text: () => Promise<string> }>;
}): Promise<string[]> {
  const response = await request.get(`${BASE}/sitemap.xml`);

  expect(response.status(), 'sitemap.xml itself must be served').toBe(200);

  return [...(await response.text()).matchAll(/<loc>([^<]+)<\/loc>/g)].map(
    (m) => m[1] ?? '',
  );
}

test('no URL in the sitemap is dead', async ({ request }) => {
  const urls = await sitemapUrls(request);

  /*
    The control. An empty document satisfies «every URL answers» perfectly, and an empty document
    is exactly what a broken build or a failed reference read produces — which is the failure this
    spec exists to catch, not to pass silently.
  */
  expect(urls.length, 'the sitemap should not be empty').toBeGreaterThan(10);

  const dead: string[] = [];

  for (const url of urls) {
    /*
      NOT followed, and that is both correct and fast. A landmark whose slug no longer resolves
      answers 404 BEFORE it would redirect — `landmark/[slug]` calls `notFound()` on a missing one
      — so a 3xx already proves the entry is alive. Following them instead ran 125 real searches
      and timed out the test, which would have read as «the sitemap is broken».
    */
    const response = await request.get(url, { maxRedirects: 0 });

    if (response.status() >= 400) dead.push(`${url} → ${response.status()}`);
  }

  expect(
    dead,
    'These are advertised to crawlers and do not answer. A dead sitemap entry is worse than no ' +
      'entry: it spends crawl budget and teaches Google an address we did not mean.',
  ).toEqual([]);
});

test('every group-trip URL answers 200 with no redirect', async ({ request }) => {
  const urls = (await sitemapUrls(request)).filter((url) =>
    /\/(ar|en|de)\/groups/.test(url),
  );

  expect(urls.length, 'no group-trip URL reached the sitemap at all').toBeGreaterThan(0);

  const notCanonical: string[] = [];

  for (const url of urls) {
    const response = await request.get(url, { maxRedirects: 0 });

    if (response.status() !== 200) notCanonical.push(`${url} → ${response.status()}`);
  }

  /*
    Strict here and nowhere else. A sitemap's whole job is to name CANONICAL addresses, and a
    crawler handed a redirect learns the URL we named is not the one we meant. These are the
    entries this change added, so these are the ones it is answerable for.
  */
  expect(notCanonical, 'a group-trip URL does not answer on its own address').toEqual([]);
});

test('the sitemap carries every locale of the group-trip pages', async ({ request }) => {
  const urls = await sitemapUrls(request);

  /*
    Named explicitly rather than counted, because «some /groups URL is present» would stay green if
    two of the three locales dropped out — and a German reader searching in German landing on the
    Arabic page is the failure `alternates.languages` exists to prevent.
  */
  for (const locale of ['ar', 'en', 'de']) {
    expect(urls, `${locale} is missing its group-trip list`).toContain(
      `${BASE}/${locale}/groups`,
    );
  }

  /* And at least one trip DETAIL, so the list being present is not mistaken for the set being. */
  const details = urls.filter((url) => /\/(ar|en|de)\/groups\/[^/]+$/.test(url));

  expect(details.length, 'no published group trip reached the sitemap').toBeGreaterThan(
    0,
  );
});
