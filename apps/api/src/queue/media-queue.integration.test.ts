import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';
import sharp from 'sharp';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DeadLetterService } from './dead-letter.service.js';
import { MediaProcessor } from './media.processor.js';
import { MEDIA_JOB, mediaJobId } from './media.job.js';
import { ImageService } from '../storage/image.service.js';
import type { StorageService } from '../storage/storage.service.js';

/**
 * The `media` queue, against a real Redis, a real BullMQ worker and real `sharp`.
 *
 * ## Why the encoding is NOT stubbed here
 *
 * Every other suite that touches images stubs `ImageService`, and is right to — they are about
 * ownership, ordering and the cover invariant, and re-encoding six variants per test would spend
 * their time measuring libvips. This one is about the thing that moved: whether a photograph
 * uploaded in a request actually becomes six objects when a worker picks the job up. A stub cannot
 * answer that, so a small real image goes in and the real pipeline runs on it.
 *
 * 500×500 rather than something realistic: it is above `MIN_DIMENSION`, so the validation path is
 * genuine, and small enough that three AVIF encodes cost milliseconds.
 *
 * ## Its own queue prefix, obliterated afterwards
 *
 * `safra-test-<random>` rather than `safra`, so a test run cannot consume a job the development API
 * enqueued, and a worker left running by `pnpm worker` cannot consume a test's.
 *
 * ## The database rolls back, the object store is a Map
 *
 * The worker is given the SAME harness connection as the producer, because the image row lives
 * inside the test's open transaction and a worker on a separate pool could not see it. Storage is
 * an in-memory double for the same reason MinIO is not started here: what is under test is that the
 * right keys are written, read and REMOVED, and a Map answers that exactly.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
const describeIfReady = DATABASE_URL && REDIS_URL ? describe : describe.skip;

/** Long enough for a local round trip plus six encodes, short enough that a hang fails. */
const SETTLE_MS = 15_000;

