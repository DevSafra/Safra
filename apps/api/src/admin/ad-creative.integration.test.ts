import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AdCreativeService, CREATIVE_WIDTH } from './ad-creative.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ImageService } from '../storage/image.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A campaign's creative goes through the platform's pipeline, or it does not go at all.
 *
 * ## What is worth asserting
 *
 * That this is the SAME pipeline, not a lookalike. The security of every image SAFRA serves lives
 * in `ImageService` — magic bytes checked before a byte is stored, every served byte decoded and
 * re-encoded by us, nothing the client uploaded ever reaching a reader — and the way that gets lost
 * is a second upload path that looks similar and skips one step.
 *
 * So the cases here are: a file that is not a photograph is refused BEFORE storage, an accepted one
 * leaves the row `processing` with the original parked, and the scope rules that govern every other
 * write on a campaign govern this one too.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/**
 * A real photograph — the SAME fixture the property-image suite uses.
 *
 * A one-pixel PNG was tried first and refused with «Images must be at least 400x400 pixels», which
 * is the pipeline doing its job: a creative below the served width would be upscaled, and the
 * pipeline never upscales. Reusing the listing fixture keeps «what counts as an image» answered in
 * one place rather than two.
 */
const PHOTO = readFileSync(
  join(import.meta.dirname, '..', '..', '..', '..', 'e2e', 'fixtures', 'room-one.jpg'),
);

