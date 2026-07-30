import { Global, Module } from '@nestjs/common';

import { ENV, type Env } from '../config/env.js';
import { ImageService } from './image.service.js';
import { MediaController } from './media.controller.js';
import { S3Storage } from './s3.storage.js';
import { LocalDiskStorage, StorageService } from './storage.service.js';

/**
 * Picks the storage backend from configuration.
 *
 * S3 whenever credentials are present, local disk otherwise. Deliberately not keyed
 * on NODE_ENV: a staging box with S3 configured should use it, and a developer
 * without credentials should not have to stub anything out.
 */
@Global()
@Module({
  controllers: [MediaController],
  providers: [
    {
      provide: StorageService,
      inject: [ENV],
      useFactory: (env: Env): StorageService =>
        env.S3_ACCESS_KEY_ID && env.S3_BUCKET
          ? new S3Storage(env)
          : new LocalDiskStorage(env),
    },
    ImageService,
  ],
  exports: [StorageService, ImageService],
})
export class StorageModule {}
