import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import { PERMISSIONS as P, partnerCouponDecisionSchema } from '@safra/contracts';
import type { PartnerCouponDecisionInput } from '@safra/contracts';

import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { PartnerCouponsService } from './partner-coupons.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { requirePartnerId } from '../rbac/ownership.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The partner's own coupons — what SAFRA has offered them, and what they did about it.
 *
 * Every route resolves the partner from the TOKEN via `requirePartnerId`; none of them takes a
 * partner id. That absence is the authorization: «may this partner answer that partner's coupon»
 * is a question this controller cannot be asked.
 */
@Controller('partner/coupons')
export class PartnerCouponsController {
  constructor(private readonly coupons: PartnerCouponsService) {}

  @Get()
  @RequirePermissions(P.PARTNER_COUPON_DECIDE)
  async list(@CurrentUser() user: AccessTokenClaims | undefined) {
    const partnerId = requirePartnerId(user, P.PARTNER_COUPON_DECIDE);

    return { coupons: await this.coupons.list(partnerId) };
  }

  /**
   * Accepting or refusing, in one route with the decision in the body.
   *
   * One route rather than two, because the two differ only in a word and the rule they share —
   * decided once, never again — is the part that must not be written twice.
   */
  @Post(':code/decision')
  @RequirePermissions(P.PARTNER_COUPON_DECIDE)
  async decide(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(partnerCouponDecisionSchema))
    body: PartnerCouponDecisionInput,
  ) {
    const partnerId = requirePartnerId(user, P.PARTNER_COUPON_DECIDE);

    return this.coupons.decide(user, partnerId, code, body.decision);
  }
}
