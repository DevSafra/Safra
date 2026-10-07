import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { Inject, Injectable } from '@nestjs/common';

import { ENV, type Env } from '../config/env.js';
import {
  StorageService,
  StorageUnavailableError,
  type StoredObject,
} from './storage.service.js';

/**
 * S3-compatible object storage — Cloudflare R2, MinIO, Hetzner, or AWS itself.
 *
 * `forcePathStyle` is on because most non-AWS providers require it, and getting it
 * wrong produces DNS failures that look like credential problems.
 */
@Injectable()
export class S3Storage extends StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly publicBase: string;

  constructor(@Inject(ENV) env: Env) {
    super();

    this.bucket = env.S3_BUCKET ?? '';
    this.publicBase = env.S3_PUBLIC_URL ?? `${env.S3_ENDPOINT ?? ''}/${this.bucket}`;

    // Built conditionally: exactOptionalPropertyTypes forbids passing an explicit
    // `undefined` endpoint, and AWS's own config type rejects it too.
    this.client = new S3Client({
      region: env.S3_REGION ?? 'auto',
      forcePathStyle: true,
      credentials: {
        accessKeyId: env.S3_ACCESS_KEY_ID ?? '',
        secretAccessKey: env.S3_SECRET_ACCESS_KEY ?? '',
      },
      ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<StoredObject> {
    /*
      Every failure is the STORE's, never the caller's: the key and the bytes were produced by us,
      so a refusal is a timeout, a throttle, a 5xx or a misconfigured bucket. Typed, so the media
      worker retries it instead of declaring the photograph broken.
    */
    await this.client
      .send(
        new PutObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          // Long-lived cache: keys are content-addressed, so a changed image is a
          // new key rather than a mutation of an existing one.
          CacheControl: 'public, max-age=31536000, immutable',
          // Forces a download rather than inline rendering if the content type is
          // ever wrong — defence in depth against a stored-XSS via an image route.
          ContentDisposition: 'inline',
        }),
      )
      .catch((error: unknown) => {
        throw new StorageUnavailableError('a write', error);
      });

    return { key, contentType, size: body.byteLength };
  }

  async remove(key: string): Promise<void> {
    await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }

  async get(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const bytes = await result.Body?.transformToByteArray();

      return bytes ? Buffer.from(bytes) : null;
    } catch {
      // NoSuchKey and a transient fault are both "cannot serve this now"; the
      // caller renders 404 either way rather than leaking bucket detail (rule 1).
      return null;
    }
  }

  async read(key: string): Promise<Buffer | null> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );

      const bytes = await result.Body?.transformToByteArray();

      return bytes ? Buffer.from(bytes) : null;
    } catch (error) {
      if (isMissing(error)) return null;

      throw new StorageUnavailableError('a read', error);
    }
  }

  publicUrl(key: string): string {
    return `${this.publicBase}/${key}`;
  }
}

/**
 * «No such key», as each S3-compatible provider says it.
 *
 * The SDK's `NoSuchKey` name on AWS and R2, a bare 404 from MinIO and Hetzner when the error body
 * does not parse. Anything else — a 403, a 5xx, a socket that closed — is the store failing to
 * answer, and is not evidence that the object is gone.
 */
function isMissing(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  const name = 'name' in error ? error.name : undefined;
  const status =
    '$metadata' in error &&
    typeof error.$metadata === 'object' &&
    error.$metadata !== null &&
    'httpStatusCode' in error.$metadata
      ? error.$metadata.httpStatusCode
      : undefined;

  return name === 'NoSuchKey' || name === 'NotFound' || status === 404;
}
