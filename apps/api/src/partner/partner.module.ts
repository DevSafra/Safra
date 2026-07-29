import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { CalendarService } from './calendar.service.js';
import { PartnerController } from './partner.controller.js';
import { PropertiesService } from './properties.service.js';

@Module({
  controllers: [PartnerController],
  providers: [PropertiesService, CalendarService, AuditService],
  exports: [PropertiesService, CalendarService],
})
export class PartnerModule {}
