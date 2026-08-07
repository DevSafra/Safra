import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Permission } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';

export const PUBLIC_KEY = 'safra:public';
export const PERMISSIONS_KEY = 'safra:permissions';
export const ALLOWS_UNENROLLED_KEY = 'safra:allows-unenrolled';

/**
 * Marks a route as reachable without a session.
 *
 * Authentication is opt-OUT, not opt-in: JwtAuthGuard is registered globally, so
 * forgetting a decorator leaves a route protected rather than exposed. SRS §5.1
 * requires visitors to search without signing in, so public routes are explicit
 * and few — and each one is a deliberate, reviewable decision.
 */
export const Public = () => SetMetadata(PUBLIC_KEY, true);

/**
 * Requires ALL listed permissions. Authorization is enforced per request on the
 * server (§4.1) — never inferred from what the UI chose to render.
 */
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Lets an account that has not yet enrolled a second factor reach this route.
 *
 * `TwoFactorGuard` otherwise refuses every request from a role that requires 2FA — staff and,
 * since 2026-08-07, partners — until TOTP is enabled, which would make enrolment itself
 * unreachable and the account permanently unusable. Only the enrolment routes and sign-out carry
 * this; each one is a deliberate hole in the gate and should be justified where it is applied.
 */
export const AllowsUnenrolled = () => SetMetadata(ALLOWS_UNENROLLED_KEY, true);

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    return request.user;
  },
);
