import { ForbiddenException } from '@nestjs/common';

import { PERMISSIONS as P } from '@safra/contracts';
import type { Permission } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Resource-level authorization.
 *
 * A permission answers "may this role read bookings at all?". It cannot answer
 * "may this customer read THIS booking?" — and that second question is the one
 * that leaks data. `booking.read_own` granted without an ownership filter is
 * indistinguishable from `booking.read_all` at the database level.
 *
 * So every scoped query resolves an AccessScope first, and the scope becomes part
 * of the SQL WHERE clause. There is no code path that reads a booking without
 * passing through here.
 */
export type AccessScope =
  | { kind: 'all' }
  | {
      kind: 'own';
      customerProfileId?: string | undefined;
      partnerId?: string | undefined;
    }
  | { kind: 'none' };

/**
 * Resolves what slice of a resource the caller may see.
 *
 * The `all` permission is checked FIRST and wins, so staff are never narrowed by
 * also happening to hold an `own` permission.
 *
 * The important branch is the last one in the `own` case: if the caller holds an
 * `own` permission but carries no owning id in their token, the result is `none`,
 * not `all`. Failing closed here is what stops a malformed or legacy token from
 * silently escalating into full access.
 */
export function resolveScope(
  claims: AccessTokenClaims | undefined,
  permissions: { all: Permission; own: Permission },
): AccessScope {
  if (!claims) {
    return { kind: 'none' };
  }

  const granted = claims.permissions ?? [];

  if (granted.includes(permissions.all)) {
    return { kind: 'all' };
  }

  if (granted.includes(permissions.own)) {
    const { customerProfileId, partnerId } = claims;

    if (!customerProfileId && !partnerId) {
      return { kind: 'none' };
    }

    return { kind: 'own', customerProfileId, partnerId };
  }

  return { kind: 'none' };
}

export function resolveBookingScope(claims: AccessTokenClaims | undefined): AccessScope {
  return resolveScope(claims, {
    all: P.BOOKING_READ_ALL,
    own: P.BOOKING_READ_OWN,
  });
}

/**
 * The caller's own partner id, for write paths that only ever act on the partner's
 * own inventory.
 *
 * Separate from resolveScope because a WRITE has no meaningful "all" variant here:
 * staff do not edit partner listings on their behalf (§8.3 gives the partner the
 * dashboard; §4 gives staff approval rights, not authoring rights). So this either
 * returns the partner's id or refuses — there is no branch that widens.
 */
export function requirePartnerId(
  claims: AccessTokenClaims | undefined,
  permission: Permission,
): string {
  if (!claims) {
    throw new ForbiddenException('Authentication required.');
  }

  if (!(claims.permissions ?? []).includes(permission)) {
    throw new ForbiddenException(`Missing required permission: ${permission}.`);
  }

  if (!claims.partnerId) {
    // A partner-role token without a partner record is a data problem, not an
    // authorization one — but it still must not fall through to an unscoped write.
    throw new ForbiddenException('This account is not linked to a partner profile.');
  }

  return claims.partnerId;
}

/**
 * Converts a `none` scope into a 403 at the single point where scope is consumed,
 * so no caller can forget the check and fall through to an unfiltered query.
 */
export function assertReadable(
  scope: AccessScope,
): Exclude<AccessScope, { kind: 'none' }> {
  if (scope.kind === 'none') {
    throw new ForbiddenException('You do not have access to this resource.');
  }

  return scope;
}
