import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import {
  PERMISSIONS as P,
  fineWaiveSchema,
  pageQuerySchema,
  partnerSuspendSchema,
  violationFineSchema,
  violationRaiseSchema,
  violationWarnSchema,
  type FineWaiveInput,
  type PartnerSuspendInput,
  type ViolationFineInput,
  type ViolationRaiseInput,
  type ViolationWarnInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { EnforcementService } from './enforcement.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Enforcement against a partner (Bashar, 2026-08-24).
 *
 * ## Two capabilities, and the split is deliberate
 *
 * `VIOLATION_MANAGE` covers recording an offence, warning, fining and suspending.
 * **`VIOLATION_WAIVE` covers forgiving a fine and nothing else** — because deciding that money
 * SAFRA has levied will not be collected is a different authority from deciding it was owed, and
 * the person who raised a violation should not be the only check on cancelling its consequence.
 *
 * ## Every route takes a reason, and the schema enforces a floor
 *
 * Twenty characters. Not a quality bar — a bar against «مخالفة» reaching a real business owner as
 * the whole explanation for why they cannot trade. Every one of these produces a record somebody
 * will read months later, and half of them produce an email the partner reads today.
 *
 * ## Throttled like the writes they are
 *
 * These are not bulk operations. A rate that would look generous on a list endpoint is a rate at
 * which somebody could suspend every partner on the platform in a minute.
 */
@Controller('admin')
export class EnforcementController {
  constructor(private readonly enforcement: EnforcementService) {}

  @Post('partners/:reference/suspend')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_SUSPEND)
  @AuditExempt('EnforcementService records partner.suspended inside the transaction.')
  async suspend(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerSuspendSchema)) body: PartnerSuspendInput,
  ) {
    await this.enforcement.suspend(user, reference, body);

    return { suspended: true };
  }

  /** Lifting takes a reason too — "who decided this was over, and why" is asked as often as why. */
  @Post('partners/:reference/unsuspend')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.PARTNER_SUSPEND)
  @AuditExempt('EnforcementService records partner.unsuspended inside the transaction.')
  async unsuspend(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerSuspendSchema)) body: PartnerSuspendInput,
  ) {
    await this.enforcement.unsuspend(user, reference, body);

    return { suspended: false };
  }

  /**
   * The violations on one partner, PAGED.
   *
   * Its own endpoint rather than an array on the partner record, and project-e9 asked the right
   * question: a partner with forty violations is an ordinary partner after two years. Embedding
   * them would be an unpaginated list on a screen, which the standing instruction forbids for
   * exactly that reason — the record links here, and here has a pager.
   */
  @Get('partners/:reference/violations')
  @RequirePermissions(P.VIOLATION_READ)
  @AuditExempt('Reading violations; changes nothing.')
  async violations(
    @Param('reference') reference: string,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: z.infer<typeof pageQuerySchema>,
  ) {
    return this.enforcement.list(reference, query);
  }

  @Post('partners/:reference/violations')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions(P.VIOLATION_MANAGE)
  @AuditExempt('EnforcementService records violation.recorded inside the transaction.')
  async raise(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(violationRaiseSchema)) body: ViolationRaiseInput,
  ) {
    return this.enforcement.raise(user, reference, body);
  }

  @Post('violations/:id/warn')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions(P.VIOLATION_MANAGE)
  @AuditExempt('EnforcementService records violation.warned inside the transaction.')
  async warn(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(violationWarnSchema)) body: ViolationWarnInput,
  ) {
    await this.enforcement.warn(user, id, body);

    return { stage: 'warned' };
  }

  @Post('violations/:id/fine')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @RequirePermissions(P.VIOLATION_MANAGE)
  @AuditExempt('EnforcementService records violation.fined inside the transaction.')
  async fine(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(violationFineSchema)) body: ViolationFineInput,
  ) {
    await this.enforcement.fine(user, id, body);

    return { stage: 'fined' };
  }

  /**
   * `VIOLATION_WAIVE` alone, and it is the only route on this controller that moves money.
   *
   * Nothing is deleted: the fine stays, the stage stays `fined`, and a balancing ledger entry is
   * posted so the pair nets to zero. The partner is emailed.
   */
  @Post('violations/:id/waive')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @RequirePermissions(P.VIOLATION_WAIVE)
  @AuditExempt('EnforcementService records fine.waived inside the transaction.')
  async waive(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(new ZodValidationPipe(fineWaiveSchema)) body: FineWaiveInput,
  ) {
    await this.enforcement.waive(user, id, body);

    return { waived: true };
  }
}
