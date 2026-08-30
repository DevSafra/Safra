import type { ConsoleSection } from '@safra/contracts';

/**
 * Where each console section lives, for the one decision that needs to turn a section into a URL:
 * where to send somebody whose role does not open the dashboard.
 *
 * ## Why this is not read off the sidebar
 *
 * `admin-sidebar.tsx` has hrefs, but it lists TWENTY sections and the map has twenty-three —
 * `payouts`, `reviews` and `emergency` are reachable only from other screens, so a reader sent to
 * one of them by this file would be somewhere the nav cannot describe. They still need an entry:
 * a role carrying only `emergency_mode.activate` opens exactly one section, and «nowhere to send
 * them» is not an answer.
 *
 * It is a second place that knows a path, which is a shape we spent 2026-08-23 removing. The
 * mitigation is a test rather than a promise: `nav-sections.test.ts` should assert that every
 * section the sidebar lists has the same href here, so the two cannot disagree about the twenty
 * they share. Without that this is exactly the drift it looks like.
 */
export const CONSOLE_SECTION_PATHS: Readonly<Record<ConsoleSection, string>> = {
  dashboard: '/',
  bookings: '/bookings',
  partners: '/partners',
  partnerApplications: '/applications',
  properties: '/properties',
  customers: '/customers',
  staff: '/staff',
  staffRoles: '/staff-roles',
  payments: '/payments',
  wallet: '/wallet',
  giftCards: '/giftcards',
  coupons: '/coupons',
  ads: '/ads',
  disputes: '/disputes',
  messages: '/messages',
  whatsapp: '/comms',
  geo: '/geo',
  cityCategories: '/city-categories',
  reports: '/reports',
  settings: '/settings',
  audit: '/audit',
  payouts: '/payouts',
  reviews: '/reviews',
  emergency: '/emergency',
};

/**
 * Where to send a reader who cannot open the dashboard, or `null` if their role opens nothing.
 *
 * `null` is a real answer, not a failure: `sections.test.ts` pins that a legitimate role can open
 * no section at all, so somebody will reach it. It must not become a redirect to `/` — that is the
 * page they were just refused, and a loop.
 *
 * The FIRST openable section, in the map's own order, which is the nav's order. That matters: "the
 * first section they can open" is only a meaningful destination if it is the one they would have
 * reached for themselves.
 */
export function landingPath(sections: readonly string[]): string | null {
  const first = sections[0];

  if (first === undefined) return null;

  return CONSOLE_SECTION_PATHS[first as ConsoleSection] ?? null;
}
