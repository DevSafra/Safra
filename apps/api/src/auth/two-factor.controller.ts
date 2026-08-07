import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  type TotpDisableInput,
  type TotpEnableInput,
  totpDisableSchema,
  totpEnableSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { AllowsUnenrolled, CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from './token.service.js';
import { TwoFactorService } from './two-factor.service.js';

/**
 * Staff 2FA enrolment.
 *
 * Authenticated but not permission-gated: enrolling a second factor is something a
 * staff member does for their OWN account, and the service enforces that only staff
 * roles may do it.
 */
/*
 * `@AllowsUnenrolled` on the controller, not per route.
 *
 * TwoFactorGuard refuses every staff request until TOTP is enabled, so without
 * this the enrolment endpoints would be unreachable by exactly the accounts that need
 * them — a new staff member could never make their account usable. `disable` is
 * included deliberately: it demands the current password and a valid code of its own,
 * so it is not weakened by being reachable here, and excluding it would strand an
 * account mid-rotation.
 */
@AllowsUnenrolled()
@Controller('auth/2fa')
export class TwoFactorController {
  constructor(private readonly twoFactor: TwoFactorService) {}

  @Post('setup')
  @HttpCode(HttpStatus.OK)
  // Tight limit: each call rotates the pending secret, so repeated calls are either
  // a confused user or someone probing.
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt('Generates a pending secret only; the audited event is enabling it.')
  async setup(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.twoFactor.beginSetup(user);
  }

  @Post('enable')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt('Audited transactionally inside TwoFactorService.enable.')
  async enable(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(totpEnableSchema)) body: TotpEnableInput,
  ) {
    return this.twoFactor.enable(user, body.code);
  }

  @Post('disable')
  @HttpCode(HttpStatus.OK)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt('Audited transactionally inside TwoFactorService.disable.')
  async disable(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(totpDisableSchema)) body: TotpDisableInput,
  ) {
    return this.twoFactor.disable(user, body.password, body.code);
  }
}
