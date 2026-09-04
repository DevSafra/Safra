import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import {
  BLOCKING_STATUSES,
  allowedTransitions,
  canTransition,
  TRANSITIONS,
} from './booking-state.js';

describe('booking state machine (§6.2)', () => {
  it('lets a customer start payment but never confirm their own booking', () => {
    expect(canTransition('draft', 'pending_payment', 'customer')).toBe(true);
    // §6.3 step 7: SAFRA confirms, after the partner approves. A customer
    // confirming their own booking would bypass the partner entirely.
    expect(canTransition('pending_confirmation', 'confirmed', 'customer')).toBe(false);
  });

  it('lets a partner reject but never confirm-to-customer directly', () => {
    expect(canTransition('pending_confirmation', 'cancelled', 'partner')).toBe(true);
    /*
      The case the portal's «قبول» button depends on, and the one this file did not have.

      Its three neighbours were all here — a customer cannot confirm, a partner can cancel, a
      partner cannot confirm from `pending_payment` — while the transition the entire two-hour
      window exists for was never asserted. It was `['staff', 'system']` from the first commit, so
      every partner acceptance answered 409 and the SLA then fined the partner for not replying.
    */
    expect(canTransition('pending_confirmation', 'confirmed', 'partner')).toBe(true);
    expect(canTransition('pending_payment', 'confirmed', 'partner')).toBe(false);
  });

  it('forbids skipping payment entirely', () => {
    // Nobody may jump a booking to confirmed without it having been paid.
    for (const actor of ['customer', 'partner', 'staff', 'system'] as const) {
      expect(canTransition('draft', 'confirmed', actor)).toBe(false);
      expect(canTransition('pending_payment', 'confirmed', actor)).toBe(false);
    }
  });

  it('treats cancelled as terminal', () => {
    for (const actor of ['customer', 'partner', 'staff', 'system'] as const) {
      expect(allowedTransitions('cancelled', actor)).toEqual([]);
    }
  });

  it('forbids reviving a completed booking into a live one', () => {
    expect(canTransition('completed', 'confirmed', 'staff')).toBe(false);
    expect(canTransition('completed', 'checked_in', 'staff')).toBe(false);
    // A dispute is the only way out of completed (§13.1).
    expect(canTransition('completed', 'disputed', 'customer')).toBe(true);
  });

  it('lets only staff resolve a dispute', () => {
    expect(canTransition('disputed', 'completed', 'staff')).toBe(true);
    expect(canTransition('disputed', 'completed', 'partner')).toBe(false);
    expect(canTransition('disputed', 'completed', 'customer')).toBe(false);
  });

  it('declares no transition without at least one permitted actor', () => {
    for (const transition of TRANSITIONS) {
      expect(transition.actors.length).toBeGreaterThan(0);
    }
  });

  it('never transitions a state to itself', () => {
    for (const transition of TRANSITIONS) {
      expect(transition.from).not.toBe(transition.to);
    }
  });
});

/**
 * The single most important invariant in the system.
 *
 * BLOCKING_STATUSES must match the WHERE clause of the exclusion constraint exactly.
 * If they drift, either the database rejects legitimate bookings, or — far worse — a
 * status that holds inventory is left out of the constraint and double bookings
 * become possible. Asserted against the migration file itself rather than a copy of
 * it, so editing one without the other fails here.
 */
describe('BLOCKING_STATUSES matches the database exclusion constraint', () => {
  it('lists exactly the statuses in the constraint predicate', () => {
    const migration = readFileSync(
      new URL(
        '../../../../packages/db/migrations/post/0001_constraints.sql',
        import.meta.url,
      ),
      'utf8',
    );

    const match =
      /bookings_no_overlapping_stays_v3[\s\S]*?WHERE \(status IN \(([^)]*)\)\)/.exec(
        migration,
      );

    expect(match, 'exclusion constraint not found in the migration').not.toBeNull();

    const fromSql = (match?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter(Boolean)
      .sort();

    expect(fromSql).toEqual([...BLOCKING_STATUSES].sort());
  });
});
