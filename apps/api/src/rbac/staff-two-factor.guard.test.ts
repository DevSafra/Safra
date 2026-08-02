import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';

import type { Role } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { ALLOWS_UNENROLLED_STAFF_KEY, PUBLIC_KEY } from './decorators.js';
import { StaffTwoFactorGuard } from './staff-two-factor.guard.js';

/**
 * Regression guard for a shipped auth bypass.
 *
 * `AuthService.login` demanded a TOTP code only when the account already had one
 * enabled, so a staff account that never enrolled authenticated with a password alone
 * and received a fully privileged token. Verified against a running instance on
 * 2026-08-02: a `support_agent` with `totp_enabled_at IS NULL` read booking detail,
 * customer contact details included.
 *
 * The admin console redirected unenrolled staff to `/enrol-2fa`, which hid the hole —
 * but the console is not the security boundary. Declining to enrol was a way to opt
 * out of two-factor authentication entirely.
 */
describe('StaffTwoFactorGuard', () => {
  const guard = new StaffTwoFactorGuard(new Reflector());

  it('refuses a staff account that has not enrolled', () => {
    expect(() => guard.canActivate(contextFor(claims('support_agent', false)))).toThrow(
      ForbiddenException,
    );
  });

  it('names enrolment as the remedy rather than failing opaquely', () => {
    expect(() => guard.canActivate(contextFor(claims('super_admin', false)))).toThrow(
      /two-factor authentication is required/i,
    );
  });

  it('admits a staff account that has enrolled', () => {
    expect(guard.canActivate(contextFor(claims('super_admin', true)))).toBe(true);
  });

  /** 2FA is a staff requirement (§4); a customer must not be caught by it. */
  it('ignores customers, enrolled or not', () => {
    expect(guard.canActivate(contextFor(claims('customer', false)))).toBe(true);
  });

  it('ignores anonymous requests, leaving JwtAuthGuard to decide', () => {
    expect(guard.canActivate(contextFor(undefined))).toBe(true);
  });

  /**
   * Without this the enrolment endpoints are unreachable by exactly the accounts that
   * need them, and a new staff member can never make their account usable.
   */
  it('admits an unenrolled staff account to a route marked AllowsUnenrolledStaff', () => {
    const context = contextFor(claims('support_agent', false), {
      [ALLOWS_UNENROLLED_STAFF_KEY]: true,
    });

    expect(guard.canActivate(context)).toBe(true);
  });

  /**
   * JwtAuthGuard populates `request.user` on public routes too, so gating them would
   * trap an unenrolled staff member in a session they cannot end.
   */
  it('admits an unenrolled staff account to a public route such as logout', () => {
    const context = contextFor(claims('support_agent', false), { [PUBLIC_KEY]: true });

    expect(guard.canActivate(context)).toBe(true);
  });
});

function claims(role: Role, totpEnabled: boolean): AccessTokenClaims {
  return {
    sub: '00000000-0000-0000-0000-000000000001',
    role,
    permissions: [],
    locale: 'en',
    totpEnabled,
  };
}

/**
 * A minimal ExecutionContext carrying the metadata a real handler would.
 *
 * `Reflect.defineMetadata` rather than plain properties on the function: Reflector
 * reads through the metadata reflection API, and an object property is invisible to
 * it — which would make every exemption test pass against a guard that ignores
 * exemptions entirely.
 */
function contextFor(
  user: AccessTokenClaims | undefined,
  metadata: Record<string, unknown> = {},
) {
  const handler = function handler() {};

  for (const [key, value] of Object.entries(metadata)) {
    Reflect.defineMetadata(key, value, handler);
  }

  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => handler,
    getClass: () => class Controller {},
  } as unknown as Parameters<StaffTwoFactorGuard['canActivate']>[0];
}
