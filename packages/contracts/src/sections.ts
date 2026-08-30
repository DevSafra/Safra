import { PERMISSIONS as P, type Permission } from './permissions.js';

/**
 * Which capability opens which section, in both apps (Bashar, 2026-08-23).
 *
 * ## What this is for
 *
 * *"On the dashboard he should be able to see everything of his given role."* Neither app gated its
 * navigation by permission — a staff member with a three-capability role saw all twenty console
 * links, and an employee saw the partner portal's nine. The API refused them on arrival, so the UI
 * offered what the server would not give: the hidden-control-versus-refused-request problem at
 * platform scale, and the reason `partnerFetch` reporting a 403 as «انتهت الجلسة» sent people to
 * sign in again over and over.
 *
 * ## One map, read by both apps
 *
 * Written twice it would drift, and the drift would be invisible — a section whose nav entry and
 * page guard disagree either hides something a reader may use or offers something they may not.
 * Every drift bug found today is two lists written separately.
 *
 * ## A section names ONE capability, deliberately
 *
 * Not a set. "Which capability opens this door" has one answer, and a section requiring two is
 * really two sections. Where a screen shows more with a second capability, that is an IN-PAGE
 * control and this map is the wrong place for it — see `canOpenSection`'s note.
 */

/**
 * The console's sections, keyed as `admin-sidebar.tsx` keys them.
 *
 * **Every entry is the capability the section's own endpoint ACTUALLY requires**, read off the
 * `@RequirePermissions` decorator — not the one the capability's name suggests. Four of these
 * twenty were written from the name and were wrong:
 *
 * | section | written | the guard |
 * |---|---|---|
 * | `dashboard` | `report.read` | `booking.read_all` — `admin.controller.ts` |
 * | `payments` | `payment.read` | `ledger.read` — الدفع is a LEDGER view; `registries.controller.ts` |
 * | `whatsapp` | `message.read` | `notification.read` — `/comms` reads notifications, not threads |
 * | `geo` | `geo.manage` | `settings.read` — reading the lists is a settings read |
 *
 * Each one breaks the nav in BOTH directions at once: the reader authorised for the screen loses
 * the link, and a reader who is not gets the link and a 403 — the hidden-control-versus-refused-
 * request problem, recreated by the fix for it. `payments` was caught by review; the other three by
 * checking all twenty the same way afterwards, which is the only reason to trust the remaining
 * sixteen.
 *
 * `console-sections.test.ts` in the API holds this to account against the running guard, so the next
 * time somebody re-guards a route the map fails rather than starts lying — and its key-set
 * assertion is what would now catch a section added to one and not the other.
 *
 * **Three sections were missing outright** — `payouts`, `reviews`, `emergency` — found on
 * 2026-08-24. The four wrong entries were caught by checking each one; the three absent ones were
 * caught by asking a different question: which PAGE has no key at all. A map is wrong in two ways
 * and only one of them is visible from inside it.
 */
