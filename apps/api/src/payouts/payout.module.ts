import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import {
  AdminPayoutAccountController,
  PartnerPayoutAccountController,
} from './payout-account.controller.js';
import { PayoutAccountService } from './payout-account.service.js';
import { AdminPayoutController, PartnerPayoutController } from './payout.controller.js';
import { PayoutScheduler } from './payout.scheduler.js';
import { PayoutService } from './payout.service.js';

/** The partner payout ledger — see `PayoutService` for what it is and is not. */
@Module({
  imports: [LedgerModule],
  controllers: [
    PartnerPayoutController,
    AdminPayoutController,
    PartnerPayoutAccountController,
    AdminPayoutAccountController,
  ],
  /*
    `AuditService` is listed here rather than imported from a shared module because that is how
    every other module in this app obtains it: it holds no state, only the connection token.
  */
  /*
    `FieldEncryptionService` is provided here rather than imported: it is stateless and reads its
    key from the same env token, so a second instance is the same object with a different address.
    It is what makes an account number ciphertext at rest.
  */
  providers: [
    PayoutService,
    PayoutAccountService,
    PayoutScheduler,
    AuditService,
    FieldEncryptionService,
  ],
  exports: [PayoutService, PayoutAccountService, PayoutScheduler],
})
export class PayoutModule {}
