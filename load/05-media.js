import http from 'k6/http';
import { check } from 'k6';
import { Rate } from 'k6/metrics';

import { API, FRACTION } from './config.js';

/**
 * Scenario 5 — media. `docs/load-testing.md`: "2,000 concurrent image fetches. Mostly a CDN test;
 * the origin must not see them."
 *
 * ## The assertion is about WHO served the bytes
 *
 * Latency is the lesser half. The plan's requirement is that the origin does not see this traffic, so
 * what matters is the cache header on the way back: a `Cache-Control` that permits caching and, in a
 * real deployment, a CDN hit. An origin serving two thousand concurrent images at acceptable latency
 * is still a misconfiguration — it means every image request will cost origin bandwidth forever.
 *
 * `cache_eligible` therefore carries the finding, and it is checked rather than assumed. Locally
 * there is no CDN at all, which the plan already states; what a local run can still prove is that the
 * headers would let one work.
 *
 * ## Images are fetched direct from the object store
 *
 * So a 403 from a private bucket looks like a broken image and nothing logs it. That is a trap this
 * project has already hit; the check below fails loudly on a non-200 instead.
 */
const cacheEligible = new Rate('cache_eligible');

export const options = {
  scenarios: {
    media: {
      executor: 'constant-vus',
      vus: Math.max(2, Math.round(2_000 * FRACTION)),
      duration: FRACTION >= 1 ? '3m' : '20s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    /* An image is bytes off a disk or a CDN; it has no excuse for an API-sized budget. */
    http_req_duration: ['p(95)<200'],
    /*
      Not 1.0: the plan accepts that some responses (a redirect to the store, an error page) carry no
      cache header. A rate below 0.95 means the origin is being asked to serve images uncached.
    */
    cache_eligible: ['rate>0.95'],
  },
};

/**
 * Collects real image URLs from a property page.
 *
 * Hardcoding a file key would test one object and, once it was deleted, would test a 404 forever.
 */
export function setup() {
  const search = http.get(
    `${API}/search?checkIn=${date(30)}&checkOut=${date(32)}&adults=2&limit=20`,
  );

  if (search.status !== 200) {
    throw new Error(
      `Search failed with ${search.status}. Is the API running with load data?`,
    );
  }

  const slugs = (search.json('items') || []).map((item) => item.slug).filter(Boolean);
  const urls = [];

  for (const slug of slugs.slice(0, 10)) {
    const detail = http.get(`${API}/properties/${slug}`);
    const images = detail.json('images') || [];

    for (const image of images) {
      if (image && image.url) urls.push(image.url);
    }
  }

  if (urls.length === 0) {
    throw new Error(
      'No image URLs found on any property. The load generator does not create images — either ' +
        'seed some, or skip this scenario and say so in the results rather than reporting a pass.',
    );
  }

  return { urls };
}

export default function () {
  const data = arguments[0];
  const url = data.urls[(__ITER + __VU) % data.urls.length];

  const response = http.get(url, { tags: { endpoint: 'media' } });

  const cacheControl =
    response.headers['Cache-Control'] || response.headers['cache-control'] || '';
  const cacheable = /max-age=[1-9]/.test(cacheControl) || /public/.test(cacheControl);

  cacheEligible.add(cacheable);

  check(response, {
    'image answered 200': (r) => r.status === 200,
    /* A private bucket answers 403 and the page shows a broken image with nothing in the log. */
    'not a bucket permission error': (r) => r.status !== 403,
    'carries a cache header a CDN can act on': () => cacheable,
  });
}

function date(days) {
  const at = new Date();

  at.setUTCDate(at.getUTCDate() + days);

  return at.toISOString().slice(0, 10);
}
