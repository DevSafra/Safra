import { Global, Module } from '@nestjs/common';

import { SettingsService } from './settings.service.js';

/**
 * Global because nearly every module needs a configured value (commissions, SLA,
 * cutoff), and a single instance means one shared cache rather than one per module.
 */
@Global()
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsModule {}
