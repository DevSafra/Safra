import { Body, Controller, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  PERMISSIONS as P,
  type PartnerLocationInput,
  type PartnerOnboardInput,
  partnerLocationSchema,
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

  /**
   * Sends the invitation again — the remedy when a partner never received or never used theirs.
   *
   * `PARTNER_ONBOARD` rather than a read permission: this MAILS A CREDENTIAL, and the ability to
   * cause a live invitation link to arrive in a mailbox is the same power as creating the partner
   * in the first place. Anyone who could call it could keep a link permanently fresh in an inbox
   * they were watching.
   *
   * Throttled harder than onboarding itself. A partner who has genuinely lost their link needs one
   * or two; a loop pointed at this endpoint is a mail flood with SAFRA's name on it.
   */
  /**
   * §8.1's map location, set from the onboarding screen.
   *
   * `PARTNER_ONBOARD`, the same capability as everything else on that screen: this is registration
   * data being completed, not an approval. Throttled with it for the same reason.
   */
  @Post(':reference/location')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_ONBOARD)
  @AuditExempt('PartnerOnboardingService records partner.location_set itself.')
  async setLocation(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerLocationSchema)) body: PartnerLocationInput,
  ) {
    return this.onboarding.setLocation(user, reference, body);
  }

  @Post(':reference/resend-invitation')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_ONBOARD)
  @AuditExempt('PartnerOnboardingService records partner.invitation_resent itself.')
  async resend(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.onboarding.resendInvitation(user, reference);
  }
}
