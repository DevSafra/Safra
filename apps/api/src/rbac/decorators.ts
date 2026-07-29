import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';

import type { Permission } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';

export const PUBLIC_KEY = 'safra:public';
export const PERMISSIONS_KEY = 'safra:permissions';

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

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AccessTokenClaims | undefined => {
    const request = ctx.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    return request.user;
  },
);
