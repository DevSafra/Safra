import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ERROR, requiresAuthenticator } from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { ALLOWS_UNENROLLED_KEY, PUBLIC_KEY } from './decorators.js';
import { forbidden } from '../common/errors/app-error.js';

/**
 * Refuses requests from an account that must hold a second factor and has not enrolled one.
 *
 * ## The gap this closes
 *
 * `AuthService.login` only demands a TOTP code when the account ALREADY has one enabled. An
 * account that never enrolled therefore authenticated with a password alone and received a fully
 * privileged access token — verified against a running instance on 2026-08-02: a `support_agent`
 * with `totp_enabled_at IS NULL` logged in with no second factor and read booking detail, customer
 * contact details included.
 *
 * The console did redirect unenrolled staff to `/enrol-2fa`, so the hole was invisible through the
 * UI. But the console is not the security boundary — the API is reachable directly, and rule 1 is
 * explicit that authorization is enforced per request on the server and never in the UI. Declining
 * to enrol was, in effect, a way to opt out of two-factor authentication entirely.
 *
 * ## Partners, since 2026-08-07
 *
 * Bashar decided partner 2FA is mandatory rather than optional, so `requiresTwoFactor` — not
 * `isStaffRole` — is what this guard asks. The same reasoning applies with the same force: a
 * partner account controls listings, prices, availability, and visibility of money owed to a
 * business. The two lists are kept separate in `@safra/contracts` precisely so that widening this
 * one did not quietly widen console admission too.
 *
 * ## Why a guard rather than refusing at login
 *
 * Refusing the login would lock out every account that has not yet enrolled, including a brand-new
 * one, with no path to fix it — enrolment needs a session. Issuing the session and gating what it
 * can reach keeps enrolment possible while making the token useless for anything else. That is
 * also what makes the migration of EXISTING partner accounts work without an outage: they sign in,
 * they hold a session that can do exactly one thing, and they enrol.
 *
 * Customers are unaffected: §4 specifies guest checkout, and `requiresTwoFactor` excludes them.
 */
@Injectable()
export class TwoFactorGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    const user = request.user;

    /*
      Anonymous, a customer, or a PARTNER: not this guard's concern. JwtAuthGuard has already
      decided whether a session was required at all.

      `requiresAuthenticator`, not `requiresTwoFactor`, since 2026-08-20 (Bashar). The two used to
      be the same list and are now different questions. A partner still proves a second factor at
      every sign-in — a code emailed to them, checked in `AuthService.login` before any session
      exists — so by the time a request reaches this guard that proof has already happened. Holding
      them here would demand an authenticator they were never asked to enrol, which is the portal
      locked against every partner on the platform.

      Staff are unchanged: they must enrol, and this is what makes them.
    */
    if (!user || !requiresAuthenticator(user.role) || user.totpEnabled) {
      return true;
    }

    /**
     * A @Public() route is never gated on enrolment.
     *
     * JwtAuthGuard still decodes a token on public routes so they can personalise, which means
     * `request.user` is populated on `logout` and `refresh`. Gating those would trap an unenrolled
     * account in a session it cannot end.
     */
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const allowed = this.reflector.getAllAndOverride<boolean>(ALLOWS_UNENROLLED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic || allowed) {
      return true;
    }

    /**
     * The message names the remedy. Someone hitting this has a valid password and a valid session;
     * what they lack is enrolment, and saying so is not a disclosure — they are already
     * authenticated as themselves.
     */
    /*
      A code, not a sentence (`O-api-2`, 2026-08-25).

      The remedy is still named — `auth.two_factor_enrolment_required` says "enrol before
      continuing" in all three languages. What it deliberately drops is the PATH: `/auth/2fa/setup`
      is this API's route, and the screen that shows this message is a console or portal page whose
      own enrolment URL is different. Naming our route in a message a person reads sent them
      somewhere that is not where they enrol.
    */
    throw forbidden(ERROR.AUTH_TWO_FACTOR_ENROLMENT_REQUIRED);
  }
}
