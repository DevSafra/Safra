import { Global, Module } from '@nestjs/common';

import { SanctionsRefreshService } from './sanctions-refresh.service.js';
import { SanctionsService } from './sanctions.service.js';

/**
 * Sanctions screening (ADR 0002, §8.1).
 *
 * @Global because the review module needs it and nothing else should have to import
 * it explicitly to enforce a legal obligation.
 */
@Global()
@Module({
  providers: [SanctionsService, SanctionsRefreshService],
  exports: [SanctionsService, SanctionsRefreshService],
})
export class SanctionsModule {}
