import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '../config/env.js';

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
}

/**
 * Object storage behind one interface.
 *
 * Two implementations, chosen by configuration: S3 for deployed environments and
 * local disk for development and tests. Callers never learn which — the same
 * property-image code path runs against both, so an upload bug cannot hide behind
 * "it only happens with real S3".
 *
 * Keys are always generated here, never supplied by a client. A caller-controlled
 * key is a path-traversal write.
 */
export abstract class StorageService {
  abstract put(key: string, body: Buffer, contentType: string): Promise<StoredObject>;
  abstract remove(key: string): Promise<void>;
  abstract publicUrl(key: string): string;
}

@Injectable()
export class LocalDiskStorage extends StorageService {
  private readonly logger = new Logger(LocalDiskStorage.name);
  private readonly root: string;
  private readonly baseUrl: string;

  constructor(@Inject(ENV) env: Env) {
    super();
    this.root = resolve(process.cwd(), '.storage');
    this.baseUrl = `${env.API_URL_SELF}/api/v1/media`;
    this.logger.warn(
      'Using local disk storage. Intended for development only — deployments must set S3_* variables.',
    );
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    const target = this.resolveWithin(key);

    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, body);

    return { key, contentType, size: body.byteLength };
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolveWithin(key));
    } catch {
      // Already gone is a success for our purposes.
    }
  }

  publicUrl(key: string): string {
    return `${this.baseUrl}/${key}`;
  }

  /**
   * Resolves a key inside the storage root and refuses anything that escapes it.
   *
   * Keys are generated internally, so this should be unreachable — which is exactly
   * why it is here. If a future code path ever forwards a caller-supplied key,
   * this turns a silent arbitrary-file-write into a thrown error.
   */
  private resolveWithin(key: string): string {
    const target = resolve(join(this.root, normalize(key)));

    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new Error('Refusing to write outside the storage root.');
    }

    return target;
  }
}
