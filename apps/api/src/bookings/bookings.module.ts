import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { BookingAccessService } from './booking-access.service.js';
import { BookingActionsService } from './booking-actions.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { PricingService } from './pricing.service.js';
import { SlaService } from './sla.service.js';

@Module({
  controllers: [BookingsController],
  providers: [
    BookingsService,
    BookingAccessService,
    BookingCreationService,
    BookingActionsService,
    PricingService,
    SlaService,
    IdempotencyService,
    AuditService,
  ],
  exports: [
    BookingsService,
    BookingAccessService,
    BookingCreationService,
    BookingActionsService,
    PricingService,
  ],
})
export class BookingsModule {}
