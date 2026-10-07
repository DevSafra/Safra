import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, normalize, resolve, sep } from 'node:path';

import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '../config/env.js';

export interface StoredObject {
  key: string;
  contentType: string;
  size: number;
}

/**
 * The object store could not answer — which is not the same as the object not existing.
 *
 * ## Why the difference has to be a TYPE
 *
 * The media worker used to read an upload through `get`, which answers null for a missing object
 * AND for a timeout, a 503 or a dropped connection. Null was then taken at its word: «the bytes are
 * gone», the photograph marked failed for good, no retry. A five-second blip at the bucket turned
 * a partner's upload into a dead tile that only a second upload could replace.
 *
 * So anything that writes a PERMANENT conclusion from a read uses `read`, which throws this for
 * every fault except «no such key». A throw is how a job asks to be retried, and the class lets the
 * worker tell a store that is unwell from a render that cannot succeed.
 */
export class StorageUnavailableError extends Error {
  override readonly name = 'StorageUnavailableError';

  constructor(operation: string, cause: unknown) {
    super(`Object storage could not complete ${operation}.`, { cause });
  }
}

/** Whether an error, however it reached us, is a store that could not answer. */
export function isStorageUnavailable(error: unknown): boolean {
  return error instanceof Error && error.name === 'StorageUnavailableError';
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

  /**
   * Reads an object back through the API rather than handing out a URL.
   *
   * Exists for PRIVATE objects — partner identity documents (§8.1). `publicUrl` is
   * wrong for those twice over: it produces a link that works for anyone who has it,
   * and it leaves no record of who looked. A document is fetched by an authorised
   * caller, through a handler that checks the permission and writes an audit row.
   *
   * Returns null when the object is missing, so a deleted file renders a 404 rather
   * than a 500.
   */
  abstract get(key: string): Promise<Buffer | null>;

  /**
   * Reads an object, answering null ONLY when it does not exist.
   *
   * Every other fault throws `StorageUnavailableError`. For a caller that turns «missing» into a
   * permanent state — see that class — rather than into a 404 somebody can retry.
   */
  abstract read(key: string): Promise<Buffer | null>;
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

    try {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    } catch (error) {
      /* A full disk or a permissions fault: the store is unwell, the upload is not wrong. */
      throw new StorageUnavailableError('a write', error);
    }

    return { key, contentType, size: body.byteLength };
  }

  async remove(key: string): Promise<void> {
    try {
      await unlink(this.resolveWithin(key));
    } catch {
      // Already gone is a success for our purposes.
    }
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      return await readFile(this.resolveWithin(key));
    } catch {
      // Missing is a 404 for the caller, not a server fault.
      return null;
    }
  }

  async read(key: string): Promise<Buffer | null> {
    const target = this.resolveWithin(key);

    try {
      return await readFile(target);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;

      if (code === 'ENOENT' || code === 'ENOTDIR') return null;

      throw new StorageUnavailableError('a read', error);
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
