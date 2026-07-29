import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { AdminController } from './admin.controller.js';
import { ReviewService } from './review.service.js';

@Module({
  controllers: [AdminController],
  providers: [ReviewService, AuditService],
  exports: [ReviewService],
})
export class AdminModule {}
