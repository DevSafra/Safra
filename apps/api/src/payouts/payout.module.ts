import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { AdminPayoutController, PartnerPayoutController } from './payout.controller.js';
import { PayoutScheduler } from './payout.scheduler.js';
import { PayoutService } from './payout.service.js';

/** The partner payout ledger — see `PayoutService` for what it is and is not. */
@Module({
  imports: [LedgerModule],
  controllers: [PartnerPayoutController, AdminPayoutController],
  /*
    `AuditService` is listed here rather than imported from a shared module because that is how
    every other module in this app obtains it: it holds no state, only the connection token.
  */
  providers: [PayoutService, PayoutScheduler, AuditService],
  exports: [PayoutService, PayoutScheduler],
})
export class PayoutModule {}
