import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { WalletModule } from '../wallet/wallet.module.js';
import { GiftCardController } from './gift-card.controller.js';
import { GiftCardService } from './gift-card.service.js';

/**
 * بطاقات الهدايا (handoff §6).
 *
 * `WalletModule` is imported rather than the balance being moved here directly: it exports
 * `WalletService`, which owns the row locking, the negative-balance refusal and the cross-currency
 * conversion. Writing to `wallets` from a second place is how those invariants stop holding.
 */
@Module({
  imports: [WalletModule],
  controllers: [GiftCardController],
  providers: [GiftCardService, AuditService],
})
export class GiftCardModule {}
