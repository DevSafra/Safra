import { Module } from '@nestjs/common';

import { StorageModule } from '../storage/storage.module.js';
import { HealthController } from './health.controller.js';

/** Readiness reports whether media is publicly fetchable, so it needs the storage module. */
@Module({ imports: [StorageModule], controllers: [HealthController] })
export class HealthModule {}
