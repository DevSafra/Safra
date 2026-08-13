import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PropertyImageService } from './property-images.service.js';
import type { ImageService } from '../storage/image.service.js';
import type { StorageService } from '../storage/storage.service.js';
import { createInlineMediaQueue } from '../queue/queue.testing.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Property photographs against a REAL PostgreSQL (§5.6, §7.2).
 *
 * ## What is worth proving here
 *
 * The cover is an INVARIANT — a property with images has exactly one — and it is maintained across
 * three separate operations plus a partial unique index. That is precisely the shape of rule that
 * a mocked database cannot see going wrong: before this service existed, archiving the cover left
 * a listing with photographs and no cover at all, and the card fell back to «لا صورة بعد» while
 * the gallery was full.
 *
 * `ImageService` is stubbed because the bytes are not the subject. What is asserted is the
 * bookkeeping around them; the processing pipeline (decode, re-encode, EXIF strip, variants) is
 * exercised by the upload path in the browser suite.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** The database's own refusal, unwrapped from drizzle's "Failed query: …" wrapper. */
async function refusal(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const parts: string[] = [];
    let current: unknown = error;

    while (current instanceof Error) {
      parts.push(current.message);
      current = current.cause;
    }

    return parts.join(' | ');
  }

  return 'NO ERROR — the statement was accepted';
}

