import { Body, Controller, Get, Post } from '@nestjs/common';

import {
  PERMISSIONS as P,
  type SetFxRateRequest,
  setFxRateSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { FxRateService } from './fx-rate.service.js';

/**
 * FX rate administration (SRS §1.4, §9.3).
 *
 * This exists because pricing now REFUSES to invent a rate. Without a way to set
 * one, that refusal would leave a fresh deployment unable to take a single booking
 * and no means to fix it — so the endpoint is part of the same change, not a
 * follow-up.
 *
 * Both routes require FX_RATE_MANAGE, which today only `super_admin` holds. Reading
 * a rate is not sensitive, but gating it on the resource's own permission keeps the
 * rule obvious; granting it to `finance_officer` is a policy call for the business,
 * noted in the roadmap.
 */
@Controller('admin/fx-rates')
export class FxRateController {
  constructor(private readonly fx: FxRateService) {}

  /**
   * Current rate per currency, with age and a staleness flag.
   *
   * Staleness is surfaced rather than enforced: a stale rate still prices bookings,
   * and turning age into a hard failure would take checkout down on a timer nobody
   * agreed to.
   */
  @Get()
  @RequirePermissions(P.FX_RATE_MANAGE)
  async list() {
    return { rates: await this.fx.list() };
  }

  /**
   * Records a new rate for `currency` → SYP.
   *
   * Always an INSERT. History is never rewritten, so a booking that snapshotted an
   * earlier rate stays explicable and a past-period report reproduces the figure
   * that was in force at the time.
   */
  @Post()
  @RequirePermissions(P.FX_RATE_MANAGE)
  @AuditExempt(
    'FxRateService records fx_rate.set inside the insert transaction, with the old ' +
      'and new rate — the interceptor resolves its subject from a route param and ' +
      'would capture neither.',
  )
  async set(
    @Body(new ZodValidationPipe(setFxRateSchema)) body: SetFxRateRequest,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.fx.set({
      currency: body.currency,
      rate: body.rate,
      effectiveFrom: body.effectiveFrom,
      source: body.source,
      actorRole: user?.role,
      actorUserId: user?.sub,
    });
  }
}
