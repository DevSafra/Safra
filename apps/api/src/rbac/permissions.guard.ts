import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { Permission } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { PERMISSIONS_KEY } from './decorators.js';

/**
 * Checks the permissions carried in the verified access token.
 *
 * Permissions are read from the token rather than re-fetched per request, which
 * keeps authorization off the hot path. The trade-off is bounded and deliberate:
 * a permission change takes effect within the 15-minute access-token lifetime.
 * Anything needing immediate effect — suspending an account, revoking a partner —
 * calls TokenService.revokeAllForUser(), which invalidates the session at once.
 */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required || required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    const granted = request.user?.permissions ?? [];

    const missing = required.filter((permission) => !granted.includes(permission));

    if (missing.length > 0) {
      // The message names the permission but not the role's full grant list:
      // enough for a developer to debug, not enough to map the whole model.
      throw new ForbiddenException(`Missing required permission: ${missing.join(', ')}.`);
    }

    return true;
  }
}
