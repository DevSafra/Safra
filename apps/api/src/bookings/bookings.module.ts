import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FxModule } from '../fx/fx.module.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { BookingAccessService } from './booking-access.service.js';
import { BookingActionsService } from './booking-actions.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { PricingService } from './pricing.service.js';
import { SlaService } from './sla.service.js';
import { WalletModule } from '../wallet/wallet.module.js';

@Module({
  // Pricing cannot quote without an FX rate to SYP, so this is a hard dependency.
  // WalletModule is here for the SLA sweep, which credits §6.4 compensation.
  imports: [FxModule, WalletModule],
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
