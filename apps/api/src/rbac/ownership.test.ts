import { ForbiddenException } from '@nestjs/common';
import { PERMISSIONS as P, ROLE_PERMISSIONS, resolvePermissions } from '@safra/contracts';
import { describe, expect, it } from 'vitest';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { assertReadable, resolveBookingScope } from './ownership.js';

function claims(overrides: Partial<AccessTokenClaims>): AccessTokenClaims {
  return {
    sub: 'user-1',
    role: 'customer',
    permissions: [],
    locale: 'ar',
    ...overrides,
  };
}

describe('resolveBookingScope', () => {
  it('gives staff with read_all an unrestricted scope', () => {
    const scope = resolveBookingScope(
      claims({ role: 'support_agent', permissions: [P.BOOKING_READ_ALL] }),
    );
    expect(scope).toEqual({ kind: 'all' });
  });

  it('scopes a customer to their own profile', () => {
    const scope = resolveBookingScope(
      claims({ permissions: [P.BOOKING_READ_OWN], customerProfileId: 'cus-1' }),
    );
    expect(scope).toEqual({
      kind: 'own',
      customerProfileId: 'cus-1',
      partnerId: undefined,
    });
  });

  it('scopes a partner to their own partner id', () => {
    const scope = resolveBookingScope(
      claims({ role: 'partner', permissions: [P.BOOKING_READ_OWN], partnerId: 'par-1' }),
    );
    expect(scope).toEqual({
      kind: 'own',
      customerProfileId: undefined,
      partnerId: 'par-1',
    });
  });

  it('denies a caller holding no booking permission at all', () => {
    expect(resolveBookingScope(claims({ permissions: [P.WALLET_READ] }))).toEqual({
      kind: 'none',
    });
  });

  it('denies an anonymous caller', () => {
    expect(resolveBookingScope(undefined)).toEqual({ kind: 'none' });
  });

  /**
   * The critical fail-closed case. A token carrying read_own but no owning id must
   * NOT widen to full access — that would be the exact escalation this module
   * exists to prevent.
   */
  it('fails closed when read_own is granted but no owning id is present', () => {
    const scope = resolveBookingScope(claims({ permissions: [P.BOOKING_READ_OWN] }));
    expect(scope).toEqual({ kind: 'none' });
  });

  it('lets read_all win when a caller somehow holds both', () => {
    const scope = resolveBookingScope(
      claims({
        role: 'operations_manager',
        permissions: [P.BOOKING_READ_OWN, P.BOOKING_READ_ALL],
        customerProfileId: 'cus-1',
      }),
    );
    expect(scope).toEqual({ kind: 'all' });
  });
});

describe('assertReadable', () => {
  it('rejects a none scope with 403', () => {
    expect(() => assertReadable({ kind: 'none' })).toThrow(ForbiddenException);
  });

  it('passes through an all scope', () => {
    expect(assertReadable({ kind: 'all' })).toEqual({ kind: 'all' });
  });

  it('passes through an own scope', () => {
    const scope = { kind: 'own', customerProfileId: 'cus-1' } as const;
    expect(assertReadable(scope)).toEqual(scope);
  });
});

/**
 * Ties the permission model to the ownership model: the roles the SRS says must
 * not see everything must actually resolve to a narrowed scope, using their REAL
 * permission sets rather than hand-picked ones.
 */
describe('role scopes match the SRS role model', () => {
  it('narrows real customers and partners, and only widens staff', () => {
    const customer = resolveBookingScope(
      claims({
        role: 'customer',
        permissions: resolvePermissions('customer'),
        customerProfileId: 'cus-1',
      }),
    );
    expect(customer.kind).toBe('own');

    const partner = resolveBookingScope(
      claims({
        role: 'partner',
        permissions: resolvePermissions('partner'),
        partnerId: 'par-1',
      }),
    );
    expect(partner.kind).toBe('own');

    for (const role of [
      'support_agent',
      'finance_officer',
      'operations_manager',
    ] as const) {
      expect(ROLE_PERMISSIONS[role]).toContain(P.BOOKING_READ_ALL);
      expect(
        resolveBookingScope(claims({ role, permissions: resolvePermissions(role) })).kind,
      ).toBe('all');
    }
  });
});
