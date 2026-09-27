import { Module } from '@nestjs/common';

import { ContractRendererService } from '../admin/contract-renderer.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { HealthController } from './health.controller.js';

/**
 * Readiness reports whether media is publicly fetchable, so it needs the storage module.
 *
 * `ContractRendererService` is provided HERE rather than by `AdminModule` — it holds no state
 * beyond one flag, it is only ever read by this controller, and putting it in the admin module
 * would make readiness depend on the largest module in the application to report one boolean.
 */
@Module({
  imports: [StorageModule],
  controllers: [HealthController],
  providers: [ContractRendererService],
})
export class HealthModule {}