describeIfDb('PropertyImageService', () => {
  /*
    A rollback handle: every row this suite writes is discarded when the test that wrote it ends.
    See `createRollbackDatabase` for why the wrapper sits on the connection rather than on drizzle.
  */
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /*
    A stub that records what it was asked to do and hands back a plausible key. The real service
    shells out to sharp; a test that re-encoded three variants per upload would spend its time
    measuring libvips.

    Since BullMQ phase 3 the upload path calls `inspect` and `keyFor` rather than `process` — the
    validation half and the naming half, with the encoding gone to a worker. `render` is absent on
    purpose: nothing in THIS suite should be able to reach it, and leaving it undefined means a
    regression that put encoding back in the request fails here rather than passing slowly.
  */
  let uploads = 0;
  const images = {
    inspect: () => Promise.resolve({ width: 1600, height: 1067, format: 'jpeg' }),
    keyFor: (options: { owner: string }) => {
      uploads += 1;

      return `properties/${options.owner}/img-${uploads}`;
    },
    incomingKeyFor: (fileKey: string) => `incoming/${fileKey.replaceAll('/', '_')}`,
    publicUrl: (key: string, width: number) => `https://media.test/${key}-${width}.webp`,
  } as unknown as ImageService;

  /** Records what was parked, so a test can assert the bytes went somewhere private first. */
  const stored = new Map<string, Buffer>();
  const storage = {
    put: (key: string, body: Buffer) => {
      stored.set(key, body);

      return Promise.resolve({ key, contentType: 'application/octet-stream', size: 0 });
    },
    get: (key: string) => Promise.resolve(stored.get(key) ?? null),
    remove: (key: string) => {
      stored.delete(key);

      return Promise.resolve();
    },
  } as unknown as StorageService;

  const mediaQueue = createInlineMediaQueue();

  const service = new PropertyImageService(
    db,
    images,
    storage,
    new AuditService(db),
    mediaQueue.queue,
  );

  let partnerId = '';
  let partnerUserId = '';
  let reference = '';
  let publishedReference = '';

  const partner = (id = partnerId): AccessTokenClaims => ({
    sub: partnerUserId,
    role: 'partner',
    permissions: [P.PROPERTY_MANAGE_OWN],
    locale: 'ar',
    totpEnabled: true,
    partnerId: id,
  });

  /** A partner with two properties: one draft to work on, one published to protect. */
  beforeEach(async () => {
    await harness.begin();

    /*
      The doubles are per FILE; the database is per TEST.

      `harness.begin()` opens a transaction that `afterEach` rolls back, so every row a test writes
      disappears — but `stored` and `mediaQueue` are ordinary objects created once at module scope
      and would carry one test's uploads into the next. The symptom is an assertion about "one job"
      failing with six, in a test that enqueued one, which reads as a bug in the code under test.
    */
    stored.clear();
    mediaQueue.jobs.length = 0;
    mediaQueue.jobIds.length = 0;

    const made = await db.execute<{
      partner_id: string;
      partner_user_id: string;
      draft_reference: string;
      published_reference: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM property_types LIMIT 1) AS type_id,
               (SELECT id FROM partner_types LIMIT 1) AS partner_type_id,
               (SELECT id FROM cancellation_policies LIMIT 1) AS policy_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('img-test-' || gen_random_uuid() || '@safra.test', '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT u.id, ref.partner_type_id, 'Image Test', 'Image Test', ref.city_id,
               'x', '+963900000000', 'img@safra.test', 'approved'
        FROM u, ref RETURNING id, user_id, city_id
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, ref.city_id, ref.type_id, ref.policy_id,
               'img-test-' || gen_random_uuid(), 'اختبار', 'Test', 'Test', 'x',
               (CASE WHEN n = 1 THEN 'draft' ELSE 'published' END)::property_status
        FROM generate_series(1, 2) AS n, pa, ref
        RETURNING reference, status, partner_id
      )
      SELECT pa.id AS partner_id, pa.user_id AS partner_user_id,
             (SELECT reference FROM pr WHERE status = 'draft') AS draft_reference,
             (SELECT reference FROM pr WHERE status = 'published') AS published_reference
      FROM pa
    `);

    const row = made.rows[0];

    partnerId = row?.partner_id ?? '';
    partnerUserId = row?.partner_user_id ?? '';
    reference = row?.draft_reference ?? '';
    publishedReference = row?.published_reference ?? '';
    uploads = 0;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const add = async (target = reference) =>
    service.upload(partner(), target, {
      buffer: Buffer.from('not really an image'),
      originalname: 'holiday snap.jpg',
    });

  describe('uploading', () => {
    it('makes the first image the cover, so a listing is never coverless', async () => {
      await add();

      const list = await service.list(partner(), reference);

      expect(list).toHaveLength(1);
      expect(list[0]?.isCover).toBe(true);
      expect(list[0]?.sortOrder).toBe(0);
    });

    it('does not make later images the cover', async () => {
      await add();
      await add();

      const list = await service.list(partner(), reference);

      expect(list.filter((image) => image.isCover)).toHaveLength(1);
      expect(list[0]?.isCover).toBe(true);
    });

    /**
     * The row an upload leaves behind is a PROMISE, and says so.
     *
     * Before BullMQ phase 3 this test asserted the rendered widths, because the request rendered
     * them. It cannot any more, and the honest replacement is the state the request actually
     * produces: dimensions known from the header, widths empty, status `processing`, and the
     * uploaded bytes parked under a key the public read policy does not cover. The widths are proved
     * on the other side of the queue, in `media-queue.integration.test.ts`, by running the worker.
     */
    it('leaves a processing row whose variants do not exist yet', async () => {
      const uploaded = await add();

      const list = await service.list(partner(), reference);

      expect(list[0]?.status).toBe('processing');
      expect(list[0]?.variantWidths).toEqual([]);
      /* From the header, so the gallery can reserve the right shape before the bytes arrive. */
      expect(list[0]?.width).toBe(1600);
      expect(uploaded.status).toBe('processing');
    });

    /**
     * The one moment the platform holds a file exactly as a stranger sent it.
     *
     * `incoming/`, never `properties/` — `bootstrap-media.ts` grants anonymous read on
     * `properties/*` and nothing else, so this prefix is the difference between an unvalidated
     * upload being unreachable and it being a URL away. Asserted rather than trusted, because the
     * prefix is a string in one method and nothing else would notice it changing.
     */
    it('parks the original outside the publicly readable prefix', async () => {
      await add();

      const parked = [...stored.keys()];

      expect(parked).toHaveLength(1);
      expect(parked[0]?.startsWith('incoming/')).toBe(true);
      expect(parked[0]?.startsWith('properties/')).toBe(false);
    });

    /** The job names the row, deterministically, so a retried request is not a second render. */
    it('enqueues exactly one render, keyed on the image row', async () => {
      const uploaded = await add();

      expect(mediaQueue.jobs).toHaveLength(1);
      expect(mediaQueue.jobs[0]?.imageId).toBe(uploaded.id);
      expect(mediaQueue.jobIds).toEqual([`image-${uploaded.id}`]);
    });

    it('refuses an empty upload', async () => {
      await expect(service.upload(partner(), reference, undefined)).rejects.toThrow();
    });

    /**
     * The regression: a new photograph goes at the END, after an archive has left a gap.
     *
     * The position used to be the live COUNT, and archiving does not renumber. Three images minus
     * the first two leaves one sitting at position 2 with a count of 1 — so the next upload took
     * position 1 and appeared BEFORE the image already there. A partner adding a photograph
     * watched it land in the middle of their gallery, and nothing on the screen explained why.
     */
    it('appends after an archive, rather than filling the gap it left', async () => {
      const first = await add();
      const second = await add();

      await add();

      /* Archive from the front, so the survivor keeps a position above the remaining count. */
      await service.archive(partner(), reference, first.id);
      await service.archive(partner(), reference, second.id);

      const survivor = await service.list(partner(), reference);

      expect(survivor).toHaveLength(1);
      expect(survivor[0]?.sortOrder).toBe(2);

      const added = await add();
      const list = await service.list(partner(), reference);

      expect(list).toHaveLength(2);
      /* Last in the list, and holding a position of its own rather than tying with the survivor. */
      expect(list[1]?.id).toBe(added.id);
      expect(list[1]?.sortOrder).toBe(3);
      expect(new Set(list.map((image) => image.sortOrder)).size).toBe(2);
    });
  });

  /**
   * The invariant: a property with images has exactly one cover.
   *
   * Three operations can break it and a partial unique index is the backstop. These assert each
   * path, and the last asserts the index itself — because a guarantee nothing has tried to violate
   * is a guarantee nobody has checked.
   */
  describe('the cover invariant', () => {
    it('promotes the next image when the cover is archived', async () => {
      const first = await add();
      await add();

      await service.archive(partner(), reference, first.id);

      const list = await service.list(partner(), reference);

      expect(list).toHaveLength(1);
      expect(list[0]?.isCover).toBe(true);
    });

    /*
      THE regression this service was extracted for. Archiving the cover used to leave the property
      with photographs and no cover, so the card said «لا صورة بعد» while the gallery was full.
    */
    it('never leaves a property with images and no cover', async () => {
      const first = await add();
      await add();
      await add();

      await service.archive(partner(), reference, first.id);

      const covers = (await service.list(partner(), reference)).filter((i) => i.isCover);

      expect(covers).toHaveLength(1);
    });

    it('moves the cover on request and clears the previous one', async () => {
      await add();
      const second = await add();

      await service.setCover(partner(), reference, second.id);

      const list = await service.list(partner(), reference);

      expect(list.filter((image) => image.isCover)).toHaveLength(1);
      expect(list.find((image) => image.isCover)?.id).toBe(second.id);
    });

    it('is enforced by the DATABASE, not only by the service', async () => {
      await add();
      const second = await add();

      const message = await refusal(
        db.execute(
          sql`UPDATE property_images SET is_cover = true WHERE id = ${second.id}`,
        ),
      );

      expect(message).toMatch(/property_images_one_cover/i);
    });

    /*
      An archived image keeps its `is_cover` value as a record of what the listing looked like at
      the time. The index is PARTIAL over live rows precisely so that record survives.
    */
    it('lets an archived cover keep its flag once a new cover exists', async () => {
      const first = await add();
      await add();

      await service.archive(partner(), reference, first.id);

      const archived = await db.execute<{ is_cover: boolean }>(
        sql`SELECT is_cover FROM property_images WHERE id = ${first.id}`,
      );

      expect(archived.rows[0]?.is_cover).toBe(true);
    });
  });

  describe('archiving', () => {
    it('soft deletes rather than removing the row (P-003)', async () => {
      const first = await add();
      await add();

      await service.archive(partner(), reference, first.id);

      const rows = await db.execute<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM property_images WHERE id = ${first.id}`,
      );

      expect(rows.rows[0]?.n).toBe(1);
    });

    /*
      A published listing without a photograph renders a placeholder to customers in search
      results, on the property page and in the confirmation email. Refused, with the remedy named.
    */
    it('refuses to archive the last image of a PUBLISHED listing', async () => {
      const only = await add(publishedReference);

      await expect(
        service.archive(partner(), publishedReference, only.id),
      ).rejects.toThrow();
    });

    it('allows it on a draft, which nobody is looking at', async () => {
      const only = await add();

      await expect(service.archive(partner(), reference, only.id)).resolves.toEqual({
        id: only.id,
        archived: true,
      });
    });

    it('refuses an image that is not on this property', async () => {
      await add();
      const other = await add(publishedReference);

      await expect(service.archive(partner(), reference, other.id)).rejects.toThrow();
    });
  });

  describe('reordering', () => {
    it('applies the given order', async () => {
      const a = await add();
      const b = await add();
      const c = await add();

      await service.reorder(partner(), reference, { imageIds: [c.id, a.id, b.id] });

      const list = await service.list(partner(), reference);

      expect(list.map((image) => image.id)).toEqual([c.id, a.id, b.id]);
    });

    /*
      A partial array is ambiguous — does an omitted image go last, or was it meant to be archived?
      Guessing either way silently changes what a customer sees, so it is refused.
    */
    it('refuses a partial list', async () => {
      const a = await add();
      await add();

      await expect(
        service.reorder(partner(), reference, { imageIds: [a.id] }),
      ).rejects.toThrow();
    });

    it('refuses a list naming an image from another property', async () => {
      const a = await add();
      const other = await add(publishedReference);

      await expect(
        service.reorder(partner(), reference, { imageIds: [a.id, other.id] }),
      ).rejects.toThrow();
    });

    it('does not change which image is the cover', async () => {
      const a = await add();
      const b = await add();

      await service.reorder(partner(), reference, { imageIds: [b.id, a.id] });

      const list = await service.list(partner(), reference);

      expect(list.find((image) => image.isCover)?.id).toBe(a.id);
    });
  });

  describe('alternative text', () => {
    it('stores it per locale', async () => {
      const image = await add();

      await service.setAlt(partner(), reference, image.id, {
        ar: 'غرفة نوم بإطلالة على البحر',
        en: 'Bedroom with a sea view',
      });

      const list = await service.list(partner(), reference);

      expect(list[0]?.alt).toEqual({
        ar: 'غرفة نوم بإطلالة على البحر',
        en: 'Bedroom with a sea view',
        de: null,
      });
    });

    it('refuses an image on another property', async () => {
      const other = await add(publishedReference);

      await expect(
        service.setAlt(partner(), reference, other.id, { ar: 'لا' }),
      ).rejects.toThrow();
    });
  });

  /**
   * Isolation, asserted from the outside.
   *
   * Another partner's reference must be indistinguishable from one that does not exist — a 404,
   * never a 403 — or the endpoint becomes a way to discover which references are real.
   */
  describe('isolation', () => {
    const stranger = (): AccessTokenClaims => ({
      ...partner(),
      partnerId: '00000000-0000-0000-0000-0000000000ff',
    });

    it('refuses to list another partner’s gallery', async () => {
      await add();

      await expect(service.list(stranger(), reference)).rejects.toThrow();
    });

    it('refuses to upload to another partner’s property', async () => {
      await expect(
        service.upload(stranger(), reference, {
          buffer: Buffer.from('x'),
          originalname: 'x.jpg',
        }),
      ).rejects.toThrow();
    });

    it('refuses to archive, reorder or re-cover another partner’s image', async () => {
      const image = await add();

      await expect(service.archive(stranger(), reference, image.id)).rejects.toThrow();
      await expect(service.setCover(stranger(), reference, image.id)).rejects.toThrow();
      await expect(
        service.reorder(stranger(), reference, { imageIds: [image.id] }),
      ).rejects.toThrow();
    });

    it('refuses a caller with no partner id at all', async () => {
      const orphan = { ...partner(), partnerId: undefined };

      await expect(service.list(orphan, reference)).rejects.toThrow();
    });
  });

  describe('the audit trail', () => {
    it('records an upload, an archive, a reorder and a cover change', async () => {
      const a = await add();
      const b = await add();

      await service.setCover(partner(), reference, b.id);
      await service.reorder(partner(), reference, { imageIds: [b.id, a.id] });
      await service.archive(partner(), reference, a.id);

      /*
        `ORDER BY id`, not `created_at`.

        `created_at` defaults to `now()`, and in PostgreSQL `now()` is the TRANSACTION timestamp —
        so every row this test writes shares one value, because the rollback harness runs the whole
        test inside a single transaction. Ordering by a column where all five rows tie leaves the
        order to the heap, which held insertion order until a loaded parallel run happened not to.

        `id` is `uuidv7()`: unique, and time-ordered by construction, so it is the sequence these
        events actually happened in.
      */
      const rows = await db.execute<{ action: string }>(sql`
        SELECT action FROM audit_log
        WHERE action LIKE 'property_image.%' AND actor_user_id = ${partnerUserId}
        ORDER BY id
      `);

      expect(rows.rows.map((row) => row.action)).toEqual([
        'property_image.uploaded',
        'property_image.uploaded',
        'property_image.cover_set',
        'property_image.reordered',
        'property_image.archived',
      ]);
    });
  });
});
