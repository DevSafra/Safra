import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { TokenService, type AccessTokenClaims } from '../auth/token.service.js';
import { PUBLIC_KEY } from './decorators.js';

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
        } catch {
          // An invalid token on a public route is simply treated as anonymous.
        }
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('Authentication required.');
    }

    request.user = await this.tokens.verifyAccessToken(token);
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
