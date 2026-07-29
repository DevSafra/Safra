import { Body, Controller, Get, Param, Post } from '@nestjs/common';

import {
  PERMISSIONS as P,
  type PartnerVerifyInput,
  type PropertyReviewInput,
  type SanctionsScreeningInput,
  partnerVerifySchema,
  propertyReviewSchema,
  sanctionsScreeningSchema,
} from '@safra/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ReviewService } from './review.service.js';

/**
 * Staff verification endpoints (SRS §8.1, §9.2).
 *
 * Permissions are split rather than lumped under one "admin" right: approving a
 * partner (PARTNER_APPROVE) and publishing a listing (PROPERTY_APPROVE) are
 * different decisions with different blast radii, and §4.1 requires staff to hold
 * only what their role needs.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly review: ReviewService) {}

  /** The §9.2 dashboard counters. */
  @Get('attention')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async attention() {
    return this.review.attentionCounts();
  }

  @Get('properties/pending')
  @RequirePermissions(P.PROPERTY_APPROVE)
  async pendingProperties() {
    return this.review.pendingProperties();
  }

  @Post('properties/:reference/review')
  @RequirePermissions(P.PROPERTY_APPROVE)
  async reviewProperty(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(propertyReviewSchema)) body: PropertyReviewInput,
  ) {
    return this.review.reviewProperty(user, reference, body);
  }

  @Get('partners/pending')
  @RequirePermissions(P.PARTNER_APPROVE)
  async pendingPartners() {
    return this.review.pendingPartners();
  }

  @Post('partners/:reference/verify')
  @RequirePermissions(P.PARTNER_APPROVE)
  async verifyPartner(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(partnerVerifySchema)) body: PartnerVerifyInput,
  ) {
    return this.review.verifyPartner(user, reference, body);
  }

  /**
   * Records a sanctions screening result. Gated on document review rather than
   * approval, because this is part of collecting evidence, not deciding on it.
   */
  @Post('partners/:reference/sanctions-screening')
  @RequirePermissions(P.PARTNER_DOCUMENT_REVIEW)
  async recordScreening(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(sanctionsScreeningSchema)) body: SanctionsScreeningInput,
  ) {
    return this.review.recordSanctionsScreening(user, reference, body);
  }
}
