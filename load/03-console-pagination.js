import http from 'k6/http';
import { check } from 'k6';
import { Trend } from 'k6/metrics';

import { API, FRACTION } from './config.js';

/**
 * Scenario 3 — the staff console's deep pagination. `docs/load-testing.md`.
 *
 * ## What this measures and why it is not a bug hunt
 *
 * `OFFSET` is the console's DOCUMENTED exception (`O-page-1` in `docs/FUTURE-WORK.md`), taken
 * deliberately because Bashar's pagination bar shows a page NUMBER and a jump-to-page box, and
 * neither is expressible over keyset pagination. The costs are stated in
 * `packages/contracts/src/pagination.ts`: a deep OFFSET reads and discards every preceding row.
 *
 * So this is not asking whether OFFSET is slow. It is asking WHERE it stops being acceptable. The
 * plan: "Walk to page 1, 10, 100, 1,000 on a table of 1M rows. Success: p95 < 200 ms at page 100.
 * The number to discover is the page at which it stops being acceptable — that number goes into
 * O-page-1 and decides whether the ceiling of 100,000 needs lowering."
 *
 * ## One trend per page depth
 *
 * A single aggregate percentile over all depths would be meaningless — page 1 and page 1,000 are
 * different queries with different costs, and averaging them hides the shape. Each depth gets its own
 * `Trend`, so the output is a curve and the answer to "where does it break" can be read off it.
 *
 * Requires a staff token: `LOAD_STAFF_TOKEN`. The console's registries are authorised per request,
 * and they should be — a scenario that could read them without one would be reporting a security
 * failure, not a latency.
 */
const DEPTHS = [1, 10, 100, 1_000];

const byDepth = Object.fromEntries(
  DEPTHS.map((page) => [page, new Trend(`registry_page_${page}`, true)]),
);

const TOKEN = __ENV.LOAD_STAFF_TOKEN || '';

export const options = {
  scenarios: {
    pagination: {
      executor: 'constant-vus',
      vus: Math.max(1, Math.round(20 * FRACTION)),
      duration: FRACTION >= 1 ? '5m' : '20s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    /* The plan's stated success line. Deeper pages are MEASURED, not asserted — that is the point. */
    registry_page_1: ['p(95)<200'],
    registry_page_10: ['p(95)<200'],
    registry_page_100: ['p(95)<200'],
  },
};

export function setup() {
  if (!TOKEN) {
    throw new Error(
      'LOAD_STAFF_TOKEN is required. The console registries are authorised per request; sign in ' +
        'as staff and pass the access token:\n' +
        '  k6 run -e LOAD_STAFF_TOKEN=… load/03-console-pagination.js',
    );
  }

  const probe = http.get(`${API}/admin/registries/bookings?page=1&size=25`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  if (probe.status !== 200) {
    throw new Error(
      `The registry answered ${probe.status}. An expired or under-privileged token cannot ` +
        'measure pagination.',
    );
  }

  const total = probe.json('total');

  /*
    A million rows is the premise. Below that the deep pages do not exist and the curve is flat for
    the wrong reason — which would read as "OFFSET is fine".
  */
  if (typeof total === 'number' && total < 100_000) {
    console.warn(
      `WARNING: the bookings registry reports ${total} rows. The plan specifies 1M — this run ` +
        'measures a table small enough to sit in cache and its numbers do not transfer.',
    );
  }

  return {};
}

export default function () {
  for (const page of DEPTHS) {
    const response = http.get(`${API}/admin/registries/bookings?page=${page}&size=25`, {
      headers: { Authorization: `Bearer ${TOKEN}` },
      tags: { endpoint: 'registry', page: String(page) },
    });

    byDepth[page].add(response.timings.duration);

    check(response, {
      /* A page past the end must render an empty table, never a 400 — the reader TYPES the number. */
      [`page ${page} answered 200`]: (r) => r.status === 200,
    });
  }
}

export function handleSummary(data) {
  const line = (page) => {
    const metric = data.metrics[`registry_page_${page}`];

    if (!metric) return `  page ${String(page).padStart(5)}  no samples`;

    const p95 = metric.values['p(95)'];

    return (
      `  page ${String(page).padStart(5)}  p95 ${p95.toFixed(0).padStart(6)} ms  ` +
      (p95 < 200 ? 'within budget' : 'OVER the 200 ms budget')
    );
  };

  return {
    stdout:
      '\nOFFSET cost by page depth — the curve O-page-1 needs:\n' +
      DEPTHS.map(line).join('\n') +
      '\n\nThe shallowest page that exceeds 200 ms is the ceiling worth documenting.\n',
  };
}
