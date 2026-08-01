import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { AdminGrantsController, AdminGrantsService } from './grants.controller.js';
import { AdminController } from './admin.controller.js';
import { CityImagesController } from './city-images.controller.js';
import { ReviewService } from './review.service.js';

@Module({
  controllers: [AdminController, CityImagesController, AdminGrantsController],
  providers: [ReviewService, AdminGrantsService, AuditService],
  exports: [ReviewService],
})
export class AdminModule {}
