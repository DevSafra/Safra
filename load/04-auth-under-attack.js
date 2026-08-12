import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';

import { API, FRACTION } from './config.js';

/**
 * Scenario 4 — authentication under a credential-stuffing shape. `docs/load-testing.md`.
 *
 * ## The property being proved is not "the limiter fires"
 *
 * That much is already covered by `e2e/auth-throttle.spec.ts`. What only load can show is the
 * property `O-sec-1` exists for, and the plan says it explicitly:
 *
 *   "lockouts fire, the IP+account limiter holds, LEGITIMATE SIGN-INS ON UNRELATED ACCOUNTS FROM THE
 *    SAME NAT STILL SUCCEED — that last one is the property O-sec-1 exists for, and load is the only
 *    way to prove it under contention."
 *
 * A limiter that keys on IP alone passes every single-user test and locks out an entire office, a
 * university, or a mobile carrier's NAT the moment one person is attacked. That failure only appears
 * when the attack traffic and the legitimate traffic share an address, which is what this arranges.
 *
 * ## Two populations, one address
 *
 * The attacker VUs hammer 5,000 accounts with wrong passwords. The bystander VU signs in to its own
 * real account, repeatedly, from the same source. `bystander_success` must stay at 1.0 — if it dips,
 * the limiter is punishing the wrong person and that is a finding regardless of any latency.
 *
 * ## Run this against a THROWAWAY database
 *
 * It deliberately drives accounts into lockout. Pointed at a shared environment it would lock the
 * fixture accounts the browser suite signs in with, and the failures would surface later, elsewhere,
 * looking unrelated — the trap CLAUDE.md records about e2e state leaking between runs.
 */
const bystanderSuccess = new Rate('bystander_success');
const lockouts = new Counter('lockout_responses');
const attackRejected = new Counter('attack_rejected');

/** Wrong-password attempts spread over this many accounts. The plan says 5,000. */
const ACCOUNTS = Math.max(10, Math.round(5_000 * FRACTION));

/** A real account, unrelated to the attacked ones, signing in from the same address. */
const BYSTANDER_EMAIL = __ENV.LOAD_BYSTANDER_EMAIL || '';
const BYSTANDER_PASSWORD = __ENV.LOAD_BYSTANDER_PASSWORD || '';

/* Every answer here is a 4xx by design; only a 5xx is a failure. */
http.setResponseCallback(http.expectedStatuses({ min: 200, max: 499 }));

export const options = {
  scenarios: {
    attackers: {
      executor: 'constant-vus',
      vus: Math.max(2, Math.round(50 * FRACTION)),
      duration: FRACTION >= 1 ? '5m' : '20s',
      exec: 'attack',
    },
    bystander: {
      executor: 'constant-vus',
      vus: 1,
      duration: FRACTION >= 1 ? '5m' : '20s',
      exec: 'bystander',
      startTime: '5s',
    },
  },
  thresholds: {
    http_req_failed: ['rate<0.001'],
    /*
      The whole scenario, in one line. A collateral-damage limiter fails HERE and nowhere else.
      Not 'rate>0.99' — one refused legitimate sign-in is the bug.
    */
    bystander_success: ['rate==1.0'],
    /* And the attack must actually be refused, or the run proves nothing about the limiter. */
    attack_rejected: ['count>0'],
  },
};

export function setup() {
  if (!BYSTANDER_EMAIL || !BYSTANDER_PASSWORD) {
    throw new Error(
      'LOAD_BYSTANDER_EMAIL and LOAD_BYSTANDER_PASSWORD are required: without a legitimate ' +
        'sign-in sharing the attackers’ address, this scenario cannot test the one property it ' +
        'exists for. Use a throwaway account on a throwaway database — this run causes lockouts.',
    );
  }

  return {};
}

export function attack() {
  const account = (__VU * 997 + __ITER) % ACCOUNTS;

  const response = http.post(
    `${API}/auth/login`,
    JSON.stringify({
      email: `victim-${account}@safra.test`,
      password: `wrong-password-${__ITER}`,
    }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login_attack' },
    },
  );

  if (response.status === 429) lockouts.add(1);
  if (response.status === 401 || response.status === 429) attackRejected.add(1);

  check(response, {
    'never a 5xx': (r) => r.status < 500,
    /*
      Identical answers for known and unknown addresses. A different status or a different body would
      turn this endpoint into an account-enumeration oracle, which is what §10's review checked.
    */
    'refusal is generic': (r) => r.status === 401 || r.status === 429,
  });
}

export function bystander() {
  const response = http.post(
    `${API}/auth/login`,
    JSON.stringify({ email: BYSTANDER_EMAIL, password: BYSTANDER_PASSWORD }),
    {
      headers: { 'Content-Type': 'application/json' },
      tags: { endpoint: 'login_bystander' },
    },
  );

  /*
    A 200 or a 2FA challenge both mean the credentials were accepted and the limiter let them
    through. Anything else — 401, and 429 above all — is the collateral damage this measures.
  */
  const allowed = response.status === 200 || response.status === 202;

  bystanderSuccess.add(allowed);

  check(response, {
    'an unrelated account still signs in from the attacked address': () => allowed,
  });
}
