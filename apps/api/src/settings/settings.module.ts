import { Global, Module } from '@nestjs/common';

import { FxModule } from '../fx/fx.module.js';
import { MoneySettingsService } from './money-settings.service.js';
import { SettingsService } from './settings.service.js';

/**
 * Global because nearly every module needs a configured value (commissions, SLA,
 * cutoff), and a single instance means one shared cache rather than one per module.
 *
 * `MoneySettingsService` sits alongside it and depends on FX, because a money setting
 * carries its own currency and must be converted into whichever one the caller is
 * working in (§2.1).
 */
@Global()
@Module({
  imports: [FxModule],
  providers: [SettingsService, MoneySettingsService],
  exports: [SettingsService, MoneySettingsService],
})
export class SettingsModule {}
