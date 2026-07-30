import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { CalendarService } from './calendar.service.js';
import { PartnerImagesController } from './images.controller.js';
import { PartnerController } from './partner.controller.js';
import { PropertiesService } from './properties.service.js';

@Module({
  controllers: [PartnerController, PartnerImagesController],
  providers: [PropertiesService, CalendarService, AuditService],
  exports: [PropertiesService, CalendarService],
})
export class PartnerModule {}
