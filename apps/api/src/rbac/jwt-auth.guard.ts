import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { TokenService, type AccessTokenClaims } from '../auth/token.service.js';
import { setRequestUser } from '../common/logging/request-context.js';
import { PUBLIC_KEY } from './decorators.js';
import { ERROR } from '@safra/contracts';
import { unauthorized } from '../common/errors/app-error.js';

/**
 * Registered globally in AppModule, so every route requires a valid access token
 * unless explicitly marked @Public(). Deny by default (rule 1).
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AccessTokenClaims }>();
    const token = extractBearerToken(request.headers.authorization);

    if (isPublic) {
      // Still decode when a token is present: public endpoints such as search
      // personalise for signed-in customers, but must not fail without one.
      if (token) {
        try {
          request.user = await this.tokens.verifyAccessToken(token);
          setRequestUser(request.user.sub);
        } catch {
          // An invalid token on a public route is simply treated as anonymous.
        }
      }
      return true;
    }

    if (!token) {
      throw unauthorized(ERROR.AUTH_REQUIRED);
    }

    request.user = await this.tokens.verifyAccessToken(token);

    /**
     * Every subsequent log line carries who made the request. The ID, never the
     * email — logs leave the machine, and rule 1 keeps full PII out of them.
     */
    setRequestUser(request.user.sub);

    return true;
  }
}

function extractBearerToken(header: string | undefined): string | null {
  if (!header) {
    return null;
  }

  const [scheme, value] = header.split(' ');

  // Scheme comparison is case-insensitive per RFC 7235.
  if (!value || scheme?.toLowerCase() !== 'bearer') {
    return null;
  }

  return value.trim() || null;
}
