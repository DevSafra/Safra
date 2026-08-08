import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import {
  AdminReviewController,
  PartnerReviewController,
  ReviewController,
} from './review.controller.js';
import { ReviewService } from './review.service.js';

/** Guest reviews — see `ReviewService` for what P-006 means here. */
@Module({
  controllers: [ReviewController, PartnerReviewController, AdminReviewController],
  providers: [ReviewService, AuditService, NotificationService, MailService],
  exports: [ReviewService],
})
export class ReviewModule {}
