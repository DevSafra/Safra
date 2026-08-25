import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FxModule } from '../fx/fx.module.js';
import { WalletAdjustmentService } from './wallet-adjustment.service.js';
import { WalletAdminController } from './wallet-admin.controller.js';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';

/**
 * Customer wallet balances (§2.3, §7.3).
 *
 * `WalletService` is exported because the SLA sweep credits compensation through
 * it, and checkout will debit through it when split payment lands (§7.3). Both are
 * movements inside somebody else's transaction, which is why the service takes an
 * explicit handle rather than opening its own.
 *
 * `FxModule` is imported for cross-currency movements: a wallet holds one currency,
 * and an amount arriving in another is converted through SYP rather than added
 * as though the two were the same money. `LedgerModule` is @Global, so the
 * adjustment path reaches `LedgerService` without an import here.
 */
@Module({
  imports: [FxModule],
  controllers: [WalletController, WalletAdminController],
  providers: [WalletService, WalletAdjustmentService, AuditService],
  /*
    `WalletAdjustmentService` is exported so the BOOKING screen can compensate a customer for a
    stay (§9.4's «تعويض») without reimplementing a wallet movement. The money still moves through
    this service, with its append-only ledger and its `wallet.adjusted` audit row — only the
    question of WHOSE wallet is answered elsewhere, from the booking.
  */
  exports: [WalletService, WalletAdjustmentService],
})
export class WalletModule {}
