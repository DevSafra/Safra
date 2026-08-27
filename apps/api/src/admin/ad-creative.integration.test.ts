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
    add: (_name: string, data: Record<string, unknown>) => {
      enqueued.push(data);

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
    expect(result.url, 'the address the variant will have').toContain(
      String(CREATIVE_WIDTH),
    );

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
});
