import { ForbiddenException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { PERMISSIONS as P } from '@safra/contracts';
import type { Permission } from '@safra/contracts';
import { describe, expect, it } from 'vitest';

import { PermissionsGuard } from './permissions.guard.js';

/**
 * The guard is constructed directly with a stub Reflector rather than through the
 * Nest container: these are the authorization rules, and they should be testable
 * without booting an application.
 */
function makeContext(permissions: Permission[] | undefined): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => (permissions ? { user: { permissions } } : {}),
    }),
    getHandler: () => () => undefined,
    getClass: () => class {},
  } as unknown as ExecutionContext;
}

function makeGuard(required: Permission[] | undefined): PermissionsGuard {
  const reflector = {
    getAllAndOverride: () => required,
  } as unknown as Reflector;

  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('allows a route that declares no permissions', () => {
    expect(makeGuard(undefined).canActivate(makeContext([]))).toBe(true);
  });

  it('allows when the caller holds the required permission', () => {
    const guard = makeGuard([P.BOOKING_READ_ALL]);
    expect(guard.canActivate(makeContext([P.BOOKING_READ_ALL]))).toBe(true);
  });

  it('denies when the caller is missing the required permission', () => {
    const guard = makeGuard([P.PRICE_UPDATE]);
    expect(() => guard.canActivate(makeContext([P.BOOKING_READ_ALL]))).toThrow(
      ForbiddenException,
    );
  });

  /**
   * The important case: ALL listed permissions are required, not any. An "any"
   * reading would let a support agent through a route needing both read and write.
   */
  it('requires every listed permission, not merely one of them', () => {
    const guard = makeGuard([P.REFUND_CREATE, P.PAYMENT_READ]);
    expect(() => guard.canActivate(makeContext([P.PAYMENT_READ]))).toThrow(
      ForbiddenException,
    );
  });

  it('denies an unauthenticated request to a permissioned route', () => {
    // No user on the request at all — must fail closed, not throw a TypeError.
    const guard = makeGuard([P.BOOKING_READ_ALL]);
    expect(() => guard.canActivate(makeContext(undefined))).toThrow(ForbiddenException);
  });

  it('denies when the caller holds an empty permission set', () => {
    const guard = makeGuard([P.AUDIT_LOG_READ]);
    expect(() => guard.canActivate(makeContext([]))).toThrow(ForbiddenException);
  });
});
