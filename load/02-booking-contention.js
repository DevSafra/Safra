import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

import { API, FRACTION, isoDate } from './config.js';

/**
 * Scenario 2 — booking creation, deliberately contended. `docs/load-testing.md`.
 *
 * ## The concentration is the point
 *
 * The plan: "200 concurrent bookings against 20 units, so the exclusion constraint over `daterange`
 * is actually contended. Spreading them across a thousand units would measure nothing — the
 * interesting question is what happens when two people want the same room on the same night, and the
 * answer must be that exactly one gets it."
 *
 * So every virtual user aims at the same small pool of units and the same narrow band of nights.
 *
 * ## This is the one scenario whose result is honest on a laptop
 *
 * Its primary criterion is CORRECTNESS, not latency: exactly one winner per (unit, night). An
 * exclusion constraint either holds under concurrency or it does not, and that is a property of
 * PostgreSQL and the schema rather than of the hardware. The p99 measured here is not a capacity
 * figure; the double-booking count is a real answer.
 *
 * ## A 409 is the system working, so it must not count as an error
 *
 * A booking that loses the race is refused. k6's default `http_req_failed` counts any non-2xx as a
 * failure, which would fail the error-budget threshold on a perfectly correct run — so the response
 * callback below treats everything under 500 as expected, and only a 5xx counts against the budget.
 *
 * ## What k6 cannot check, and does not pretend to
 *
 * Whether two bookings actually landed on one night is a question only the database can answer, and
 * this script has no database connection. It is deliberately NOT expressed as a k6 threshold: a
 * counter that nothing increments would pass at zero and read as proof. `pnpm load:invariants` runs
 * the query, and `teardown` prints the reminder.
 */
const created = new Counter('bookings_created');
const conflicted = new Counter('bookings_conflicted');

/** How many units the whole run competes over. The plan says 20. */
const UNIT_POOL = 20;

/** Nights available to compete for. Small, so collisions are the norm rather than the exception. */
const NIGHT_SPREAD = 10;

/* Under 500 is an expected answer here — see the class note on 409s. */
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  scenarios: {
    contention: {
      executor: 'constant-vus',
      vus: Math.max(2, Math.round(200 * FRACTION)),
      duration: FRACTION >= 1 ? '5m' : '20s',
    },
  },
  thresholds: {
    /* The plan's derived budget: a slow creation holds the constraint and blocks another. */
    http_req_duration: ['p(99)<1000'],
    /* 5xx only, per the response callback above. */
    http_req_failed: ['rate<0.001'],
    /* A run where nothing succeeded would satisfy every other threshold trivially. */
    bookings_created: ['count>0'],
  },
};

/**
 * Picks the unit pool once, so every VU contends over the same rooms.
 *
 * Taken from a real search rather than a hardcoded list: unit ids are generated and differ per load
 * database.
 */
export function setup() {
  const response = http.get(
    `${API}/search?checkIn=${isoDate(30)}&checkOut=${isoDate(32)}&adults=2&limit=60`,
  );

  if (response.status !== 200) {
    throw new Error(
      `Search failed with ${response.status}. Is the API running with load data?`,
    );
  }

  const units = (response.json('items') || [])
    .map((item) => item.unitId)
    .filter(Boolean)
    .slice(0, UNIT_POOL);

  if (units.length < 2) {
    throw new Error(
      `Need at least 2 units to contend over, found ${units.length}. Run pnpm load:generate.`,
    );
  }

  return { units };
}

export default function () {
  const data = arguments[0];

  /*
    Deliberately NOT unique per iteration. Every VU aims at overlapping (unit, night) pairs, which is
    what produces the collisions this scenario exists to create.
  */
  const unit = data.units[(__ITER + __VU) % data.units.length];
  const night = 30 + ((__ITER + __VU) % NIGHT_SPREAD);

  const body = {
    unitId: unit,
    checkIn: isoDate(night),
    checkOut: isoDate(night + 2),
    adults: 2,
    guest: {
      fullName: `Load Guest ${__VU}`,
      email: `load-guest-${__VU}-${__ITER}@safra.test`,
      phone: '+963900000123',
    },
    /*
      Unique per attempt. A repeated idempotency key would make the second request replay the first
      one's response (EC-003) — correct behaviour that would quietly turn every collision into a
      success and hide precisely what is being measured.
    */
    idempotencyKey: `load-${__VU}-${__ITER}-${Date.now()}`,
  };

  const response = http.post(`${API}/bookings`, JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
    tags: { endpoint: 'booking_create' },
  });

  if (response.status === 200 || response.status === 201) {
    created.add(1);
  } else if (response.status === 409 || response.status === 422) {
    conflicted.add(1);
  }

  check(response, {
    'never a 5xx': (r) => r.status < 500,
    'a refusal carries an error CODE, not a sentence': (r) =>
      r.status < 400 || typeof r.json('code') === 'string',
  });
}

export function teardown() {
  console.log(
    '\nk6 cannot see the database. Run the invariant check now:\n' +
      '  pnpm load:invariants\n' +
      'Zero double-booked nights is this scenario’s real result.\n',
  );
}
