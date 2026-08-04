import { z } from 'zod';

import type { Role } from './permissions.js';

/**
 * Geographic scope for a staff member (design handoff §8.2, نطاق العمل).
 *
 * Bashar's decision, 2026-08-04: scope is an **enforced server-side permission model**, not a UI
 * indicator. A scope that is displayed but not enforced is the worst of both worlds — somebody
 * reads "كرم عبّود · اللاذقية · طرطوس" and believes Karam cannot see a Damascus booking.
 *
 * ## The two modes, and what they mean precisely
 *
 * | Mode | Read outside scope | Write outside scope |
 * | --- | --- | --- |
 * | `none` | The row does not exist. Lists omit it; a detail read returns **404**, never 403. | Refused |
 * | `read_only` | Visible and readable. | Refused |
 *
 * A 403 outside scope would confirm the row exists, which is itself information the member is not
 * scoped to have. So `none` denies by pretending absence, which is the only answer that leaks
 * nothing.
 *
 * Writes are refused in BOTH modes. `read_only` widens READ only; there is no configuration in
 * which a Latakia-scoped agent edits a Damascus booking.
 *
 * ## What is never scoped
 *
 * The **audit log**, explicitly and permanently (Bashar, 2026-08-04): "a scoped audit log is not a
 * trustworthy audit log". Also unscoped by nature: settings, staff administration, geography and
 * currencies, and the platform-wide value instruments (wallet, gift cards, coupons) — none of which
 * belongs to a city. `SCOPED_RESOURCES` below is the authoritative list of what IS scoped.
 */
export const STAFF_SCOPE_KINDS = ['all_cities', 'cities'] as const;
export const OUTSIDE_SCOPE_ACCESS = ['none', 'read_only'] as const;

export type StaffScopeKind = (typeof STAFF_SCOPE_KINDS)[number];
export type OutsideScopeAccess = (typeof OUTSIDE_SCOPE_ACCESS)[number];

export interface StaffScope {
  readonly kind: StaffScopeKind;
  /** City ids, only meaningful when `kind === 'cities'`. Empty otherwise. */
  readonly cityIds: readonly string[];
  readonly outside: OutsideScopeAccess;
}

/** The unrestricted scope. Everybody has this unless somebody narrows them. */
export const UNSCOPED: StaffScope = { kind: 'all_cities', cityIds: [], outside: 'none' };

/**
 * Resources whose rows carry a city and are therefore scoped.
 *
 * Documented as data rather than prose so the enforcement tests can iterate it, and so adding a
 * city-bearing resource without scoping it is a visible omission rather than a silent one.
 */
export const SCOPED_RESOURCES = [
  'bookings',
  'partners',
  'properties',
  'disputes',
  'conversations',
  'ad_campaigns',
  'dashboard',
  'reports',
  'finance',
] as const;

/** Resources that stay global whatever anybody's scope is. */
export const UNSCOPED_RESOURCES = [
  /* Bashar, 2026-08-04: a scoped audit log is not a trustworthy audit log. */
  'audit_log',
  'settings',
  'staff',
  'geo',
  'customers',
  'wallet',
  'gift_cards',
  'coupons',
] as const;

/**
 * Whether this scope restricts anything at all.
 *
 * `all_cities`, and a `cities` scope with an empty list, are both unrestricted. The empty-list case
 * matters: a member switched to `cities` before any city is assigned would otherwise see NOTHING,
 * which reads as a broken console rather than as a configuration that is half-finished.
 */
export function isRestricted(scope: StaffScope): boolean {
  return scope.kind === 'cities' && scope.cityIds.length > 0;
}

/**
 * Whether a scope may WRITE to a row in the given city.
 *
 * `null` means the row has no city — a platform-level record — and is therefore writable by anybody
 * whose permissions allow it. Scope narrows by geography; it cannot narrow what has no geography.
 */
export function canWriteInCity(scope: StaffScope, cityId: string | null): boolean {
  if (!isRestricted(scope)) return true;
  if (cityId === null) return true;

  return scope.cityIds.includes(cityId);
}

/** Whether a scope may READ a row in the given city. */
export function canReadInCity(scope: StaffScope, cityId: string | null): boolean {
  if (!isRestricted(scope)) return true;
  if (cityId === null) return true;
  if (scope.outside === 'read_only') return true;

  return scope.cityIds.includes(cityId);
}

/**
 * A super admin is never scoped.
 *
 * Not a convenience: scoping the only role that can un-scope an account is a lockout waiting to
 * happen, and the person who would have to fix it is the person locked out.
 */
export function isScopable(role: Role): boolean {
  return role !== 'super_admin' && role !== 'customer' && role !== 'partner';
}

export const setStaffScopeSchema = z
  .object({
    kind: z.enum(STAFF_SCOPE_KINDS),
    /** City SLUGS, never ids: a slug is stable, readable in an audit entry, and not enumerable. */
    citySlugs: z.array(z.string().min(1).max(64)).max(50).default([]),
    outside: z.enum(OUTSIDE_SCOPE_ACCESS),
    reason: z.string().trim().max(500).optional(),
  })
  .strict()
  /*
    A `cities` scope with no cities is accepted deliberately — it is how an administrator starts
    building one — but `all_cities` with a city list is a contradiction and is refused, because
    silently ignoring the list would leave somebody believing a restriction is in force.
  */
  .refine((input) => input.kind === 'cities' || input.citySlugs.length === 0, {
    message: 'An all-cities scope cannot carry a city list.',
  });

export type SetStaffScopeInput = z.infer<typeof setStaffScopeSchema>;