describeIfReady('the media queue', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const objects = new Map<string, Buffer>();
  /* Structurally a StorageService — all four members — so no cast is needed or allowed. */
  const storage: StorageService = {
    put: (key: string, body: Buffer, contentType: string) => {
      objects.set(key, body);

      return Promise.resolve({ key, contentType, size: body.byteLength });
    },

    get: (key: string) => Promise.resolve(objects.get(key) ?? null),
    remove: (key: string) => {
      objects.delete(key);

      return Promise.resolve();
    },
    publicUrl: (key: string) => `https://media.test/${key}`,
  };

  const images = new ImageService(storage);

  let connection: Redis;
  let queue: Queue;
  let worker: Worker;
  let prefix = '';
  let propertyId = '';

  /** A real 500×500 JPEG, encoded once per test — cheap, and genuinely decodable. */
  const photograph = async (): Promise<Buffer> =>
    sharp({
      create: {
        width: 500,
        height: 500,
        channels: 3,
        background: { r: 40, g: 90, b: 140 },
      },
    })
      .jpeg()
      .toBuffer();

  beforeEach(async () => {
    await harness.begin();
    objects.clear();

    propertyId = await seedProperty();

    prefix = `safra-test-${Math.random().toString(36).slice(2, 10)}`;
    connection = new Redis(REDIS_URL ?? '', { maxRetriesPerRequest: null });
    queue = new Queue('media', { connection, prefix });

    const processor = new MediaProcessor(db, images, storage, new DeadLetterService(db));

    worker = new Worker('media', (job) => processor.process(job), {
      connection,
      prefix,
      concurrency: 2,
    });

    worker.on('failed', (job, error) => void processor.onFailed(job, error));
    /* Without an error listener an ioredis blip inside BullMQ takes the test process down. */
    worker.on('error', () => undefined);

    await worker.waitUntilReady();
  }, 30_000);

  afterEach(async () => {
    await worker.close();
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await connection.quit();
    await harness.rollback();
  }, 30_000);

  afterAll(async () => {
    await harness.close();
  });

  /** Waits for a condition rather than for a duration, so a fast machine is not penalised. */
  const until = async (predicate: () => Promise<boolean>): Promise<boolean> => {
    const deadline = Date.now() + SETTLE_MS;

    while (Date.now() < deadline) {
      if (await predicate()) return true;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  };

  const rowOf = async (imageId: string) =>
    (
      await db.execute<{
        status: string;
        variant_widths: number[] | null;
        original_key: string | null;
        failure_code: string | null;
        is_cover: boolean;
      }>(sql`
        SELECT status::text AS status, variant_widths, original_key, failure_code, is_cover
        FROM property_images WHERE id = ${imageId}::uuid
      `)
    ).rows[0];

  // ─── The seam ──────────────────────────────────────────────────────────────

  /**
   * The whole of phase 3, in one test.
   *
   * A `processing` row and a parked original go in; six objects and a `ready` row come out. Every
   * assertion here is something the request used to do and no longer does.
   */
  it('renders the variants and publishes the row', { timeout: 30_000 }, async () => {
    const { imageId, fileKey, originalKey } = await park();

    await queue.add(
      MEDIA_JOB,
      { imageId, originalKey, fileKey },
      { jobId: mediaJobId(imageId) },
    );

    expect(
      await until(async () => (await rowOf(imageId))?.status === 'ready'),
      'the row reached ready',
    ).toBe(true);

    const row = await rowOf(imageId);

    /* Never upscaled: a 500 px source yields 400 and 500, not 400/800/1600. */
    expect(row?.variant_widths).toEqual([400, 500]);

    /* Two formats per width — AVIF first, WebP as the fallback for older clients. */
    expect(objects.has(`${fileKey}-400.avif`)).toBe(true);
    expect(objects.has(`${fileKey}-400.webp`)).toBe(true);
    expect(objects.has(`${fileKey}-500.avif`)).toBe(true);

    /*
        The uploaded bytes are gone, and the column that pointed at them is NULL.

        Both halves matter: the object is the only copy of a file nobody validated beyond its
        header, and a `original_key` left set would make every orphan sweep think it was still
        needed.
      */
    expect(objects.has(originalKey)).toBe(false);
    expect(row?.original_key).toBeNull();
  });

  /** Nothing the client sent is ever served — the property the move to a worker must not lose. */
  it(
    'serves only re-encoded bytes, never the uploaded file',
    { timeout: 30_000 },
    async () => {
      const { imageId, fileKey, originalKey } = await park();
      const uploaded = objects.get(originalKey);

      await queue.add(
        MEDIA_JOB,
        { imageId, originalKey, fileKey },
        { jobId: mediaJobId(imageId) },
      );

      expect(await until(async () => (await rowOf(imageId))?.status === 'ready')).toBe(
        true,
      );

      for (const [key, body] of objects) {
        expect(key.startsWith(fileKey), `${key} belongs to this image`).toBe(true);
        expect(body.equals(uploaded ?? Buffer.alloc(0)), `${key} was re-encoded`).toBe(
          false,
        );
      }
    },
  );

  // ─── When it goes wrong ────────────────────────────────────────────────────

  /**
   * A file that is not an image fails terminally and takes its cover with it.
   *
   * This is the case that reopened an already-fixed bug from a new direction. The first upload
   * becomes the cover; if its render dies, the property has photographs and NO cover, and every
   * card falls back to «لا صورة بعد». So the failure path has to repair the gallery, not just
   * record the death.
   */
  it(
    'marks a broken upload failed and promotes the next cover',
    { timeout: 30_000 },
    async () => {
      const cover = await park({ bytes: Buffer.from('this is not an image'), order: 0 });
      const second = await park({ order: 1, cover: false });

      await queue.add(
        MEDIA_JOB,
        {
          imageId: cover.imageId,
          originalKey: cover.originalKey,
          fileKey: cover.fileKey,
        },
        { jobId: mediaJobId(cover.imageId), attempts: 1 },
      );

      expect(
        await until(async () => (await rowOf(cover.imageId))?.status === 'failed'),
        'the broken row reached failed',
      ).toBe(true);

      const dead = await rowOf(cover.imageId);

      expect(dead?.failure_code).toBe(ERROR.UPLOAD_IMAGE_PROCESSING_FAILED);
      expect(dead?.is_cover, 'a dead image is not a cover').toBe(false);
      expect((await rowOf(second.imageId))?.is_cover, 'the next was promoted').toBe(true);

      /*
        The original is deliberately KEPT on this path. It is the evidence of what was actually
        uploaded, and an image that failed is the one case somebody will want to look at.
      */
      expect(objects.has(cover.originalKey)).toBe(true);
    },
  );

  /** A terminal failure is durable — BullMQ's own failed set is in Redis and nothing reads it. */
  it(
    'records a dead letter carrying keys and no bytes',
    { timeout: 30_000 },
    async () => {
      const { imageId, fileKey, originalKey } = await park({
        bytes: Buffer.from('this is not an image'),
      });

      await queue.add(
        MEDIA_JOB,
        { imageId, originalKey, fileKey },
        { jobId: mediaJobId(imageId), attempts: 1 },
      );

      expect(
        await until(async () => (await deadLetterCount(imageId)) > 0),
        'a dead letter was written',
      ).toBe(true);

      const letter = (
        await db.execute<{ payload: Record<string, unknown> }>(sql`
          SELECT payload FROM dead_letter_jobs
          WHERE queue = 'media' AND job_id = ${mediaJobId(imageId)}
        `)
      ).rows[0];

      /* Three server-generated keys and a row id. Nothing a person typed, and no image data. */
      expect(Object.keys(letter?.payload ?? {}).sort()).toEqual([
        'fileKey',
        'imageId',
        'originalKey',
      ]);
    },
  );

  /**
   * A second delivery of the same job does nothing.
   *
   * BullMQ redelivers on a stall reclaim, and at concurrency 4 two workers can hold the same row.
   * The claim is `UPDATE … WHERE status = 'processing' RETURNING`, so the second attempt matches
   * nothing — this asserts it returns quietly rather than re-rendering over a published image.
   */
  it('ignores a job for a row that is already ready', { timeout: 30_000 }, async () => {
    const { imageId, fileKey, originalKey } = await park();

    await queue.add(
      MEDIA_JOB,
      { imageId, originalKey, fileKey },
      { jobId: mediaJobId(imageId) },
    );

    expect(await until(async () => (await rowOf(imageId))?.status === 'ready')).toBe(
      true,
    );

    const after = objects.size;

    /* A different job id, because the first still exists — this is the redelivery case. */
    await queue.add(
      MEDIA_JOB,
      { imageId, originalKey, fileKey },
      { jobId: `${imageId}-again` },
    );

    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect((await rowOf(imageId))?.status).toBe('ready');
    expect(objects.size, 'nothing was written a second time').toBe(after);
  });

  // ─── Fixtures ──────────────────────────────────────────────────────────────

  const deadLetterCount = async (imageId: string): Promise<number> =>
    Number(
      (
        await db.execute<{ count: string }>(sql`
          SELECT count(*)::text AS count FROM dead_letter_jobs
          WHERE queue = 'media' AND job_id = ${mediaJobId(imageId)}
        `)
      ).rows[0]?.count ?? 0,
    );

  /** One `processing` row with its bytes parked, exactly as `upload` leaves them. */
  async function park(
    options: { bytes?: Buffer; order?: number; cover?: boolean } = {},
  ): Promise<{ imageId: string; fileKey: string; originalKey: string }> {
    const bytes = options.bytes ?? (await photograph());
    const fileKey = images.keyFor({ kind: 'properties', owner: 'PRO-TEST' });
    const originalKey = images.incomingKeyFor(fileKey);

    await storage.put(originalKey, bytes, 'application/octet-stream');

    const inserted = await db.execute<{ id: string }>(sql`
      INSERT INTO property_images
        (property_id, file_key, width, height, variant_widths, status, original_key,
         is_cover, sort_order)
      VALUES (${propertyId}::uuid, ${fileKey}, 500, 500, '{}'::integer[], 'processing',
              ${originalKey}, ${options.cover ?? true}, ${options.order ?? 0})
      RETURNING id
    `);

    const id = inserted.rows[0]?.id;

    if (!id) throw new Error('Image fixture produced no row.');

    return { imageId: id, fileKey, originalKey };
  }

  /** A partner with one property, so the images have something to hang off. */
  async function seedProperty(): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1)  AS city_id,
               (SELECT id FROM property_types LIMIT 1)                   AS type_id,
               (SELECT id FROM partner_types LIMIT 1)                    AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1)            AS policy_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('media-' || gen_random_uuid() || '@safra.test', '+963900000077', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.partner_type_id, 'Media Test', 'وسائط', ref.city_id, 'x',
               '+963900000077', 'media-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id, city_id
      )
      INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                              slug, name_ar, name_en, name_de, address, status)
      SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
             'media-test-' || gen_random_uuid(), 'وسائط', 'Media', 'Media', 'x', 'draft'
      FROM pa, ref
      RETURNING id
    `);

    const id = made.rows[0]?.id;

    if (!id) throw new Error('Property fixture produced no row.');

    return id;
  }
});
