import http from 'k6/http';
import { check } from 'k6';

import { API, FRACTION, searchQuery } from './config.js';

/**
 * Scenario 6 — the soak. `docs/load-testing.md`: "10 % of peak for 12 hours."
 *
 * ## A soak is not a load test run for longer
 *
 * The traffic is deliberately mild — a tenth of peak — because what it looks for cannot be seen in
 * twenty minutes at any intensity. The plan lists exactly four things:
 *
 *   - connection-pool exhaustion
 *   - memory growth
 *   - the advisory lock leaking
 *   - `notifications` or `audit_log` growth rates that would be a problem at a year
 *
 * Every one of those is a SLOPE, not a level. A pool leaking one connection per thousand requests is
 * invisible at any single moment and fatal by morning; an advisory lock that is taken and not released
 * by a scheduled job stops that job forever and nothing 500s.
 *
 * ## Which means the k6 result is the least interesting output
 *
 * This script's thresholds are a floor: if latency degrades or errors appear, something is already
 * wrong. The real result is the comparison between the START and the END of the window, which k6
 * cannot see because it lives in the database and in the process:
 *
 *   pnpm load:invariants          # before, and again after
 *   SELECT count(*) FROM pg_stat_activity WHERE datname = current_database();
 *   SELECT count(*) FROM pg_locks WHERE locktype = 'advisory';
 *   SELECT status, count(*) FROM notifications GROUP BY status;
 *
 * `docs/load-testing.md` §Metrics lists the rest. Record them at both ends or the soak has produced
 * nothing but a warm cache.
 *
 * ## Duration
 *
 * 12 hours at `LOAD_FRACTION=1`. Anything shorter is a rehearsal of this script, not a soak, and
 * should be reported as such.
 */
export const options = {
  scenarios: {
    soak: {
      executor: 'constant-vus',
      /* A tenth of scenario 1's peak, per the plan. */
      vus: Math.max(2, Math.round(200 * FRACTION)),
      duration: FRACTION >= 1 ? '12h' : '30s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    http_req_duration: ['p(95)<200', 'p(99)<500'],
  },
};

export default function () {
  const seed = __ITER * 17 + __VU;

  const search = http.get(`${API}/search?${searchQuery(seed)}`, {
    tags: { endpoint: 'search' },
  });

  check(search, { 'search answered 200': (r) => r.status === 200 });

  /*
    A read that touches a different pool path than search, so a leak confined to one of them still
    shows up. Health is deliberately included: it is the endpoint a load balancer will poll forever,
    and it must stay cheap while everything else is under load.
  */
  if (seed % 5 === 0) {
    const health = http.get(`${API}/health`, { tags: { endpoint: 'health' } });

    check(health, {
      'health answered 200 while under load': (r) => r.status === 200,
      /* Liveness must never touch a dependency; if it slows with load, it is doing too much. */
      'health stayed cheap': (r) => r.timings.duration < 50,
    });
  }
}

export function teardown() {
  console.log(
    '\nThe soak’s real result is the SLOPE, which k6 cannot see. Record now, and compare with the ' +
      'figures taken before the run:\n' +
      '  pnpm load:invariants\n' +
      '  connection count, advisory locks, notifications by status, audit_log growth\n' +
      'See docs/load-testing.md §Metrics to capture.\n',
  );
}
