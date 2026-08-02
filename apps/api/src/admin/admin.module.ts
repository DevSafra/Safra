import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { AdminGrantsController, AdminGrantsService } from './grants.controller.js';
import { AdminController } from './admin.controller.js';
import { CityImagesController } from './city-images.controller.js';
import { AuditLogService } from './audit-log.service.js';
import { BookingDetailService } from './booking-detail.service.js';
import { AdminOperationsController } from './operations.controller.js';
import { ReviewService } from './review.service.js';
import { SettingsAdminService } from '../settings/settings-admin.service.js';

@Module({
  controllers: [
    AdminController,
    CityImagesController,
    AdminGrantsController,
    AdminOperationsController,
  ],
  providers: [
    ReviewService,
    AdminGrantsService,
    AuditLogService,
    BookingDetailService,
    SettingsAdminService,
    AuditService,
  ],
  exports: [ReviewService],
})
export class AdminModule {}
