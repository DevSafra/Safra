import { PERMISSIONS as P, type Permission } from './permissions.js';

/**
 * The five domains a permission belongs to, for any screen that offers a LIST of them
 * (Bashar, 2026-08-23).
 *
 * ## Why this exists
 *
 * The staff-role form offers 63 checkboxes. Sixty-three of anything in a flat column is not a
 * form — it is a wall somebody scrolls past — and the person using it is naming a job («مشرف
 * حجوزات») and deciding what that job may touch. They think in areas of the business, so the
 * screen has to.
 *
 * ## Why not the `resource.action` prefix
 *
 * That was the obvious answer and it is wrong, measured rather than assumed: 63 permissions carry
 * **31 distinct prefixes**. Grouping by prefix produces 31 groups of one to eight items, which is
 * the same flat list with 31 headings added to it. It also derives from the string and so cannot
 * drift, which is genuinely attractive — but a grouping that does not group is worse than none.
 *
 * ## Where the five come from
 *
 * They are not invented here. `permissions.ts` is already sectioned by them in its own comments —
 * Bookings, Money, Partners & inventory, Customers & support, Platform — written by whoever built
 * that file. This turns that existing taxonomy into data so two screens can read it.
 *
 * ## Why in contracts rather than in the console
 *
 * Two consoles need the same answer. The staff-role screen groups all 63; the partner-employee
 * role screen groups the eleven-strong subset. Two hand-written maps would drift, and the one that
 * drifted would be the screen quietly filing a permission under the wrong heading — which nobody
 * would notice, because a checkbox in the wrong group still works.
 */
export const PERMISSION_GROUPS = [
  'bookings',
  'money',
  'partners',
  'customers',
  'platform',
  /**
   * Anything unmapped, and it is deliberately LAST and deliberately visible.
   *
   * A permission whose prefix nobody has categorised must still be offered — dropping it would
   * make a capability that the API accepts unreachable from the only screen that grants it, and
   * the failure would be silent because an absent checkbox looks like a shorter list. Landing in
   * «أخرى» is conspicuous enough that somebody categorises it.
   */
  'other',
] as const;

export type PermissionGroup = (typeof PERMISSION_GROUPS)[number];

/**
 * Which domain each `resource` prefix belongs to.
 *
 * Keyed on the prefix rather than on the whole permission, so a new action on an existing resource
 * — `booking.reinstate`, say — is grouped correctly the day it is added with no edit here. Only a
 * new RESOURCE needs a line, and until it gets one it shows under «أخرى» rather than vanishing.
 */
const GROUP_OF_PREFIX: Readonly<Record<string, PermissionGroup>> = {
  booking: 'bookings',
  calendar: 'bookings',

  payment: 'money',
  refund: 'money',
  ledger: 'money',
  payout: 'money',
  payout_account: 'money',
  wallet: 'money',
  gift_card: 'money',
  coupon: 'money',
  price: 'money',
  fx_rate: 'money',
  /* SAFRA's own destinations and revenue transfers — money, not platform settings. */
  safra_payout: 'money',

  partner: 'partners',
  partner_application: 'partners',
  partner_contract: 'partners',
  partner_coupon: 'partners',
  partner_document: 'partners',
  partner_employee: 'partners',
  partner_employee_role: 'partners',
  property: 'partners',
  violation: 'partners',

  customer: 'customers',
  message: 'customers',
  dispute: 'customers',
  review: 'customers',
  notification: 'customers',

  settings: 'platform',
  geo: 'platform',
  /* كتالوج المنصّة — amenities, cancellation policies, partner types. */
  catalogue: 'platform',
  ad: 'platform',
  report: 'platform',
  audit_log: 'platform',
  emergency_mode: 'platform',
  staff: 'platform',
  staff_role: 'platform',
  rbac: 'platform',
};

/** The domain a permission belongs to. Unmapped resources fall into «أخرى», never nowhere. */
export function permissionGroup(permission: string): PermissionGroup {
  return GROUP_OF_PREFIX[permission.split('.')[0] ?? ''] ?? 'other';
}

/**
 * Splits a flat list into the five domains, in `PERMISSION_GROUPS` order.
 *
 * Empty groups are omitted, so the eleven-permission partner-employee list renders three headings
 * rather than five with two blanks. The ORDER is fixed rather than alphabetical: it is the order
 * `permissions.ts` uses, which puts the everyday areas before the platform ones.
 */
export function groupPermissions(
  permissions: readonly string[],
): readonly { group: PermissionGroup; permissions: readonly string[] }[] {
  return PERMISSION_GROUPS.map((group) => ({
    group,
    permissions: permissions.filter((p) => permissionGroup(p) === group),
  })).filter((entry) => entry.permissions.length > 0);
}

/**
 * Every prefix appearing in `PERMISSIONS`, for the test that keeps this map honest.
 *
 * Exported rather than computed in the test so the two cannot disagree about what "every prefix"
 * means.
 */
export function permissionPrefixes(): readonly string[] {
  return [
    ...new Set(Object.values(P).map((p: Permission) => p.split('.')[0] ?? '')),
  ].sort();
}
