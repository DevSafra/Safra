import { Module } from '@nestjs/common';

import { AuditService } from '../common/audit/audit.service.js';
import { FxRateController } from './fx-rate.controller.js';
import { FxRateService } from './fx-rate.service.js';

/**
 * FX rates to SYP (§1.4).
 *
 * `FxRateService` is exported because pricing depends on it: a booking cannot be
 * quoted without a rate, and that dependency is now explicit rather than a silent
 * fallback buried in PricingService.
 */
@Module({
  controllers: [FxRateController],
  providers: [FxRateService, AuditService],
  exports: [FxRateService],
})
export class FxModule {}
