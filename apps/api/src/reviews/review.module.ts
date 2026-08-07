import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import {
  AdminReviewController,
  PartnerReviewController,
  ReviewController,
} from './review.controller.js';
import { ReviewService } from './review.service.js';

/** Guest reviews — see `ReviewService` for what P-006 means here. */
@Module({
  controllers: [ReviewController, PartnerReviewController, AdminReviewController],
  providers: [ReviewService, AuditService],
  exports: [ReviewService],
})
export class ReviewModule {}
