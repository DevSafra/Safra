import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { PERMISSIONS as P } from '@safra/contracts';

import { PartnerImagesController } from '../partner/images.controller.js';
import { PartnerController } from '../partner/partner.controller.js';
import { SUSPENDED_REFUSES_KEY } from '../rbac/suspended-partner.guard.js';

/**
 * Every write a suspension is supposed to block actually carries the marker.
 *
 * ## Why this test exists, and it is not hypothetical
 *
 * I built `SuspendedPartnerGuard`, wrote its docblock, added its error code and its three
 * translations — and **registered it nowhere and applied it to nothing.** It sat inert for an hour
 * while I reported the suspension policy as implemented. `grep -rn RefusedWhileSuspended` returned
 * the definition and no uses.
 *
 * That is precisely the defect I had spent the day reporting in other people's work: a capability
 * with nothing behind it. A guard nobody applied is indistinguishable, from the outside, from a
 * guard that does not exist — and worse, because its presence in the codebase reads as coverage.
 *
 * ## Why it reads the decorator rather than making a request
 *
 * `Reflect.getMetadata(SUSPENDED_REFUSES_KEY, handler)` is the same lookup the guard performs at
 * request time, so this compares the policy against what the routes actually declare rather than
 * against a second list. No database, no HTTP, four milliseconds.
 *
 * The three clauses this cannot see — search hiding listings, booking creation refusing, and the
 * payout freeze — are enforced in QUERIES rather than by a decorator, and each carries its own
 * assertion elsewhere. They are named in `ELSEWHERE` below so the gap is visible rather than
 * implied.
 */
const ELSEWHERE = {
  'listings leave search':
    "search.service.ts — a NOT EXISTS against partners.suspended_at in the availability CTE, so a suspended partner's inventory is never a candidate.",
  'no new bookings':
    'booking-creation.service.ts — answers UNIT_NOT_FOUND, the same answer an unpublished listing gets, because naming the enforcement to a stranger would let anybody enumerate suspended partners.',
  'payouts frozen':
    'payout.service.ts — checked at RELEASE beside the dispute freeze, because suspension lands between accrual and release in the ordinary case.',
};

/** Handler names that must refuse while suspended, and the policy clause each one serves. */
const MUST_REFUSE: Record<string, readonly [unknown, string]> = {
  createProperty: [PartnerController, 'no new properties'],
  updateProperty: [PartnerController, 'no modifying an existing one'],
  submitForReview: [PartnerController, 'no activating an existing one'],
  addUnit: [PartnerController, 'a unit carries a price'],
  updateUnit: [PartnerController, 'a unit carries a price'],
  updateCalendar: [
    PartnerController,
    'dates and nightly prices are how a listing is offered',
  ],
};

function refuses(controller: unknown, method: string): boolean {
  const handler = (controller as { prototype: Record<string, unknown> }).prototype[
    method
  ];

  if (typeof handler !== 'function') return false;

  return Reflect.getMetadata(SUSPENDED_REFUSES_KEY, handler) === true;
}

describe('what a suspension actually blocks', () => {
  const names = Object.keys(MUST_REFUSE);

  it.each(names)('%s refuses while suspended', (method) => {
    const [controller] = MUST_REFUSE[method] ?? [];

    expect(
      refuses(controller, method),
      `${method} carries no @RefusedWhileSuspended`,
    ).toBe(true);
  });

  /**
   * Every image write too — the whole controller, by walking it rather than by listing methods.
   *
   * Listing them would have the same weakness the guard had: a sixth handler added later is simply
   * not in the list, and nothing says so. Walking the prototype means a new route is covered on the
   * day it is written or fails here.
   */
  it('refuses every write on the images controller', () => {
    /*
      WRITES only, and the distinction comes from Nest's own `method` metadata rather than from a
      list of names I maintain. GET is 0; anything else mutates.

      The first version demanded the marker on every handler and failed on `list`, which is a READ
      and correctly unmarked — the test asking a question the policy does not ask. Reading the verb
      is both more accurate and self-maintaining: a GET added later is exempt automatically and a
      POST is covered automatically, which is exactly the property the hand-written list above does
      not have, and why that list is short while this one is a walk.
    */
    const writes = Object.getOwnPropertyNames(PartnerImagesController.prototype)
      .filter((name) => name !== 'constructor')
      .filter((name) => {
        const handler = (
          PartnerImagesController.prototype as unknown as Record<string, unknown>
        )[name];

        if (typeof handler !== 'function') return false;

        return Reflect.getMetadata('method', handler) !== 0;
      });

    expect(writes.length, 'no write handlers found — the walk is broken').toBeGreaterThan(
      3,
    );
    expect(writes.filter((name) => !refuses(PartnerImagesController, name))).toEqual([]);
  });

  /**
   * The permissive half, and it is the one that keeps this from over-reaching.
   *
   * Bashar's policy is explicit that a suspended partner may sign in, view their account and read
   * the reason. A guard applied to a READ would refuse somebody the thing the policy guarantees
   * them — and a change that marked every route would pass every assertion above perfectly.
   */
  it('does not refuse the reads a suspended partner is entitled to', () => {
    for (const method of ['dashboard', 'profile', 'properties', 'calendar']) {
      const handler = (PartnerController.prototype as unknown as Record<string, unknown>)[
        method
      ];

      if (typeof handler !== 'function') continue;

      expect(refuses(PartnerController, method), `${method} must stay readable`).toBe(
        false,
      );
    }
  });

  /** The three clauses enforced in SQL are named, so the gap is stated rather than assumed. */
  it('names the clauses this test cannot see', () => {
    for (const [clause, where] of Object.entries(ELSEWHERE)) {
      expect(where.length, clause).toBeGreaterThan(60);
    }
  });

  /** The capability behind all of it exists — a route guarded by a constant nobody defined is inert too. */
  it('has the capability the console gates the controls on', () => {
    expect(P.PARTNER_SUSPEND).toBe('partner.suspend');
  });
});
