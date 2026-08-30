import 'reflect-metadata';

import { describe, expect, it } from 'vitest';

import { CONSOLE_SECTION_PERMISSIONS, type Permission } from '@safra/contracts';

import { AdminController } from '../admin/admin.controller.js';
import { AdminOperationsController } from '../admin/operations.controller.js';
import { AdminPayoutController } from '../payouts/payout.controller.js';
import { AdminReviewController } from '../reviews/review.controller.js';
import { AdminPartnerApplicationController } from '../partner/partner-application.controller.js';
import { CommsController } from '../admin/comms.controller.js';
import { PERMISSIONS_KEY } from './decorators.js';
import { RegistriesController } from '../admin/registries.controller.js';
import { StaffController } from '../admin/staff.controller.js';
import { StaffRolesController } from '../admin/staff-roles.controller.js';

/**
 * The nav's map and the API's guards say the same thing.
 *
 * ## Why this test exists
 *
 * `CONSOLE_SECTION_PERMISSIONS` decides which links a staff member SEES; `@RequirePermissions`
 * decides which requests the API ANSWERS. Two lists written separately, and when they disagree the
 * nav breaks in both directions at once — the reader authorised for a screen loses its link, and a
 * reader who is not gets the link and a 403.
 *
 * Written from the capability NAMES, four of the twenty were wrong: `dashboard`, `payments`,
 * `whatsapp` and `geo`. Nothing would have caught them. A unit test over the map compares it to
 * itself, and an e2e run signs in as a super admin, who holds everything.
 *
 * ## Why it reads the decorator rather than a list of endpoints
 *
 * `Reflect.getMetadata(PERMISSIONS_KEY, …)` is the SAME lookup `PermissionsGuard` performs — it
 * reads what the route actually requires, not a second copy of it. Re-guard a route and this fails
 * on the next run, which is the day the nav would otherwise start lying.
 *
 * The one hand-written thing left is which handler serves which section, below. That cannot be
 * derived — the console fetches over HTTP and nothing links a page to its route — so it is written
 * down with the loader that proves it.
 */
type Handler = { readonly prototype: object };

/**
 * Section → the handler its page's PRIMARY loader calls.
 *
 * "Primary" is load-bearing. Several pages make a second call that needs a different capability —
 * `/properties` also fetches the approval queue (`P.PROPERTY_APPROVE`), `/partners` and the
 * dashboard also fetch pending partners, `/staff` also fetches the roles catalogue. Those are
 * rendered as `pending === 'unauthenticated' ? null : …`, so a reader without the second capability
 * loses the panel and keeps the page. The section opens on what the MAIN table needs.
 */
const SECTION_HANDLERS: Record<
  keyof typeof CONSOLE_SECTION_PERMISSIONS,
  readonly [Handler, string, string]
> = {
  /* section:      [controller, method, the console loader that calls it] */
  dashboard: [AdminController, 'dashboardOverview', 'getDashboard'],
  bookings: [RegistriesController, 'listBookings', 'getBookings'],
  partners: [RegistriesController, 'listPartners', 'getPartnerRegistry'],
  partnerApplications: [
    AdminPartnerApplicationController,
    'list',
    'getPartnerApplications',
  ],
  properties: [RegistriesController, 'listProperties', 'getPropertyRegistry'],
  customers: [RegistriesController, 'listCustomers', 'getCustomers'],
  staff: [StaffController, 'list', 'getStaff'],
  staffRoles: [StaffRolesController, 'list', 'getStaffRoles'],
  payments: [RegistriesController, 'finances', 'getFinance'],
  wallet: [RegistriesController, 'walletTransactions', 'getWalletTransactions'],
  giftCards: [RegistriesController, 'giftCards', 'getGiftCards'],
  coupons: [RegistriesController, 'coupons', 'getCoupons'],
  ads: [CommsController, 'listCampaigns', 'getCampaigns'],
  disputes: [CommsController, 'listDisputes', 'getDisputes'],
  messages: [CommsController, 'listConversations', 'getConversations'],
  whatsapp: [CommsController, 'listNotifications', 'getNotifications'],
  geo: [RegistriesController, 'geography', 'getGeography'],
  cityCategories: [RegistriesController, 'cityCategories', 'getCityCategories'],
  reports: [RegistriesController, 'reportCards', 'getReports'],
  settings: [AdminOperationsController, 'listSettings', 'getSettings'],
  audit: [AdminOperationsController, 'auditLog', 'getAuditLog'],
  /*
    The three that were missing from the map until 2026-08-24. Their absence is why the key-set
    assertion below exists — it is what failed when they were added here, and it is the only thing
    that would have noticed a section mapped and never checked.
  */
  payouts: [AdminPayoutController, 'list', 'getPayoutRegistry'],
  reviews: [AdminReviewController, 'reported', 'getReportedReviews'],
  emergency: [RegistriesController, 'emergencyState', 'getEmergency'],
};

/** Exactly what `PermissionsGuard` reads, by the same key, off the same handler. */
function guardOf(controller: Handler, method: string): Permission[] | undefined {
  const handler = (controller.prototype as Record<string, unknown>)[method];

  if (typeof handler !== 'function') return undefined;

  return Reflect.getMetadata(PERMISSIONS_KEY, handler) as Permission[] | undefined;
}

describe('every console section opens on the capability its route requires', () => {
  const sections = Object.keys(SECTION_HANDLERS) as (keyof typeof SECTION_HANDLERS)[];

  it.each(sections)('%s', (section) => {
    const [controller, method] = SECTION_HANDLERS[section];
    const required = guardOf(controller, method);

    expect(required, `${method} carries no @RequirePermissions`).toBeDefined();
    expect(required).toEqual([CONSOLE_SECTION_PERMISSIONS[section]]);
  });

  /**
   * Every section is covered, and this is the assertion that keeps it that way.
   *
   * `it.each` over the handler map would pass silently if a section were added to the section map
   * and not to this file — the new section simply would not be tested. Comparing the KEY SETS makes
   * that a failure.
   */
  it('covers every section in the map, with nothing left over', () => {
    expect(Object.keys(SECTION_HANDLERS).sort()).toEqual(
      Object.keys(CONSOLE_SECTION_PERMISSIONS).sort(),
    );
  });

  /**
   * A section names ONE capability. Two would mean the nav shows a link the reader can only half
   * use, and the map has no way to express "and also".
   */
  it('never names a route that requires two capabilities at once', () => {
    for (const section of sections) {
      const [controller, method] = SECTION_HANDLERS[section];

      expect(guardOf(controller, method), section).toHaveLength(1);
    }
  });
});
