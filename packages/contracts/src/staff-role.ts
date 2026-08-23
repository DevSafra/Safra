import { z } from 'zod';

import { PERMISSIONS as P, type Permission } from './permissions.js';

/**
 * The roles a super admin names for SAFRA's OWN employees (Bashar, 2026-08-23).
 *
 * "Also for super admin dashboard do the same for its own employees." So the console gets the same
 * pair the partner portal has: a screen to invite the people who work here, and a screen to define
 * what the jobs they hold are called and can do.
 *
 * ## Why this is not more enum values
 *
 * `user_role` has four staff values with hard-coded permission sets. Bashar wants to INVENT roles —
 * «مشرف حجوزات», «محاسب» — and an enum cannot do that: adding a value is a migration and Postgres
 * cannot remove one at all. So `users.role` keeps only the two jobs it is still good at, admission
 * and the second factor, and `users.staff_role_id` carries what the person may actually do.
 */

/**
 * The one permission a named staff role may NEVER carry.
 *
 * A role that can define roles can grant itself everything: «مشرف حجوزات» ticks "manage staff
 * roles", edits its own row, and is a super admin one save later. Excluding it is the whole
 * boundary — exactly the argument for `PARTNER_EMPLOYEE_MANAGE` being absent from what a partner's
 * employee may hold.
 *
 * `EMERGENCY_MODE_ACTIVATE` is deliberately NOT excluded. It is dangerous, but it is an operational
 * power a super admin may legitimately want to delegate to somebody who works nights — and unlike
 * role management it cannot be used to acquire anything else. Dangerous and escalating are
 * different, and only the second has to be structurally impossible.
 */
export const STAFF_ROLE_FORBIDDEN: Permission[] = [P.STAFF_ROLE_MANAGE];

/** Everything a named staff role may be given. */
export const STAFF_ASSIGNABLE_PERMISSIONS: Permission[] = Object.values(P).filter(
  (permission) => !STAFF_ROLE_FORBIDDEN.includes(permission),
);

export function isStaffAssignablePermission(value: string): value is Permission {
  return (STAFF_ASSIGNABLE_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Narrows a stored role to what it may grant TODAY.
 *
 * Applied on every READ, not only on write — the same reasoning as `employeePermissions`. A row is
 * data and outlives the rule that admitted it, so shrinking the forbidden list has to REVOKE from
 * roles already stored rather than merely stop new ones. Without this, a permission withdrawn from
 * the platform keeps working for every role that captured it first.
 */
export function staffRolePermissions(stored: readonly string[]): Permission[] {
  return stored.filter(isStaffAssignablePermission);
}

const roleName = z
  .string()
  .trim()
  .min(2, 'validation.too_short')
  .max(60, 'validation.too_long');

export const staffRoleCreateSchema = z.object({
  name: roleName,
  /*
    Unknown or forbidden values are REJECTED rather than filtered. Silently storing the subset would
    leave a super admin believing they granted something the API dropped without a word — and the
    one value that can be dropped here is the one that would have been an escalation.
  */
  permissions: z
    .array(
      z.string().refine(isStaffAssignablePermission, 'validation.unknown_permission'),
    )
    .min(1, 'validation.required'),
});

export type StaffRoleCreateInput = z.infer<typeof staffRoleCreateSchema>;

/** Assigning a named role to a staff member. */
export const staffRoleAssignSchema = z.object({
  staffRoleId: z.string().uuid('validation.uuid'),
});

export type StaffRoleAssignInput = z.infer<typeof staffRoleAssignSchema>;
