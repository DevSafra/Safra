import { z } from 'zod';

import { passwordSchema } from './auth.js';
import { PERMISSIONS as P, type Permission } from './permissions.js';

/**
 * Partner employees, and the roles a super admin names for them (Bashar, 2026-08-23).
 *
 * A partner is an organisation, not a person. A hotel has a receptionist who takes bookings, a
 * housekeeper who closes rooms, an accountant who reads payouts — and until now all of them shared
 * one login, because the platform had exactly one account per partner. Sharing a password is how a
 * partner ends up with no idea who cancelled a booking.
 *
 * ## The roles are GLOBAL and the super admin names them
 *
 * Bashar's wording: "the super admin should have a page where he can define the employee roles
 * himself and name them". So a role is defined once, centrally, and every partner assigns from that
 * list. Partners do not invent roles — which is also what keeps the permission surface reviewable:
 * one list of roles to audit rather than one per partner.
 */

/**
 * The ONLY permissions a partner-employee role may carry.
 *
 * ## This is the security boundary of the whole feature
 *
 * A role is named and granted by a super admin, and a super admin holds every permission in the
 * platform. Without this list, "define a role and name it" would be a route to granting
 * `PAYOUT_EXECUTE`, `SETTINGS_UPDATE` or `WALLET_ADJUST` to an employee of a third-party business —
 * a privilege escalation with a friendly form in front of it.
 *
 * So the list is a subset of what a PARTNER itself can do. An employee can never exceed their
 * employer, and the employer can never exceed what the platform grants a partner. Anything not
 * named here is unreachable no matter what a role row says, because the API intersects a role's
 * permissions with this list on every read — a row written before this list shrank cannot grant
 * something the list no longer contains.
 *
 * ## What is deliberately NOT here, and why
 *
 * - `PAYOUT_READ_OWN` — a partner's money. A receptionist should not learn what the business earns;
 *   an owner who wants that for an accountant can ask for it explicitly and it can be added, but
 *   the default must not leak revenue to everyone with a login.
 * - `PARTNER_CONTRACT_SIGN_OWN` — signing and reading the partnership agreement. A member of staff
 *   at a hotel must not be able to bind the hotel.
 * - `PARTNER_DOCUMENT_MANAGE_OWN` — the owner's verification documents, including their identity
 *   papers. REMOVED on 2026-08-31 with المستندات itself (Bashar); it is named here because the
 *   correction below is about it, and a lesson that loses its subject stops teaching anything.
 *
 * ## A correction worth keeping, because the original was worse than wrong
 *
 * This list previously claimed to withhold `PARTNER_CONTRACT_READ` on the grounds that "the
 * agreement is between the platform and the OWNER". That sentence described a control that did not
 * exist: `PARTNER_CONTRACT_READ` is a STAFF permission, held by `operations_manager` and
 * `support_agent` and never by `partner` — so withholding it from employees withheld nothing, and
 * no partner-side route could have been guarded by it without locking the owner out.
 *
 * The six routes that actually mattered — three contract, three document (the latter retired with
 * المستندات in August 2026) — were guarded by
 * `PROPERTY_MANAGE_OWN`, which employees DO hold because managing listings is the job. So a
 * receptionist could counter-sign their employer's contract with SAFRA, file verification
 * documents in the owner's name, and download the owner's identity documents. Every test passed;
 * the docblock read like a boundary and was prose.
 *
 * The two permissions above are the boundary. `employee-reach.test.ts` reads route metadata and
 * asks, per handler, whether this set satisfies it — so the claim is now checked rather than
 * asserted, for every route on those controllers and any added later.
 */
export const PARTNER_EMPLOYEE_PERMISSIONS = [
  P.BOOKING_READ_OWN,
  P.BOOKING_RESPOND_AS_PARTNER,
  P.BOOKING_CHECK_IN,
  P.CALENDAR_MANAGE_OWN,
  P.PROPERTY_MANAGE_OWN,
  P.PRICE_UPDATE,
  P.MESSAGE_READ,
  P.MESSAGE_SEND,
  P.REVIEW_READ_OWN,
  P.REVIEW_RESPOND_OWN,
  P.VIOLATION_READ,
] as const satisfies readonly Permission[];

/** True when a permission may appear on a partner-employee role at all. */
export function isEmployeePermission(value: string): value is Permission {
  return (PARTNER_EMPLOYEE_PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Narrows a stored role to what it is allowed to grant TODAY.
 *
 * Applied on every read rather than only on write. A role row is data, and data outlives the rule
 * that let it in: shrinking `PARTNER_EMPLOYEE_PERMISSIONS` has to revoke, not merely stop granting.
 * Intersecting here means a permission removed from the list is gone from every existing role the
 * moment the code ships, with no migration and no row to miss.
 */
export function employeePermissions(stored: readonly string[]): Permission[] {
  return stored.filter(isEmployeePermission);
}

/** A role's name, as an operator types it. Trimmed, bounded, and never blank. */
const roleName = z
  .string()
  .trim()
  .min(2, 'validation.too_short')
  .max(60, 'validation.too_long');

export const employeeRoleCreateSchema = z.object({
  name: roleName,
  /*
    Unknown values are REJECTED rather than filtered. A caller that sends a permission outside the
    list has misunderstood something, and silently storing the subset would leave a super admin
    believing they granted a capability the API dropped without a word.
  */
  permissions: z
    .array(z.string().refine(isEmployeePermission, 'validation.unknown_permission'))
    .min(1, 'validation.required')
    .max(PARTNER_EMPLOYEE_PERMISSIONS.length),
});

export type EmployeeRoleCreateInput = z.infer<typeof employeeRoleCreateSchema>;

export const employeeRoleUpdateSchema = employeeRoleCreateSchema;

/** Inviting an employee: an address and a role, and nothing that names a partner. */
export const employeeInviteSchema = z.object({
  email: z.string().trim().toLowerCase().email('validation.email'),
  fullName: z
    .string()
    .trim()
    .min(2, 'validation.too_short')
    .max(120, 'validation.too_long'),
  roleId: z.string().uuid('validation.uuid'),
});

export type EmployeeInviteInput = z.infer<typeof employeeInviteSchema>;

/** Changing an existing employee: their role, or whether they may sign in at all. */
export const employeeUpdateSchema = z.object({
  roleId: z.string().uuid('validation.uuid').optional(),
  status: z.enum(['active', 'suspended']).optional(),
});

export type EmployeeUpdateInput = z.infer<typeof employeeUpdateSchema>;

/** Activating an invited employee's account: the link's token and the password they choose. */
export const employeeInvitationAcceptSchema = z.object({
  token: z.string().min(20).max(512),
  password: passwordSchema,
});

export type EmployeeInvitationAcceptInput = z.infer<
  typeof employeeInvitationAcceptSchema
>;
