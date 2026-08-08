import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { MetricsController } from './metrics.controller.js';
import { MetricsService } from './metrics.service.js';

/** The scrape target. Needs storage for the media reachability gauge. */
@Module({
  imports: [StorageModule],
  controllers: [MetricsController],
  providers: [MetricsService],
})
export class MetricsModule {}
