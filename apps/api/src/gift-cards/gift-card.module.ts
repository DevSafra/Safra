import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { FxModule } from '../fx/fx.module.js';
import { GiftCardController } from './gift-card.controller.js';
import { GiftCardService } from './gift-card.service.js';
import { GiftCardExpiryService } from './gift-card-expiry.service.js';
import { JobRunService } from '../common/jobs/job-run.service.js';

/**
 * بطاقات الهدايا (handoff §6).
 *
 * `WalletModule` is imported rather than the balance being moved here directly: it exports
 * `WalletService`, which owns the row locking, the negative-balance refusal and the cross-currency
 * conversion. Writing to `wallets` from a second place is how those invariants stop holding.
 */
/*
 * `AuthModule` for `MailService` — buying a card emails its code to the purchaser, and that module
 * is where the transport is provided and exported (the same route `AdminModule` takes for it).
 * `ENV` needs no import: `DatabaseModule` is global.
 */
@Module({
  /* `LedgerModule` and `FxModule`: every card movement now posts a balanced group. */
  imports: [WalletModule, AuthModule, LedgerModule, FxModule],
  controllers: [GiftCardController],
  providers: [GiftCardService, GiftCardExpiryService, AuditService, JobRunService],
  /* `GiftCardExpiryService` is driven by `ScheduledProcessor`; see `scheduled.job.ts`. */
  exports: [GiftCardService, GiftCardExpiryService],
})
export class GiftCardModule {}
