import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { isStaffRole } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { ALLOWS_UNENROLLED_STAFF_KEY, PUBLIC_KEY } from './decorators.js';

/**
 * Refuses staff requests from an account that has not enrolled a second factor.
 *
 * ## The gap this closes
 *
 * `AuthService.login` only demands a TOTP code when the account ALREADY has one
 * enabled. A staff account that never enrolled therefore authenticated with a
 * password alone and received a fully privileged access token — verified against a
 * running instance on 2026-08-02: a `support_agent` with `totp_enabled_at IS NULL`
 * logged in with no second factor and read booking detail, customer contact details
 * included.
 *
 * The admin console did redirect unenrolled staff to `/enrol-2fa`, so the hole was
 * invisible through the UI. But the console is not the security boundary — the API
 * is reachable directly, and rule 1 is explicit that authorization is enforced per
 * request on the server and never in the UI. Declining to enrol was, in effect, a way
 * to opt out of two-factor authentication entirely.
 *
 * ## Why a guard rather than refusing at login
 *
 * Refusing the login would lock out every staff account that has not yet enrolled,
 * including a brand-new one, with no path to fix it — enrolment needs a session.
 * Issuing the session and gating what it can reach keeps enrolment possible while
 * making the token useless for anything else.
 *
 * Customers are unaffected: 2FA is a staff requirement (SRS §4), and `isStaffRole`
 * is what distinguishes them.
 */
@Injectable()
export class StaffTwoFactorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    const user = request.user;

    // Anonymous or customer: not this guard's concern. JwtAuthGuard has already
    // decided whether a session was required at all.
    if (!user || !isStaffRole(user.role) || user.totpEnabled) {
      return true;
    }

    /**
     * A @Public() route is never gated on enrolment.
     *
     * JwtAuthGuard still decodes a token on public routes so they can personalise,
     * which means `request.user` is populated on `logout` and `refresh`. Gating those
     * would trap an unenrolled staff member in a session they cannot end.
     */
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const allowed = this.reflector.getAllAndOverride<boolean>(
      ALLOWS_UNENROLLED_STAFF_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic || allowed) {
      return true;
    }

    /**
     * The message names the remedy. A staff member hitting this has a valid password
     * and a valid session; what they lack is enrolment, and saying so is not a
     * disclosure — they are already authenticated as themselves.
     */
    throw new ForbiddenException(
      'Two-factor authentication is required for staff accounts. ' +
        'Enrol at /auth/2fa/setup before using this endpoint.',
    );
  }
}
