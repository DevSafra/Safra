import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  ERROR,
  PERMISSIONS as P,
  type PartnerApplicationAcceptInput,
  type PartnerApplicationContactInput,
  type PartnerApplicationInput,
  type PartnerApplicationListQuery,
  type PartnerApplicationRejectInput,
  type PartnerInvitationAcceptInput,
  partnerApplicationAcceptSchema,
  partnerApplicationContactSchema,
  partnerApplicationListQuerySchema,
  partnerApplicationRejectSchema,
  partnerApplicationSchema,
  partnerInvitationAcceptSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { forbidden } from '../common/errors/app-error.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import { PartnerApplicationService } from './partner-application.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The customer-facing half of «انضم كشريك»: one endpoint, and it creates nothing but a request.
 *
 * Separate from `PartnerController` because everything there answers to a signed-in PARTNER and
 * this answers to a signed-in CUSTOMER — a different account, a different permission model, and a
 * route that must stay reachable by somebody who is not a partner yet.
 */
@Controller('partner/applications')
export class PartnerApplicationController {
  constructor(private readonly applications: PartnerApplicationService) {}

  /**
   * Step 1 — applying, as a signed-in customer (Bashar, 2026-08-19).
   *
   * NOT `@Public()`. It was, and requiring a session is what let the address on a request stop
   * being a claim: `user.sub` comes from the verified token, and the service derives the email,
   * the account to convert and the eligibility check from it. Nothing about WHO is applying can
   * be typed, so "apply as somebody else" is unexpressible rather than defended against.
   *
   * No `@RequirePermissions`: the global `JwtAuthGuard` denies by default, and the caller is by
   * definition an ordinary customer who holds no partner permission yet. Requiring one would
   * exclude exactly the people this endpoint exists for.
   *
   * Throttled at three a minute. A form that sends an email and writes a row is worth abusing,
   * and a real applicant fills it in once.
   */
  @Post()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @AuditExempt('PartnerApplicationService records partner_application.submitted itself.')
  async submit(
    @Body(new ZodValidationPipe(partnerApplicationSchema)) body: PartnerApplicationInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Req() request: Request,
  ) {
    /*
      The guard has already refused an anonymous request, so `sub` is present. Checked anyway,
      because "the guard will have run" is an assumption and this is the value the whole flow is
      keyed on — an `undefined` slipping through would file a request against nobody.
    */
    if (!user?.sub) throw forbidden(ERROR.AUTH_REQUIRED);

    return this.applications.submit(body, {
      userId: user.sub,
      ...(request.ip === undefined ? {} : { ipAddress: request.ip }),
      ...(request.get('user-agent') === undefined
        ? {}
        : { userAgent: request.get('user-agent') }),
    });
  }
}

/**
 * Redeeming an invitation — the partner sets their own first password.
 *
 * Its own controller, at its own path, because it is the only route in this feature that a person
 * with no session and no account may call and that CHANGES something about an account. Sitting it
 * beside the queue endpoints would put a `@Public()` route in a file of permission-guarded ones.
 */
@Controller('partner/invitation')
export class PartnerInvitationController {
  constructor(private readonly applications: PartnerApplicationService) {}

  /**
   * Throttled at five a minute per address, like every other credential endpoint.
   *
   * The token is 256 bits, so guessing is not the threat this limit answers; it answers somebody
   * spending an Argon2id hash per request, which is the expensive part of this call.
   */
  @Public()
  @Post()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt('PartnerApplicationService records partner.invitation_accepted itself.')
  async accept(
    @Body(new ZodValidationPipe(partnerInvitationAcceptSchema))
    body: PartnerInvitationAcceptInput,
  ) {
    await this.applications.acceptInvitation(body.token, body.password);

    /*
      No session is issued, and no hint about the account.

      They go and sign in normally, which keeps ONE code path minting partner sessions — the one
      with the lockout counter and the mandatory 2FA gate on it — rather than a second, quieter
      one here.
    */
    return { ok: true };
  }
}

/**
 * The console's half: the queue, the call, the decision.
 *
 * Reading is `PARTNER_APPLICATION_READ`, which operations holds. Every action is
 * `PARTNER_APPLICATION_MANAGE`, which only the super admin holds — accepting invites somebody
 * into the platform, and Bashar put that decision with one person (2026-08-19).
 */
@Controller('admin/partner-applications')
export class AdminPartnerApplicationController {
  constructor(private readonly applications: PartnerApplicationService) {}

  @Get()
  @RequirePermissions(P.PARTNER_APPLICATION_READ)
  async list(
    @Query(new ZodValidationPipe(partnerApplicationListQuerySchema))
    query: PartnerApplicationListQuery,
  ) {
    return this.applications.list(query);
  }

  @Get(':reference')
  @RequirePermissions(P.PARTNER_APPLICATION_READ)
  async detail(@Param('reference') reference: string) {
    return this.applications.detail(reference);
  }

  /** Step 2 — the call happened. */
  @Post(':reference/contact')
  @RequirePermissions(P.PARTNER_APPLICATION_MANAGE)
  @AuditExempt('PartnerApplicationService records partner_application.contacted itself.')
  async contact(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerApplicationContactSchema))
    body: PartnerApplicationContactInput,
  ) {
    return this.applications.markContacted(user, reference, body.notes);
  }

  /**
   * Steps 3 and 4 — accepted; the partner record exists and the invitation is on its way.
   *
   * There is no email field in the body. The address is the one on the request, which is what
   * makes this "accept THIS application" rather than "create a partner account for an address of
   * my choosing" — two very different actions that would otherwise share one audit entry.
   */
  @Post(':reference/accept')
  @RequirePermissions(P.PARTNER_APPLICATION_MANAGE)
  @AuditExempt('PartnerApplicationService records partner_application.accepted itself.')
  async accept(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerApplicationAcceptSchema))
    body: PartnerApplicationAcceptInput,
  ) {
    return this.applications.accept(user, reference, body.notes);
  }

  @Post(':reference/reject')
  @RequirePermissions(P.PARTNER_APPLICATION_MANAGE)
  @AuditExempt('PartnerApplicationService records partner_application.rejected itself.')
  async reject(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerApplicationRejectSchema))
    body: PartnerApplicationRejectInput,
  ) {
    return this.applications.reject(user, reference, body.notes);
  }

  /** An invitation that expired, or a mailbox that never received it. */
  @Post(':reference/resend-invitation')
  @RequirePermissions(P.PARTNER_APPLICATION_MANAGE)
  @AuditExempt(
    'PartnerApplicationService records partner_application.invitation_resent itself.',
  )
  async resend(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.applications.resendInvitation(user, reference);
  }
}
