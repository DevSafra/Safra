import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { MediaRedriveService } from './media-redrive.service.js';
import { creativeJobId, mediaJobId, type MediaJobData } from './media.job.js';

/**
 * `O-media-2` — a render whose job was lost, and the sweep that gets it moving again.
 *
 * ## What it is protecting
 *
 * Both upload paths commit the row at `processing` and THEN enqueue, swallowing an enqueue failure
 * so a successful upload is never undone by a queue that is briefly away. The row carries the
 * original key, which is everything a re-drive needs — and until now nothing read it, so a lost job
 * left the row at `processing` **for ever**. The console polls, gives up after forty seconds and
 * tells the partner something is wrong, and so does the next upload, and the next.
 *
 * ## The assertions that matter are the ones about what it must NOT re-drive
 *
 * A sweep that re-enqueues too much is worse than one that misses: a row with no original key has
 * lost its BYTES, and re-driving it turns a stuck row into a worker failing on a loop against an
 * object that is not there. So `ready`, `failed`, deleted and key-less rows are each planted and
 * each asserted absent — and beside a stuck row that IS re-driven, so «nothing happened» cannot
 * pass for «it discriminated».
 *
 * The queue is a recording double. What is being tested is which rows are chosen and what payload
 * they produce; BullMQ's own deduplication by job id is its behaviour, not ours, and the ids are
 * asserted here precisely because that deduplication is what makes re-driving safe.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('re-driving a lost image render', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: MediaRedriveService;
  let added: { data: MediaJobData; jobId: string }[];

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    added = [];

    service = new MediaRedriveService(db, {
      add: (_name: string, data: MediaJobData, options: { jobId: string }) => {
        added.push({ data, jobId: options.jobId });

        return Promise.resolve();
      },
      /* Nothing retained: the lost-job case. A retained one is tested against a real Redis. */
      getJob: () => Promise.resolve(undefined),
    } as never);

    /* A clean slate INSIDE the rollback: real stuck rows would make every count ambiguous. */
    await db.execute(sql`
      UPDATE property_images SET status = 'ready'
       WHERE status = 'processing'
    `);
    await db.execute(sql`
      UPDATE ad_campaigns SET image_status = NULL
       WHERE image_status = 'processing'
    `);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** A property to hang photographs on, taken from the fixtures rather than invented. */
  async function aProperty(): Promise<string> {
    const rows = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM properties WHERE deleted_at IS NULL ORDER BY reference LIMIT 1
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw new Error('no property to attach a photograph to');

    return id;
  }

  /** One `property_images` row, aged and shaped as the case needs. */
  async function anImage(options: {
    status: string;
    minutesOld: number;
    originalKey: string | null;
  }): Promise<string> {
    const propertyId = await aProperty();

    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO property_images
        (property_id, file_key, original_key, status, sort_order, created_at)
      VALUES (${propertyId}::uuid, 'properties/PRO-REDRIVE/file', ${options.originalKey},
              ${options.status}::image_status, 900,
              now() - ${`${options.minutesOld} minutes`}::interval)
      RETURNING id::text
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw new Error('could not plant an image row');

    return id;
  }

  it('re-drives a photograph stuck at processing, with its own job id', async () => {
    const id = await anImage({
      status: 'processing',
      minutesOld: 30,
      originalKey: 'incoming/PRO-REDRIVE/original',
    });

    const result = await service.run();

    expect(result.images).toBe(1);
    expect(added).toHaveLength(1);
    expect(added[0]?.jobId, 'the id BullMQ deduplicates on').toBe(mediaJobId(id));
    expect(added[0]?.data.originalKey).toBe('incoming/PRO-REDRIVE/original');
    expect(added[0]?.data.fileKey).toBe('properties/PRO-REDRIVE/file');
  });

  /**
   * The discrimination, all in one test so each «not chosen» sits beside a «chosen».
   *
   * Four rows that must be left alone and one that must be taken. Asserting the four separately
   * would let a query that selects NOTHING pass all four.
   */
  it('leaves alone everything that is not a lost render', async () => {
    const stuck = await anImage({
      status: 'processing',
      minutesOld: 30,
      originalKey: 'incoming/PRO-REDRIVE/stuck',
    });

    /* Too recent: the job may still be queued, and the threshold is what «lost» means. */
    await anImage({
      status: 'processing',
      minutesOld: 1,
      originalKey: 'incoming/PRO-REDRIVE/fresh',
    });
    /* Already rendered. */
    await anImage({
      status: 'ready',
      minutesOld: 30,
      originalKey: 'incoming/PRO-REDRIVE/done',
    });
    /* Tried and failed: the row carries a reason, and a retry loop is not a re-drive. */
    await anImage({
      status: 'failed',
      minutesOld: 30,
      originalKey: 'incoming/PRO-REDRIVE/failed',
    });
    /* NO original key: the bytes are gone, and re-driving would fail on a loop for ever. */
    await anImage({ status: 'processing', minutesOld: 30, originalKey: null });

    const deleted = await anImage({
      status: 'processing',
      minutesOld: 30,
      originalKey: 'incoming/PRO-REDRIVE/deleted',
    });
    await db.execute(
      sql`UPDATE property_images SET deleted_at = now() WHERE id = ${deleted}::uuid`,
    );

    const result = await service.run();

    expect(result.images, 'exactly the one lost render').toBe(1);
    expect(added.map((job) => job.jobId)).toEqual([mediaJobId(stuck)]);
  });

  /**
   * An advertising creative, whose staleness is dated from `updated_at`.
   *
   * `created_at` would be wrong and quietly so: a campaign row exists from the day the campaign
   * does, and its creative may be uploaded days later — so dating from creation would re-drive
   * every campaign that ever had an upload, immediately and for ever.
   */
  it('re-drives a creative, keyed on the FILE as its upload is', async () => {
    /*
      The campaign is planted rather than borrowed. A fresh database has no advertising at all, so
      reaching for an existing row made this pass only where somebody had once created a campaign.
    */
    const rows = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 1) AS city_id
      ), adv AS (
        INSERT INTO advertisers (name, kind, city_id)
        SELECT 'معلن الصورة', 'restaurant', ref.city_id FROM ref
        RETURNING id
      )
      INSERT INTO ad_campaigns (advertiser_id, city_id, status, starts_at, ends_at,
                                headline_ar, headline_en, headline_de, target_url)
      SELECT adv.id, ref.city_id, 'active', now() - interval '1 day', now() + interval '30 days',
             'عنوان', 'Headline', 'Titel', 'https://example.test/x'
      FROM adv, ref
      RETURNING id::text
    `);

    const id = rows.rows[0]?.id;

    if (!id) throw new Error('no ad campaign to attach a creative to');

    await db.execute(sql`
      UPDATE ad_campaigns
         SET image_status = 'processing',
             image_original_key = 'incoming/ADS/original',
             image_file_key = 'ads/ADS/file',
             updated_at = now() - INTERVAL '30 minutes'
       WHERE id = ${id}::uuid
    `);

    const result = await service.run();

    expect(result.creatives).toBe(1);
    expect(added[0]?.jobId, 'creatives key on the file, not the row').toBe(
      creativeJobId('ads/ADS/file'),
    );
    expect(added[0]?.data.subject, 'or the worker writes to the wrong table').toBe(
      'ad_campaign',
    );
  });

  it('does nothing, quietly, when nothing is stuck', async () => {
    const result = await service.run();

    expect(result).toEqual({ images: 0, creatives: 0 });
    expect(added).toEqual([]);
  });
});
