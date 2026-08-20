import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Req,
  Res,
  UseInterceptors,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  ERROR,
  type EmailVerificationConfirmInput,
  type LoginCodeResendInput,
  type LoginInput,
  type LoginResponse,
  type PasswordChangeInput,
  type PasswordResetConfirmInput,
  type PasswordResetRequestInput,
  type ProfileUpdateInput,
  type RegisterInput,
  emailVerificationConfirmSchema,
  loginCodeResendSchema,
  loginSchema,
  passwordChangeSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  profileUpdateSchema,
  registerSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { SignInRefundInterceptor } from '../common/throttle/sign-in-refund.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../config/constants.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AllowsUnenrolled, CurrentUser, Public } from '../rbac/decorators.js';
import { AccountRecoveryService } from './account-recovery.service.js';
import { CustomerAccountService } from './customer-account.service.js';
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
    private readonly customerAccount: CustomerAccountService,
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
   * The `default` throttler is the per-IP ceiling and is what an attacker meets. Before 2026-08-07
   * it was TEN per IP with no account dimension, so one person's typo consumed the budget for
   * everyone behind their carrier; it went to forty then, and to three hundred on 2026-08-20 when
   * it stopped counting successes — see below.
   *
   * Neither is the primary defence against targeted brute force. That is unchanged and lives in
   * `AuthService`: five failed attempts locks the ACCOUNT for fifteen minutes, wherever they came
   * from, and a missing second factor does not count toward it.
   *
   * ## Since 2026-08-20 the per-IP ceiling counts only FAILURES, and it is 300 (`O-sec-3`)
   *
   * Scenario 4 of the load test measured what the paragraph above quietly assumed away: a
   * legitimate customer on an attacked egress address, with correct credentials and well inside
   * their own per-account allowance, signed in **0 times out of 30**. Forty a minute is 0.67 a
   * second, and it is shared by everybody behind one carrier-grade NAT address — thousands of
   * subscribers in the Syrian market.
   *
   * Two changes, and they only work together:
   *
   * 1. **A success costs nothing.** `SignInRefundInterceptor` gives the per-IP hit back when the
   *    sign-in succeeds, or when the password was right and only the code is outstanding. So the
   *    ceiling stopped being a request limit and became a budget for FAILED sign-ins, and
   *    legitimate traffic no longer spends it at all.
   * 2. **The budget is three hundred, not forty** (Bashar). Counting only failures does not on its
   *    own help the customer in that measurement — an attacker's traffic IS failures — so the
   *    number had to move too. At 300 an attacker must sustain five failed sign-ins a second from
   *    one address to starve it, against 0.67 before: 7.5× louder, and a signature worth alerting
   *    on. Argon2id verify was measured at 11.2 ms with the configured parameters, so five a
   *    second from one address is about 5 % of one machine's hashing capacity.
   *
   * The accepted cost is the third column of `O-sec-3`'s table: a single address can now drive
   * sixty accounts to lockout a minute rather than eight. A DISTRIBUTED attacker already bypasses
   * this ceiling entirely, so what it slows is the single-source case — the one that is easiest to
   * stop at the edge, which is where the residual belongs.
   *
   * The `account` throttler is unchanged at ten a minute per (IP, account) and is never refunded.
   * That is what keeps the password checks one address can force for one account bounded.
   */
  @Throttle({ default: { limit: 300, ttl: 60_000 } })
  @UseInterceptors(SignInRefundInterceptor)
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
   * «إعادة إرسال الرمز» — another sign-in code, for a partner whose mail was slow or lost.
   *
   * ## It takes the PASSWORD, not just an address
   *
   * A body carrying only an email would let anybody post codes at a stranger's inbox all day, and
   * would confirm which addresses have accounts while doing it. Proving the password first makes
   * this reachable by exactly one person: the one already halfway through signing in.
   *
   * ## The answer is the same whatever happened
   *
   * `{ ok: true }` for a wrong password, an unknown address, a customer, or a partner who has an
   * authenticator and gets no email at all. Anything else turns this into the enumeration oracle
   * that `O-sec-2` closed on registration. The refusal a caller CAN see is the rate limit, which
   * says nothing about whether the account exists.
   */
  /*
    NO `SignInRefundInterceptor` here, and that absence is load-bearing.

    The interceptor gives the per-IP hit back when a handler SUCCEEDS, and this handler succeeds
    every time by design — a wrong password, an unknown address and a real resend all answer
    `{ ok: true }` so the endpoint cannot be used to enumerate accounts. Refunding on that would
    hand the budget back for every wrong-password attempt too, which is the per-IP ceiling switched
    off on a route that spends an Argon2id verify per call. One address could then drive password
    checks across as many accounts as it had addresses for, bounded only by the per-(IP, account)
    ten a minute.

    So this route keeps its five a minute, spent whatever the answer was.
  */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login/resend-code')
  @HttpCode(HttpStatus.OK)
  @AuditExempt(
    'The issue itself is logged by LoginCodeService; a refusal reveals nothing.',
  )
  @UsePipes(new ZodValidationPipe(loginCodeResendSchema))
  async resendLoginCode(
    @Body() body: LoginCodeResendInput,
    @Req() request: Request,
  ): Promise<{ ok: true }> {
    await this.auth.resendLoginCode(body, contextOf(request));

    return { ok: true };
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

  /**
   * The signed-in customer's own profile, and the counters handoff §6 puts on the sidebar.
   *
   * `me` above answers the TOKEN — no name, no phone, because none of that is a claim. This reads
   * `customer_profiles`, which is what §6's greeting and the three section badges need.
   *
   * Takes no id: the service derives the profile from the verified token, so it cannot be asked about
   * anybody else. Read-only, so it changes nothing and is exempt from the audit log.
   */
  @Get('me/profile')
  @AuditExempt('A customer reading their own profile and counters; changes nothing.')
  async myProfile(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.customerAccount.summary(user);
  }

  /**
   * Editing your own name and phone.
   *
   * Takes no id — the service writes the profile the verified token names, so this cannot be pointed at
   * anybody else. Audited inside the service, which is why it is not exempt here.
   */
  @Patch('me/profile')
  @AuditExempt('CustomerAccountService records customer.profile_updated transactionally.')
  async updateMyProfile(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(profileUpdateSchema)) body: ProfileUpdateInput,
  ) {
    return this.customerAccount.updateProfile(user, body);
  }

  /**
   * Changing your own password.
   *
   * Throttled far tighter than the per-IP default: this endpoint verifies a password, so it is a place
   * somebody with a borrowed screen can guess one. Five a minute matches the login budget, and the
   * five-attempt account lockout does NOT apply here — the caller is already authenticated — so the
   * limiter is the only brake there is.
   */
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('me/password')
  @AuditExempt('CustomerAccountService records both the change and a refusal.')
  async changeMyPassword(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(passwordChangeSchema)) body: PasswordChangeInput,
    @Req() request: Request,
  ) {
    await this.customerAccount.changePassword(user, body, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });

    return { changed: true };
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
