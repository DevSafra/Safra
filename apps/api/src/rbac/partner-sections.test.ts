import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { PARTNER_SECTION_PERMISSIONS, type Permission } from '@safra/contracts';

import { PERMISSIONS_KEY } from './decorators.js';
import { PartnerController } from '../partner/partner.controller.js';
import { PartnerCouponsController } from '../partner/coupons.controller.js';
import { PartnerContractsController } from '../partner/partner-contracts.controller.js';
import { PartnerEmployeeRolesController } from '../partner/partner-employee-roles.controller.js';
import { PartnerEmployeesController } from '../partner/partner-employees.controller.js';
import { PartnerPayoutController } from '../payouts/payout.controller.js';
import { PartnerReviewController } from '../reviews/review.controller.js';

/**
 * The portal's nav map and the API's guards say the same thing.
 *
 * The partner-side twin of `console-sections.test.ts`, and it exists for the reason that file
 * records: four of the console's twenty entries were wrong, written from what a capability's NAME
 * suggests rather than from what the route requires. `PARTNER_SECTION_PERMISSIONS` was written the
 * same way and the same afternoon, so it gets the same proof rather than the benefit of the doubt.
 *
 * A wrong entry breaks the nav in both directions at once: a reader authorised for a screen loses
 * its link, and a reader who is not gets the link and a refusal on arrival — which `partnerFetch`
 * reports as `'unauthenticated'`, so the portal tells somebody with a good session to sign in again.
 *
 * ## Why it reads the decorator
 *
 * `Reflect.getMetadata(PERMISSIONS_KEY, …)` is the SAME lookup `PermissionsGuard` performs. A unit
 * test over the map would compare it to itself, and an e2e run signs in as an owner, who holds
 * every partner capability and therefore cannot see a wrong entry at all.
 */
type Handler = { readonly prototype: object };

/**
 * Section → the handler its page's PRIMARY loader calls.
 *
 * "Primary" is load-bearing, and the portal has the same shape the console does: العقود fetches
 * documents alongside contracts (`partner_document.manage_own`), عقاراتي fetches the form's
 * reference data. A reader missing a SECOND capability must lose that panel and keep the page, so
 * the section opens on what the main view needs.
 *
 * Hand-written because it cannot be derived — the portal fetches over HTTP and nothing links a page
 * to its route — so each row names the loader in `apps/partner/src/lib/api.ts` that proves it.
 *
 * `arrivals` and `violations` have no handler yet; they are excluded below with that stated, rather
 * than silently absent.
 */
const SECTION_HANDLERS: Partial<
  Record<keyof typeof PARTNER_SECTION_PERMISSIONS, readonly [Handler, string, string]>
> = {
  /* section:        [controller, method, the portal loader that calls it] */
  dashboard: [PartnerController, 'dashboard', 'getDashboard'],
  properties: [PartnerController, 'listProperties', 'getMyProperties'],
  calendars: [PartnerController, 'readPortfolioCalendar', 'getPortfolioCalendar'],
  reviews: [PartnerReviewController, 'list', 'getMyReviews'],
  payouts: [PartnerPayoutController, 'list', 'getMyPayouts'],
  contracts: [PartnerContractsController, 'list', 'getMyContracts'],
  coupons: [PartnerCouponsController, 'list', 'getMyCoupons'],
  employees: [PartnerEmployeesController, 'list', 'getMyEmployees'],
  employeeRoles: [PartnerEmployeeRolesController, 'list', 'getMyEmployeeRoles'],
};

/**
 * Sections whose feature does not exist yet, and why each is absent rather than wrong.
 *
 * Listed rather than omitted: a section quietly missing from `SECTION_HANDLERS` is indistinguishable
 * from one somebody forgot, and the coverage assertion below is what makes the difference visible.
 */
const NOT_BUILT_YET: readonly (keyof typeof PARTNER_SECTION_PERMISSIONS)[] = [
  /* `booking.check_in` — the arrivals screen a receptionist admits a guest from. */
  'arrivals',
  /* `violation.read` — a partner reading the fines against their own account. */
  'violations',
];

/** Exactly what `PermissionsGuard` reads, by the same key, off the same handler. */
function guardOf(controller: Handler, method: string): Permission[] | undefined {
  const handler = (controller.prototype as Record<string, unknown>)[method];

  if (typeof handler !== 'function') return undefined;

  return Reflect.getMetadata(PERMISSIONS_KEY, handler) as Permission[] | undefined;
}

describe('every portal section opens on the capability its route requires', () => {
  const built = Object.keys(SECTION_HANDLERS) as (keyof typeof SECTION_HANDLERS)[];

  it.each(built)('%s', (section) => {
    const entry = SECTION_HANDLERS[section];

    expect(entry, `${section} has no handler row`).toBeDefined();

    const [controller, method] = entry!;
    const required = guardOf(controller, method);

    expect(required, `${method} carries no @RequirePermissions`).toBeDefined();
    expect(required).toEqual([PARTNER_SECTION_PERMISSIONS[section]]);
  });

  /**
   * Every section is accounted for — mapped to a handler, or named as not built.
   *
   * Without this, adding a section to the shared map and not to this file would simply mean the new
   * section is never tested, which is the silent-coverage failure the console twin also guards.
   */
  it('accounts for every section in the map, with nothing left over', () => {
    expect([...built, ...NOT_BUILT_YET].sort()).toEqual(
      Object.keys(PARTNER_SECTION_PERMISSIONS).sort(),
    );
  });

  /**
   * A section names ONE capability.
   *
   * Two would mean the nav offers a link the reader can only half use, and the map has no way to
   * say "and also" — so the second requirement would be invisible until somebody was refused.
   */
  it('never names a route that requires two capabilities at once', () => {
    for (const section of built) {
      const [controller, method] = SECTION_HANDLERS[section]!;

      expect(guardOf(controller, method), section).toHaveLength(1);
    }
  });
});
