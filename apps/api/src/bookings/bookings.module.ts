import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { MailService } from '../mail/mail.service.js';
import { NotificationService } from '../notifications/notification.service.js';
import { FxModule } from '../fx/fx.module.js';
import { IdempotencyService } from '../common/idempotency/idempotency.service.js';
import { BookingAccessService } from './booking-access.service.js';
import { BookingActionsService } from './booking-actions.service.js';
import { BookingCreationService } from './booking-creation.service.js';
import { BookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';
import { PricingService } from './pricing.service.js';
import { SlaService } from './sla.service.js';
import { BookingRecoveryService } from './booking-recovery.service.js';
import { VoucherService } from './voucher.service.js';
import { StayCompletionService } from './stay-completion.service.js';
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
    StayCompletionService,
    BookingRecoveryService,
    VoucherService,
    IdempotencyService,
    AuditService,
    /* markPaid tells the partner their booking is waiting — see `S-2`. */
    NotificationService,
    MailService,
  ],
  exports: [
    BookingsService,
    SlaService,
    StayCompletionService,
    BookingRecoveryService,
    VoucherService,
    BookingAccessService,
    BookingCreationService,
    BookingActionsService,
    PricingService,
  ],
})
export class BookingsModule {}
