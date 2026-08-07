import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  ERROR,
  type EmailVerificationConfirmInput,
  type LoginInput,
  type LoginResponse,
  type PasswordResetConfirmInput,
  type PasswordResetRequestInput,
  type RegisterInput,
  emailVerificationConfirmSchema,
  loginSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  registerSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../config/constants.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AllowsUnenrolled, CurrentUser, Public } from '../rbac/decorators.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import {
  AuthService,
  SecondFactorRequiredException,
  type AuthResult,
  type RequestContext,
} from './auth.service.js';
import { TokenService, type AccessTokenClaims } from './token.service.js';
import { unauthorized } from '../common/errors/app-error.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    private readonly recovery: AccountRecoveryService,
  ) {}

  /**
   * Rate limits are per-endpoint and deliberately tight (rule 1). Login is the
   * most-attacked route on any platform, so it gets the strictest budget: five
   * attempts per minute per IP, layered on top of the per-account lockout.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @HttpCode(HttpStatus.ACCEPTED)
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() body: RegisterInput,
    @Req() request: Request,
  ): Promise<{ ok: true }> {
    const outcome = await this.auth.register(body);

    /*
      Audited either way, with DIFFERENT actions — the caller learns nothing, and §15 still records
      what happened. `auth.register_existing_email` is the more interesting of the two: a burst of
      them against many addresses from one source is an enumeration attempt that has been defeated,
      and it should be visible to whoever reads the log even though it was invisible to whoever
      made the requests.
    */
    this.audit.recordDetached({
      actorUserId: outcome.created ? outcome.userId : null,
      actorRole: outcome.created ? 'customer' : undefined,
      action: outcome.created ? 'auth.registered' : 'auth.register_existing_email',
      subjectType: 'user',
      subjectId: outcome.userId,
      ...contextOf(request),
    });

    /*
      The email is where the two paths differ, because an inbox is reachable only by the person who
      owns the address.

      Awaited rather than detached, and awaited in BOTH branches: `MailService.send` swallows
      delivery errors, so what is being waited on is a token insert for one and nothing for the
      other — and a branch that skipped the await would be measurably faster, which is the timing
      oracle this endpoint just closed.
    */
    if (outcome.created) {
      await this.recovery.requestEmailVerification(outcome.userId, contextOf(request));
    } else {
      await this.recovery.notifyAccountExists(body.email, outcome.locale);
    }

    /*
      The same body for both, and no session for either.

      Registration used to return tokens and sign the customer straight in. It cannot now: an
      identical response for a taken address would mean issuing a session for an account the caller
      may not own. The new customer verifies their email and signs in — one extra step, in exchange
      for this endpoint no longer answering "does this person have an account".
    */
    return { ok: true };
  }

  @Public()
  /**
   * ## Two limits, and they answer different questions
   *
   * The `account` throttler — ten a minute, keyed on IP + a hash of the email — is the one a real
   * person meets. Ten, not five, because a staff sign-in costs TWO requests: credentials, then the
   * second factor. At five, somebody who mistyped a code once was locked out mid-sign-in
   * (measured 2026-08-03). It is registered globally in `app.module.ts` and applies here because
   * this body names an account.
   *
   * The `default` throttler is the per-IP ceiling and is what an attacker meets. Forty a minute:
   * loose enough that a NAT'd office of partners signing in at the start of a shift is unaffected,
   * tight enough that cycling a thousand addresses from one host is bounded — which is the shape
   * of a credential-stuffing run. Before 2026-08-07 this was TEN per IP and there was no account
   * dimension, so one person's typo consumed the budget for everyone behind their carrier.
   *
   * Neither is the primary defence against targeted brute force. That is unchanged and lives in
   * `AuthService`: five failed attempts locks the ACCOUNT for fifteen minutes, wherever they came
   * from, and a missing second factor does not count toward it.
   */
  @Throttle({ default: { limit: 40, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
  /**
   * Declared exempt because this handler audits BOTH outcomes itself, below — the
   * interceptor cannot, since a failed login must still be recorded and the
   * interceptor only sees successes.
   *
   * Without the declaration the interceptor warned on every single sign-in. That is
   * worse than untidy: a warning that fires constantly and is always benign is how
   * people learn to ignore the warning that is supposed to catch a real gap.
   */
  @AuditExempt('Both outcomes are recorded in the handler; a failure must audit too.')
  @UsePipes(new ZodValidationPipe(loginSchema))
  async login(
    @Body() body: LoginInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    try {
      const result = await this.auth.login(body, contextOf(request));

      this.audit.recordDetached({
        actorUserId: result.user.id,
        actorRole: result.user.role,
        action: 'auth.login_succeeded',
        subjectType: 'user',
        subjectId: result.user.id,
        ...contextOf(request),
      });

      return this.respond(result, response);
    } catch (error) {
      /**
       * A missing second factor is NOT a failed sign-in and must not be audited as
       * one. The password was accepted; the attempt is simply incomplete, and the
       * two-step form is about to supply the code.
       *
       * Recording it would put one `auth.login_failed` row against every successful
       * staff sign-in — making it look as though everyone fails once, and burying the
       * real failed-login pattern §15 exists to expose. Measured on 2026-08-03: one
       * spurious row per successful two-step sign-in.
       */
      if (error instanceof SecondFactorRequiredException) throw error;

      // Failed sign-ins are recorded WITHOUT the attempted password, and keyed by
      // email rather than user id — the account may not exist at all.
      this.audit.recordDetached({
        action: 'auth.login_failed',
        subjectType: 'user',
        after: { email: body.email },
        ...contextOf(request),
      });
      throw error;
    }
  }

  /**
   * Rotates the session. The refresh token is read from the cookie only — never
   * from the body or a header — so an XSS payload cannot exfiltrate it.
   */
  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  /**
   * Not audited, deliberately. A refresh happens every fifteen minutes for every
   * active session; auditing it would bury the events §15 exists to preserve under
   * routine token churn. The security-relevant case — a REPLAYED refresh token — is
   * recorded by TokenService when it revokes the family.
   */
  @AuditExempt('Routine token rotation; replay detection is what gets recorded.')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const token = readRefreshCookie(request);

    if (!token) {
      throw unauthorized(ERROR.AUTH_SESSION_MISSING);
    }

    const result = await this.auth.refresh(token, contextOf(request));
    return this.respond(result, response);
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(readRefreshCookie(request));
    response.clearCookie(REFRESH_COOKIE_NAME, this.cookieOptions());
  }

  /**
   * Asks for a password reset link (§4).
   *
   * Always 204, whatever happened — unknown address, suspended account, throttled,
   * or sent. See AccountRecoveryService: any distinguishable response turns this into
   * an account-existence oracle that needs no password guess.
   *
   * Three per minute per IP, tighter than login. A reset request costs an email and
   * an Argon2id-free database round trip, so the limit is about protecting inboxes
   * rather than CPU — and the per-account throttle sits behind it for the case where
   * one victim is targeted from many addresses.
   */
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('password-reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt(
    'AccountRecoveryService records auth.password_reset_requested only when an ' +
      'account actually matched; auditing the route would log every probe as an action.',
  )
  async requestPasswordReset(
    @Body(new ZodValidationPipe(passwordResetRequestSchema))
    body: PasswordResetRequestInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.recovery.requestPasswordReset(body.email, contextOf(request));
  }

  /**
   * Sets the new password and ends every existing session.
   *
   * Not throttled as tightly as the request route: the token is 256 bits, so guessing
   * is not the threat, and a customer retyping a mistyped password should not be
   * locked out of their own reset.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('password-reset/confirm')
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('AccountRecoveryService records auth.password_reset_completed.')
  async confirmPasswordReset(
    @Body(new ZodValidationPipe(passwordResetConfirmSchema))
    body: PasswordResetConfirmInput,
    @Req() request: Request,
  ): Promise<void> {
    await this.recovery.confirmPasswordReset(
      body.token,
      body.password,
      contextOf(request),
    );
  }

  /** Re-sends the verification email to the signed-in account. */
  @Post('email/verify')
  @HttpCode(HttpStatus.NO_CONTENT)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @AuditExempt(
    'Requesting a verification email is not itself a state change worth auditing.',
  )
  async requestEmailVerification(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Req() request: Request,
  ): Promise<void> {
    if (!user) throw unauthorized(ERROR.AUTH_REQUIRED);

    await this.recovery.requestEmailVerification(user.sub, contextOf(request));
  }

  /**
   * Confirms the address, and claims any guest bookings made with it (§4).
   *
   * @Public() because the customer may open the link in a browser where they are not
   * signed in — a different device, or a private window. The token is the
   * authorization, and it identifies the account on its own.
   */
  @Public()
  @Post('email/verify/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('AccountRecoveryService records auth.email_verified with the claim count.')
  async confirmEmailVerification(
    @Body(new ZodValidationPipe(emailVerificationConfirmSchema))
    body: EmailVerificationConfirmInput,
  ): Promise<{ claimedBookings: number }> {
    return this.recovery.confirmEmailVerification(body.token);
  }

  /**
   * Returns the caller's identity and effective permissions.
   *
   * Reachable before enrolment: it discloses nothing the caller's own token does not
   * already carry, and a client that cannot read its own state cannot tell that
   * enrolment is what it is missing.
   */
  @AllowsUnenrolled()
  @Get('me')
  me(@CurrentUser() user: AccessTokenClaims | undefined): AccessTokenClaims {
    if (!user) {
      throw unauthorized(ERROR.AUTH_REQUIRED);
    }
    return user;
  }

  private respond(result: AuthResult, response: Response): LoginResponse {
    response.cookie(REFRESH_COOKIE_NAME, result.tokens.refreshToken, {
      ...this.cookieOptions(),
      maxAge: this.tokens.refreshCookieMaxAge,
    });

    // The refresh token is intentionally absent from the body.
    return {
      accessToken: result.tokens.accessToken,
      expiresIn: result.tokens.expiresIn,
      user: result.user,
    };
  }

  private cookieOptions() {
    return {
      httpOnly: true,
      secure: this.tokens.isProduction,
      // 'strict' blocks the cookie on any cross-site request, which is the CSRF
      // defence for this endpoint. Safe here because refresh is called by our own
      // first-party apps only.
      sameSite: 'strict' as const,
      // Must include the global prefix, or the cookie is never sent back.
      path: REFRESH_COOKIE_PATH,
    };
  }
}

function contextOf(request: Request): RequestContext {
  return {
    // req.ip honours trust proxy, configured in main.ts.
    ipAddress: request.ip,
    userAgent: request.get('user-agent'),
  };
}

/**
 * Reads the refresh cookie defensively.
 *
 * cookie-parser attaches `cookies` at runtime, so it is untyped as far as the
 * Express types are concerned. Narrowing through `unknown` rather than asserting a
 * shape means a malformed or absent jar yields undefined instead of leaking an
 * `any` into the auth path.
 */
function readRefreshCookie(request: Request): string | undefined {
  const jar: unknown = (request as { cookies?: unknown }).cookies;

  if (typeof jar !== 'object' || jar === null) {
    return undefined;
  }

  const value = (jar as Record<string, unknown>)[REFRESH_COOKIE_NAME];
  return typeof value === 'string' ? value : undefined;
}
