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
 * Google an address we did not mean. «200 without a redirect» is stricter, and as of 2026-09-28 it
 * applies to EVERY entry.
 *
 * It did not, once. `/{locale}/landmark/{slug}` used to be a 307 to `/search`, and `/search`
 * answers `noindex, follow` — so 125 entries, a quarter of this document, led a crawler to a page
 * we tell it to skip, and the surface built so «فنادق قرب الجامع الأموي» would have somewhere to
 * rank could not rank. That was recorded as O-seo-1 rather than excused here with an exemption
 * list, and Bashar resolved it by making the landmark pages real (see `landmark/[slug]/page.tsx`).
 *
 * So the carve-out is gone, and its absence is the assertion: a future change that turns any
 * sitemap address back into a redirect fails «every URL answers on its own address» immediately,
 * rather than being quietly added to a list of exceptions.
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

test('every URL in the sitemap answers 200 on its own address', async ({ request }) => {
  const urls = await sitemapUrls(request);

  /*
    The control. An empty document satisfies «every URL answers» perfectly, and an empty document
    is exactly what a broken build or a failed reference read produces — which is the failure this
    spec exists to catch, not to pass silently.
  */
  expect(urls.length, 'the sitemap should not be empty').toBeGreaterThan(10);

  /*
    Named rather than merely counted. «Some URL is strict» would stay green if the landmark
    entries — the ones that used to redirect, and the reason this assertion widened — stopped
    reaching the document at all, which is indistinguishable from them passing.
  */
  const landmarks = urls.filter((url) => /\/(ar|en|de)\/landmark\//.test(url));
  const groups = urls.filter((url) => /\/(ar|en|de)\/groups/.test(url));

  expect(landmarks.length, 'no landmark URL reached the sitemap at all').toBeGreaterThan(
    0,
  );
  expect(groups.length, 'no group-trip URL reached the sitemap at all').toBeGreaterThan(
    0,
  );

  const notCanonical: string[] = [];

  for (const url of urls) {
    const response = await request.get(url, { maxRedirects: 0 });

    if (response.status() !== 200) notCanonical.push(`${url} → ${response.status()}`);
  }

  /*
    One sweep, not two. This subsumes the «nothing 404s» check it replaced — every status at or
    above 400 is also not 200 — and running both meant two passes over ~150 URLs to learn the same
    thing. Redirects are NOT followed, which is what keeps it quick: before this change, following
    them ran 125 real searches and timed the test out.
  */
  expect(
    notCanonical,
    'These are advertised to crawlers and do not answer on the address we named. A dead entry ' +
      'spends crawl budget and teaches Google an address we did not mean; a redirecting one ' +
      'teaches it that the address we named is not the one we meant. A sitemap names CANONICAL ' +
      'addresses or it is worse than absent.',
  ).toEqual([]);
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