describeIfDb('a campaign creative', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /** What was handed to storage, so «before the row» can be asserted rather than assumed. */
  let stored: { key: string; bytes: number }[] = [];
  let enqueued: Record<string, unknown>[] = [];

  const storage = {
    put: (key: string, body: Buffer) => {
      stored.push({ key, bytes: body.length });

      return Promise.resolve();
    },
    /* `ImageService.publicUrl` delegates here — the real one builds it from `S3_PUBLIC_URL`. */
    publicUrl: (key: string) => `https://media.test/${key}`,
  };
  const queue = {
    /* The OPTIONS are recorded too: the job id lives there, and it is what the replace case turns on. */
    add: (
      _name: string,
      data: Record<string, unknown>,
      options: Record<string, unknown>,
    ) => {
      enqueued.push({ ...data, jobId: options['jobId'] });

      return Promise.resolve();
    },
  };

  const creative = new AdCreativeService(
    db,
    new AuditService(db),
    new ImageService(storage as never),
    storage as never,
    queue as never,
  );

  let reference = '';
  let cityId: string | null = null;
  let staffId = '';

  const staff = (scope?: string[]): AccessTokenClaims =>
    ({
      sub: staffId,
      role: scope ? 'operations_manager' : 'super_admin',
      permissions: ['ad.manage'],
      ...(scope ? { scope: { kind: 'cities', cityIds: scope, outside: 'none' } } : {}),
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();
    stored = [];
    enqueued = [];

    const made = await db.execute<{
      reference: string;
      city_id: string;
      staff: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL ORDER BY id LIMIT 1) AS city_id
      ), st AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('crt-' || gen_random_uuid() || '@safra.test', '+963900000130',
                'super_admin', 'active')
        RETURNING id
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
      RETURNING reference, city_id::text, (SELECT id::text FROM st) AS staff
    `);

    const row = made.rows[0];

    if (!row) throw new Error('fixture campaign was not created');

    reference = row.reference;
    cityId = row.city_id;
    staffId = row.staff;
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /**
   * The whole reason this reuses `ImageService`: a file that is not a photograph never reaches
   * storage. Refused by its BYTES, not by its name or the `Content-Type` the client claimed.
   */
  it('refuses something that is not an image before anything is stored', async () => {
    await expect(
      creative.upload(staff(), reference, {
        buffer: Buffer.from('#!/bin/sh\necho not a photograph\n'),
        originalname: 'payload.png',
      }),
    ).rejects.toMatchObject({ response: {} });

    expect(stored, 'nothing was written to the object store').toStrictEqual([]);
    expect(enqueued, 'and nothing was queued').toStrictEqual([]);
  });

  /**
   * An accepted file: the original is parked FIRST, the row points at it, and the render is queued.
   *
   * The order is the assertion. Writing the row before the bytes would leave a campaign claiming a
   * creative that storage never received — the row is a promise, and it must not be made before it
   * can be kept.
   */
  it('parks the original, marks the row processing, and queues the render', async () => {
    const result = await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.png',
    });

    expect(result.status).toBe('processing');
    expect(
      result.url,
      'the address the variant will have — no widths are recorded yet',
    ).toContain(String(CREATIVE_WIDTH));

    expect(stored, 'exactly one object, under the private incoming prefix').toHaveLength(
      1,
    );
    expect(stored[0]?.key).toMatch(/^incoming\//);

    const row = await db.execute<{
      status: string;
      file_key: string | null;
      original_key: string | null;
    }>(sql`
      SELECT image_status::text AS status, image_file_key AS file_key,
             image_original_key AS original_key
      FROM ad_campaigns WHERE reference = ${reference}
    `);

    expect(row.rows[0]?.status).toBe('processing');
    expect(row.rows[0]?.file_key, 'the key is generated server-side').toMatch(
      /^ads\/ADS-\d+\//,
    );
    expect(row.rows[0]?.original_key, 'what a re-drive needs').toBe(stored[0]?.key);

    expect(enqueued, 'one render, addressed to THIS table').toHaveLength(1);
    expect(enqueued[0]?.['subject']).toBe('ad_campaign');
  });

  /**
   * REPLACING a creative queues a second render (Bashar, 2026-08-27).
   *
   * «I am trying to change the image now, but it keeps loading and nothing happens.»
   *
   * The job id was `mediaJobId(campaign.id)` — the ROW — copied from the listing pipeline, where it
   * is right because every upload inserts a new row. A campaign's creative lives ON the campaign,
   * so the id was identical for every upload against it, and completed jobs are retained for a DAY:
   * BullMQ knew the id, ignored the `add`, and answered as though it had queued. The API returned
   * 201, the row sat at `processing`, and the dialog spun for ever.
   *
   * Nothing anywhere reported a failure, which is why this is asserted on the JOB IDS rather than
   * on the row: the row looked identical in both the working and the broken case.
   */
  it('queues a second render when the image is replaced', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'first.jpg',
    });
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'second.jpg',
    });

    expect(enqueued, 'both uploads were queued').toHaveLength(2);

    const ids = enqueued.map((job) => job['jobId']);

    expect(new Set(ids).size, 'and with DIFFERENT ids, or the second is dropped').toBe(2);

    /* And the row points at the second file, not the first. */
    const row = await db.execute<{ file_key: string }>(sql`
      SELECT image_file_key AS file_key FROM ad_campaigns WHERE reference = ${reference}
    `);

    expect(enqueued[1]?.['fileKey']).toBe(row.rows[0]?.file_key);
  });

  /** §15 — who filed it, and what it was. */
  it('audits the upload', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.png',
    });

    const entry = await db.execute<{ actor: string; after: string }>(sql`
      SELECT actor_user_id::text AS actor, after::text AS after FROM audit_log
      WHERE action = 'ad_campaign.creative_uploaded' ORDER BY created_at DESC LIMIT 1
    `);

    expect(entry.rows[0]?.actor).toBe(staffId);
    expect(entry.rows[0]?.after, 'the filename, for support').toContain('creative.png');
  });

  /**
   * Scoped like every other write on a campaign — with its opposite control.
   *
   * A service that refused everybody would satisfy the refusal on its own, so the same call is made
   * from inside the scope and must succeed.
   */
  it('refuses a campaign in another city, and accepts one in its own', async () => {
    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE id <> ${cityId}::uuid AND deleted_at IS NULL LIMIT 1
    `);

    await expect(
      creative.upload(staff([elsewhere.rows[0]?.id ?? '']), reference, {
        buffer: PHOTO,
        originalname: 'creative.png',
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.CAMPAIGN_NOT_FOUND } });

    expect(stored, 'refused before the bytes were written').toStrictEqual([]);

    const allowed = await creative.upload(staff([cityId ?? '']), reference, {
      buffer: PHOTO,
      originalname: 'creative.png',
    });

    expect(allowed.status).toBe('processing');
  });
  /**
   * ── taking the picture off, and keeping the campaign ─────────────────────
   *
   * Bashar, 2026-08-27: «I should be also able to remove the current image and keep the الإعلان
   * without an image.» The campaign must survive intact — this is a return to the state every
   * campaign starts in, not a deletion of anything.
   *
   * Asserted as a PAIR: every image column is cleared AND the campaign is still there, live, with
   * its headline. Checking only the first would pass just as well against a `DELETE FROM
   * ad_campaigns`, which is the accident this route is one typo away from.
   */
  it('clears the picture and leaves the campaign standing', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.jpg',
    });

    const before = await row();

    expect(
      before.image_file_key,
      'the fixture actually has a picture to remove',
    ).not.toBeNull();

    expect(await creative.remove(staff(), reference)).toStrictEqual({ removed: true });

    const after = await row();

    /* Every column, not the one the screen happens to read — a stale width is a lie too. */
    expect(after.image_file_key).toBeNull();
    expect(after.image_status).toBeNull();
    expect(after.image_width).toBeNull();
    expect(after.image_height).toBeNull();
    expect(after.image_variant_widths).toBeNull();
    expect(after.image_original_key).toBeNull();
    expect(after.image_failure_code).toBeNull();

    /* And the campaign itself is untouched. */
    expect(after.status, 'the campaign is still live').toBe('active');
    expect(after.headline_ar, 'and still says what it said').toBe('عنوان');
  });

  /** What was removed stays answerable, because the bytes are kept and the row is not. */
  it('records what stopped being served', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.jpg',
    });

    const key = (await row()).image_file_key;

    await creative.remove(staff(), reference);

    /*
      Scoped to THIS campaign. Written against the whole table first, which passed alone and failed
      inside `pnpm verify`: `audit_log` is append-only and the browser suite really removes a
      creative, so rows from earlier runs are committed and visible from inside this rollback
      transaction. A test that reads a shared append-only table has to name its own subject.
    */
    const audited = await db.execute<{ before: { fileKey?: string } | null }>(sql`
      SELECT a.before FROM audit_log a
      JOIN ad_campaigns c ON c.id = a.subject_id
      WHERE a.action = 'ad_campaign.creative_removed' AND c.reference = ${reference}
      ORDER BY a.created_at DESC LIMIT 1
    `);

    expect(
      audited.rows[0]?.before?.fileKey,
      'the audit names the key it stopped serving',
    ).toBe(key);
  });

  /**
   * Removing a picture that is not there succeeds and writes NOTHING.
   *
   * An audit trail carrying a removal that removed nothing is a record of an event that did not
   * happen — the same objection that stops an empty PATCH being sent at all.
   */
  it('is idempotent, and does not audit a removal that removed nothing', async () => {
    expect(await creative.remove(staff(), reference)).toStrictEqual({ removed: false });

    /* This campaign's rows, for the reason the case above gives. */
    const audited = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM audit_log a
      JOIN ad_campaigns c ON c.id = a.subject_id
      WHERE a.action = 'ad_campaign.creative_removed' AND c.reference = ${reference}
    `);

    expect(audited.rows[0]?.n).toBe('0');
  });

  /**
   * Removing MID-RENDER does not come back.
   *
   * The upload leaves the row `processing` with a worker job in flight. The worker claims its work
   * with `WHERE image_status = 'processing'`, so a row cleared underneath it fails the claim and
   * the job exits without writing — which is why remove is offered while a render is running. If
   * that guard were ever dropped, the picture would reappear seconds after somebody removed it.
   */
  it('stays removed even though a render was in flight', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.jpg',
    });

    expect((await row()).image_status, 'the render is in flight').toBe('processing');

    await creative.remove(staff(), reference);

    /* The claim the worker would make, run here rather than mocking the processor. */
    const claimed = await db.execute<{ id: string }>(sql`
      UPDATE ad_campaigns SET updated_at = now()
      WHERE reference = ${reference} AND image_status = 'processing'
      RETURNING id
    `);

    expect(claimed.rows, 'the worker finds nothing to claim').toStrictEqual([]);
    expect((await row()).image_file_key).toBeNull();
  });

  /** Out of scope answers exactly as absent — the same shape every other write on a campaign has. */
  it('refuses a campaign in a city this reader cannot see', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.jpg',
    });

    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL AND id <> ${cityId}::uuid LIMIT 1
    `);
    const other = elsewhere.rows[0]?.id;

    if (!other) throw new Error('the fixture needs a second city');

    await expect(creative.remove(staff([other]), reference)).rejects.toMatchObject({
      response: { code: ERROR.CAMPAIGN_NOT_FOUND },
    });

    /* The control: the picture is still there, so the refusal withheld rather than failed. */
    expect((await row()).image_file_key).not.toBeNull();
  });

  /**
   * A reader who may LOOK at this campaign but not change it is refused the write, not the row.
   *
   * `outside: 'read_only'` means «the rest of the country is visible and not editable», so the
   * scope has to be pinned to a DIFFERENT city for this campaign to fall outside it. Written the
   * other way round first, which asserted nothing: the campaign was inside `cityIds`, the reader
   * had full write access to it, and the removal simply succeeded.
   */
  it('refuses a reader who may look but not change', async () => {
    await creative.upload(staff(), reference, {
      buffer: PHOTO,
      originalname: 'creative.jpg',
    });

    const elsewhere = await db.execute<{ id: string }>(sql`
      SELECT id::text FROM cities WHERE deleted_at IS NULL AND id <> ${cityId}::uuid LIMIT 1
    `);
    const other = elsewhere.rows[0]?.id;

    if (!other) throw new Error('the fixture needs a second city');

    const readOnly = {
      sub: staffId,
      role: 'operations_manager',
      permissions: ['ad.manage'],
      scope: { kind: 'cities', cityIds: [other], outside: 'read_only' },
    } as unknown as AccessTokenClaims;

    await expect(creative.remove(readOnly, reference)).rejects.toMatchObject({
      response: { code: ERROR.SCOPE_OUTSIDE },
    });

    expect((await row()).image_file_key).not.toBeNull();
  });

  /** The campaign row as it stands, so each case asserts against the database and not a return value. */
  async function row(): Promise<{
    image_file_key: string | null;
    image_status: string | null;
    image_width: number | null;
    image_height: number | null;
    image_variant_widths: number[] | null;
    image_original_key: string | null;
    image_failure_code: string | null;
    status: string;
    headline_ar: string;
  }> {
    const found = await db.execute<{
      image_file_key: string | null;
      image_status: string | null;
      image_width: number | null;
      image_height: number | null;
      image_variant_widths: number[] | null;
      image_original_key: string | null;
      image_failure_code: string | null;
      status: string;
      headline_ar: string;
    }>(sql`
      SELECT image_file_key, image_status, image_width, image_height, image_variant_widths,
             image_original_key, image_failure_code, status::text, headline_ar
      FROM ad_campaigns WHERE reference = ${reference}
    `);

    const only = found.rows[0];

    if (!only) throw new Error('the fixture campaign is gone');

    return only;
  }
});
