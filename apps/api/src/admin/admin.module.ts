import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { AdminGrantsController, AdminGrantsService } from './grants.controller.js';
import { AdminController } from './admin.controller.js';
import { CityImagesController } from './city-images.controller.js';
import { AuditLogService } from './audit-log.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { AdminOperationsController } from './operations.controller.js';
import { ReviewService } from './review.service.js';
import { StaffController, StaffInvitationController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { SettingsAdminService } from '../settings/settings-admin.service.js';

@Module({
  // StaffService needs AuthTokenService, MailService, PasswordService and
  // TokenService, all of which AuthModule owns.
  imports: [AuthModule],
  controllers: [
    AdminController,
    CityImagesController,
    AdminGrantsController,
    AdminOperationsController,
    StaffController,
    StaffInvitationController,
  ],
  providers: [
    ReviewService,
    AdminGrantsService,
    AuditLogService,
    BookingDetailService,
    SettingsAdminService,
    AuditService,
    StaffService,
  ],
  exports: [ReviewService],
})
export class AdminModule {}
