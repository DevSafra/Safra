import { describe, expect, it } from 'vitest';

import type { Env } from '../config/env.js';
import { S3Storage } from './s3.storage.js';
import { LocalDiskStorage, isStorageUnavailable } from './storage.service.js';

/**
 * «Not there» and «could not answer» are different answers — go-live audit, 2026-10-06.
 *
 * The media worker took null from `get` as «the upload is gone» and failed the photograph for good,
 * and `get` answered null for a 503 exactly as for a missing key. `read` is the method that keeps
 * them apart; these pin that it does, per provider dialect, without a network.
 */
describe('reading from object storage', () => {
  const env = {
    S3_BUCKET: 'safra-test',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
    S3_ENDPOINT: 'http://127.0.0.1:9',
    API_URL_SELF: 'http://localhost:4000',
  } as Env;

  /** An S3 client that answers every command with `error`. */
  const failingWith = (error: Error): S3Storage => {
    const storage = new S3Storage(env);

    (storage as unknown as { client: { send: () => Promise<never> } }).client = {
      send: () => Promise.reject(error),
    };

    return storage;
  };

  it.each([
    ['the SDK´s NoSuchKey', Object.assign(new Error('gone'), { name: 'NoSuchKey' })],
    [
      'a bare 404 from MinIO',
      Object.assign(new Error('UnknownError'), { $metadata: { httpStatusCode: 404 } }),
    ],
  ])('answers null for a missing object: %s', async (_label, error) => {
    await expect(failingWith(error).read('incoming/x')).resolves.toBeNull();
  });

  it.each([
    [
      'a 503',
      Object.assign(new Error('Slow Down'), {
        name: 'SlowDown',
        $metadata: { httpStatusCode: 503 },
      }),
    ],
    [
      'a dropped connection',
      Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }),
    ],
    [
      'a 403',
      Object.assign(new Error('Access Denied'), {
        name: 'AccessDenied',
        $metadata: { httpStatusCode: 403 },
      }),
    ],
  ])('throws a store-unavailable error for %s', async (_label, error) => {
    const outcome = await failingWith(error)
      .read('incoming/x')
      .then(
        () => 'resolved',
        (thrown: unknown) => thrown,
      );

    expect(isStorageUnavailable(outcome), 'not mistaken for a missing object').toBe(true);
  });

  /** `get` keeps its lenient answer for the callers that turn it into a 404 somebody can retry. */
  it('leaves get answering null for a fault', async () => {
    await expect(failingWith(new Error('socket hang up')).get('x')).resolves.toBeNull();
  });

  /** A write the store refused is the store's fault, so the worker retries it rather than failing. */
  it('types a refused write as the store being unavailable', async () => {
    const outcome = await failingWith(new Error('socket hang up'))
      .put('properties/x-400.avif', Buffer.from('x'), 'image/avif')
      .then(
        () => 'resolved',
        (thrown: unknown) => thrown,
      );

    expect(isStorageUnavailable(outcome)).toBe(true);
  });

  it('answers null from local disk for a key that does not exist', async () => {
    await expect(
      new LocalDiskStorage(env).read(`incoming/does-not-exist-${Date.now()}`),
    ).resolves.toBeNull();
  });
});