export const CONSOLE_SECTION_PERMISSIONS = {
  dashboard: P.BOOKING_READ_ALL,
  bookings: P.BOOKING_READ_ALL,
  partners: P.PARTNER_READ,
  /*
    `partnerApplications`, matching the sidebar's key exactly (project-e9, 2026-08-24).

    It was `applications`, and the sidebar has always called it `partnerApplications`. Nothing
    failed: `canOpenSection` answers false for anything unmapped, so filtering the nav on
    `item.key` would simply have removed طلبات الشراكة from the console for EVERY reader, super
    admins included, with no error and no log line. The symptom reads as a rendering bug.

    Same shape as the three sections that were missing outright, and it survived the same way — a
    check that reads two lists across two files and finds them "the same" is not a diff.
    `nav-sections.test.ts` is now the diff.
  */
  partnerApplications: P.PARTNER_APPLICATION_READ,
  properties: P.PROPERTY_READ,
  customers: P.CUSTOMER_READ,
  staff: P.STAFF_MANAGE,
  staffRoles: P.STAFF_ROLE_MANAGE,
  payments: P.LEDGER_READ,
  wallet: P.WALLET_READ,
  giftCards: P.GIFT_CARD_READ,
  coupons: P.COUPON_READ,
  ads: P.AD_READ,
  disputes: P.DISPUTE_READ,
  messages: P.MESSAGE_READ,
  whatsapp: P.NOTIFICATION_READ,
  geo: P.SETTINGS_READ,
  /* الفئات — the same authority as المدن: reading which categories exist is reading geography. */
  cityCategories: P.SETTINGS_READ,
  reports: P.REPORT_READ,
  settings: P.SETTINGS_READ,
  audit: P.AUDIT_LOG_READ,
  /*
    Three sections that were MISSING from this map entirely until 2026-08-24, found by project-cc
    when they asked which console page a naive loop over the map would leave behind.

    Absence is worse than a wrong entry here, and quieter. A wrong capability shows up as a reader
    who cannot open a screen they are entitled to; a missing KEY is a page `sectionAccess` cannot
    even be CALLED for — `canOpenSection` answers false for anything unmapped, which is the safe
    direction and is exactly why nothing complained. A loop over twenty keys gates twenty pages and
    reports complete.

    `emergency` is the sharpest of the three: Emergency Mode is the most dangerous screen in the
    console, and it was the one with nowhere to hang a gate.
  */
  payouts: P.PAYOUT_READ,
  reviews: P.REVIEW_MODERATE,
  emergency: P.EMERGENCY_MODE_ACTIVATE,
} as const satisfies Record<string, Permission>;

export type ConsoleSection = keyof typeof CONSOLE_SECTION_PERMISSIONS;

/**
 * The partner portal's sections.
 *
 * `support` is absent on purpose: it is open to every authenticated partner-side reader, owner and
 * employee alike, because somebody who cannot reach any other section must still be able to ask for
 * help. A portal that can lock a person out of the way to report being locked out is worse than one
 * that shows a support form to somebody who has nothing else.
 */
export const PARTNER_SECTION_PERMISSIONS = {
  dashboard: P.BOOKING_READ_OWN,
  properties: P.PROPERTY_MANAGE_OWN,
  calendars: P.CALENDAR_MANAGE_OWN,
  reviews: P.REVIEW_READ_OWN,
  arrivals: P.BOOKING_CHECK_IN,
  violations: P.VIOLATION_READ,
  payouts: P.PAYOUT_READ_OWN,
  contracts: P.PARTNER_CONTRACT_SIGN_OWN,
  employees: P.PARTNER_EMPLOYEE_MANAGE,
  employeeRoles: P.PARTNER_EMPLOYEE_MANAGE,
} as const satisfies Record<string, Permission>;

export type PartnerSection = keyof typeof PARTNER_SECTION_PERMISSIONS;

/**
 * May this reader open this section?
 *
 * ## It answers the door, not what is behind it
 *
 * A section opens on ONE capability. What a reader may DO inside it — accept a booking, reply to a
 * review, change a price — is a separate question with a separate answer, and by count it is the
 * bigger one: of the eleven capabilities a partner can grant, only six open a section and the rest
 * govern in-page controls. Gating the nav and leaving the buttons is the same defect one level
 * down, so call `has()` for those rather than reaching for this.
 *
 * ## Unknown sections are CLOSED
 *
 * A section missing from the map answers false rather than true. A new screen added without an
 * entry is then invisible until somebody maps it, which is a bug somebody notices; the opposite
 * default is a screen silently open to everyone, which is a bug nobody notices.
 */
export function canOpenSection(
  permissions: readonly string[] | undefined,
  map: Record<string, Permission>,
  section: string,
): boolean {
  const required = map[section];

  if (required === undefined) return false;

  return (permissions ?? []).includes(required);
}

/** Whether a reader holds a capability at all — for the in-page controls a section map cannot cover. */
export function has(
  permissions: readonly string[] | undefined,
  permission: Permission,
): boolean {
  return (permissions ?? []).includes(permission);
}

/**
 * The sections this reader can open, in the order the map declares them.
 *
 * The order is load-bearing: a reader who opens no section at all, and one whose only section is
 * the fourth, are both cases the navigation has to handle deliberately rather than by landing them
 * on a dashboard they cannot read.
 */
export function openableSections(
  permissions: readonly string[] | undefined,
  map: Record<string, Permission>,
): string[] {
  return Object.keys(map).filter((section) => canOpenSection(permissions, map, section));
}
