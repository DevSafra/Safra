import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  PERMISSIONS as P,
  type PartnerOnboardInput,
  partnerOnboardSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PartnerOnboardingService } from './partner-onboarding.service.js';

/**
 * تسجيل شريك جديد — the super admin's own onboarding path (Bashar, 2026-08-23).
 *
 * One endpoint, and it is the only step of the in-person flow that needed a new one. Everything
 * after it — the documents, the contract, the screening, the approval — already has a route with a
 * permission and an audit entry of its own, and the console walks the operator through those in
 * order rather than wrapping them in a second "do it all" endpoint.
 *
 * That is a deliberate shape. A single endpoint taking a partner, five files, a contract and an
 * approval would be one authorization decision standing in for six, and the approval is the one
 * decision in this flow that must never be reachable except through `PARTNER_APPROVE`.
 */
@Controller('admin/partner-onboarding')
export class AdminPartnerOnboardingController {
  constructor(private readonly onboarding: PartnerOnboardingService) {}

  /**
   * Creates the partner, the account, and the invitation.
   *
   * `PARTNER_ONBOARD` rather than `PARTNER_APPLICATION_MANAGE`: see the permission's own docblock.
   * The short version is that accepting a request acts on an account that proved it holds its
   * mailbox, and this acts on an address somebody typed.
   *
   * Throttled at five a minute. There is no legitimate reason to register five partners a minute
   * — the flow this serves involves two people and a stack of paper — and a compromised super
   * admin session working down a list of addresses is exactly the shape this bounds.
   */
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_ONBOARD)
  @AuditExempt('PartnerOnboardingService records partner.onboarded_in_person itself.')
  async onboard(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(partnerOnboardSchema)) body: PartnerOnboardInput,
  ) {
    return this.onboarding.onboard(user, body);
  }
}
