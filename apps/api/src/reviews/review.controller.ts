import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';

import {
  PERMISSIONS as P,
  type ReviewCreateInput,
  type ReviewModerateInput,
  type ReviewReplyInput,
  type ReviewReportInput,
  pageQuerySchema,
  reviewCreateSchema,
  reviewModerateSchema,
  reviewReplySchema,
  reviewReportSchema,
} from '@safra/contracts';
import { z } from 'zod';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { ReviewService } from './review.service.js';

const listQuerySchema = pageQuerySchema;

/**
 * A guest writing a review (§7.3).
 *
 * On the customer surface rather than under `partner/`, because the person acting is the guest.
 * The service takes a booking reference and derives everything else — see the note there about why
 * accepting a property id would be a ranking exploit.
 */
@Controller('reviews')
export class ReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Post()
  @RequirePermissions(P.REVIEW_CREATE)
  @AuditExempt('Audited transactionally inside ReviewService.create.')
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(reviewCreateSchema)) body: ReviewCreateInput,
  ) {
    return this.reviews.create(user, body);
  }
}

/**
 * تقييمات ضيوفي — the partner's own reviews, and the two remedies P-006 allows.
 *
 * There is no delete route and there cannot be one: the table refuses `DELETE`. What a partner has
 * instead is `reply` and `report`, and reporting does not hide anything — staff decide.
 *
 * Every route is scoped by the service to the `partnerId` in the VERIFIED token; none of them
 * names a partner.
 */
@Controller('partner/reviews')
export class PartnerReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get()
  @RequirePermissions(P.REVIEW_READ_OWN)
  @AuditExempt('A partner reading their own reviews; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.reviews.listForPartner(user, query);
  }

  @Post(':reference/reply')
  @RequirePermissions(P.REVIEW_RESPOND_OWN)
  @AuditExempt('Audited transactionally inside ReviewService.reply.')
  async reply(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(reviewReplySchema)) body: ReviewReplyInput,
  ) {
    return this.reviews.reply(user, reference, body.reply);
  }

  @Post(':reference/report')
  @RequirePermissions(P.REVIEW_RESPOND_OWN)
  @AuditExempt('Audited transactionally inside ReviewService.report.')
  async report(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(reviewReportSchema)) body: ReviewReportInput,
  ) {
    return this.reviews.report(user, reference, body.reason);
  }
}

/**
 * Staff moderation (§7.3, P-006).
 *
 * `uphold` HIDES a review and `dismiss` leaves it published. Neither deletes it — the verbs are
 * chosen so the API's vocabulary does not imply a power the database refuses to grant.
 */
@Controller('admin/reviews')
export class AdminReviewController {
  constructor(private readonly reviews: ReviewService) {}

  @Get('reported')
  @RequirePermissions(P.REVIEW_MODERATE)
  @AuditExempt('Reading the moderation queue; changes nothing.')
  async reported(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.reviews.listReported(query);
  }

  @Post(':reference/moderate')
  @RequirePermissions(P.REVIEW_MODERATE)
  @AuditExempt('Audited transactionally inside ReviewService.moderate.')
  async moderate(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(reviewModerateSchema)) body: ReviewModerateInput,
  ) {
    return this.reviews.moderate(user, reference, body);
  }
}
