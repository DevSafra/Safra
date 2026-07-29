import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UsePipes,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';

import {
  type LoginInput,
  type LoginResponse,
  type RegisterInput,
  loginSchema,
  registerSchema,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH } from '../config/constants.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public } from '../rbac/decorators.js';
import { AuthService, type AuthResult, type RequestContext } from './auth.service.js';
import { TokenService, type AccessTokenClaims } from './token.service.js';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Rate limits are per-endpoint and deliberately tight (rule 1). Login is the
   * most-attacked route on any platform, so it gets the strictest budget: five
   * attempts per minute per IP, layered on top of the per-account lockout.
   */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  @UsePipes(new ZodValidationPipe(registerSchema))
  async register(
    @Body() body: RegisterInput,
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const result = await this.auth.register(body, contextOf(request));

    this.audit.recordDetached({
      actorUserId: result.user.id,
      actorRole: result.user.role,
      action: 'auth.registered',
      subjectType: 'user',
      subjectId: result.user.id,
      ...contextOf(request),
    });

    return this.respond(result, response);
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(HttpStatus.OK)
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
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<LoginResponse> {
    const token = readRefreshCookie(request);

    if (!token) {
      throw new UnauthorizedException('No active session.');
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

  /** Returns the caller's identity and effective permissions. */
  @Get('me')
  me(@CurrentUser() user: AccessTokenClaims | undefined): AccessTokenClaims {
    if (!user) {
      throw new UnauthorizedException('Authentication required.');
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

function readRefreshCookie(request: Request): string | undefined {
  const cookies = (request as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.[REFRESH_COOKIE_NAME];
}
