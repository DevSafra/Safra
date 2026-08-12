import http from 'k6/http';
import { check, group } from 'k6';

import { API, FRACTION, THRESHOLDS, WEB, ramp, searchQuery } from './config.js';

/**
 * Scenario 1 — search and browse. `docs/load-testing.md`: 80 % of real traffic.
 *
 * ## What this is really testing
 *
 * The plan says it: "whether the search predicate uses its indexes at a realistic row count, and
 * whether the customer app's ISR cache absorbs what it should." Both need production-shaped data —
 * over the development database's 13 availability rows every plan is a cached sequential scan and
 * every number is a lie. Generate with `pnpm load:generate` first.
 *
 * ## Why the query varies per iteration
 *
 * Every virtual user asking for the same city and the same dates would be answered from PostgreSQL's
 * cache after the first, and the run would measure the cache instead of the index. `searchQuery`
 * spreads dates over 300 days and rotates cities, types and sort orders, so the index is asked real
 * questions. This is the single easiest way to produce a load test that passes and predicts nothing.
 *
 * ## The web page is measured separately from the API
 *
 * `web_page` covers the server-rendered customer pages, which have their own ISR cache and their own
 * budget (< 2 s initial load). Mixing them into one percentile would let a fast API hide a slow page,
 * and the two are fixed in different places.
 */
export const options = {
  stages: ramp(FRACTION),
  thresholds: {
    ...THRESHOLDS,
    /* The API budget, asserted per endpoint group rather than only in aggregate. */
    'http_req_duration{endpoint:search}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{endpoint:property}': ['p(95)<200', 'p(99)<500'],
    'http_req_duration{endpoint:cities}': ['p(95)<200'],
    /* Rule 3's page budget. A server-rendered page is allowed more than an API call. */
    'http_req_duration{endpoint:web_page}': ['p(95)<2000'],
  },
};

/**
 * Property slugs, fetched once per VU rather than per iteration.
 *
 * A load test that discovers its own targets by searching first would make every property read
 * depend on a search, and the search's latency would appear inside the property read's.
 */
export function setup() {
  const response = http.get(`${API}/search?${searchQuery(1)}`, {
    tags: { endpoint: 'search' },
  });

  if (response.status !== 200) {
    throw new Error(
      `Cannot reach the search endpoint (${response.status}). Is the API running, and has ` +
        'pnpm load:generate been run against its database?',
    );
  }

  const items = response.json('items') || [];
  const slugs = items.map((item) => item.slug).filter(Boolean);

  if (slugs.length === 0) {
    throw new Error(
      'Search returned no properties. This scenario measures nothing without data — run ' +
        'pnpm load:generate.',
    );
  }

  return { slugs };
}

export default function (data) {
  const seed = __ITER * 31 + __VU;

  group('search', () => {
    const response = http.get(`${API}/search?${searchQuery(seed)}`, {
      tags: { endpoint: 'search' },
    });

    check(response, {
      'search answered 200': (r) => r.status === 200,
      /* A 200 holding an empty page would pass a latency threshold while measuring nothing. */
      'search returned items': (r) => (r.json('items') || []).length > 0,
    });
  });

  group('property detail', () => {
    const slug = data.slugs[seed % data.slugs.length];

    const response = http.get(`${API}/properties/${slug}`, {
      tags: { endpoint: 'property' },
    });

    check(response, { 'property answered 200': (r) => r.status === 200 });
  });

  /* Reference data, cached for five minutes by the web app — this is the origin behind that cache. */
  if (seed % 10 === 0) {
    const response = http.get(`${API}/cities`, { tags: { endpoint: 'cities' } });

    check(response, {
      'cities answered 200': (r) => r.status === 200,
      /* O-web-4: this came back as a braced STRING once, and the whole grid rendered empty. */
      'cities carry a real array of categories': (r) =>
        Array.isArray((r.json() || [{}])[0].categories),
    });
  }

  /* The server-rendered pages, at a tenth of the API rate — they are ISR-cached by design. */
  if (seed % 10 === 3) {
    const page = http.get(`${WEB}/ar`, { tags: { endpoint: 'web_page' } });

    check(page, {
      'home answered 200': (r) => r.status === 200,
      'home lists cities': (r) => r.body.includes('/ar/city/'),
    });
  }
}
