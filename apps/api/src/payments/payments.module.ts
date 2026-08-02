import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingsModule } from '../bookings/bookings.module.js';
import { LedgerModule } from '../ledger/ledger.module.js';
import { PaymentIntentService } from './payment-intent.service.js';
import { PaymentWebhookService } from './payment-webhook.service.js';
import { WebhookRetentionService } from './webhook-retention.service.js';
import { PaymentsController } from './payments.controller.js';
import { RefundService } from './refund.service.js';
import { ManualTransferProvider } from './providers/manual-transfer.provider.js';
import { PaymentProviderRegistry } from './providers/provider.registry.js';
import { WalletModule } from '../wallet/wallet.module.js';

/**
 * Payment collection and refunds (SRS §7).
 *
 * `SimulatorProvider` is deliberately absent from `providers` — the registry
 * constructs it only when `PAYMENT_SIMULATOR_ENABLED` is set, so a gateway that can
 * capture payments without money is not merely disabled in production but not
 * instantiated at all. Registering it here and branching later would leave it
 * reachable by any code that could inject it.
 */
@Module({
  // DatabaseModule (which provides ENV) and SettingsModule are @Global.
  // WalletModule supplies the §7.3 split: stored value is debited when a payment
  // starts and credited back on refund.
  imports: [BookingsModule, LedgerModule, WalletModule],
  controllers: [PaymentsController],
  providers: [
    WebhookRetentionService,
    ManualTransferProvider,
    PaymentProviderRegistry,
    PaymentIntentService,
    PaymentWebhookService,
    RefundService,
    // Provided per-module rather than globally, matching BookingsModule. It is
    // stateless, so a second instance costs nothing.
    AuditService,
  ],
  exports: [RefundService],
})
export class PaymentsModule {}
