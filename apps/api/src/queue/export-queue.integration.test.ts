import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Queue, Worker } from 'bullmq';
import { Redis } from 'ioredis';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR, PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { BookingExportService } from '../admin/booking-export.service.js';
import { ExportRequestService } from '../admin/export-request.service.js';
import { DeadLetterService } from './dead-letter.service.js';
import { ExportProcessor } from './export.processor.js';
import type { StorageService } from '../storage/storage.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * The `exports` queue: asking for a CSV, a worker building it, and collecting it.
 *
 * ## The two properties worth a real worker
 *
 * **Scope is re-derived on the far side.** The job payload is a row id, so the file's contents are
 * decided by the requester's city scope AS IT IS WHEN THE WORKER RUNS. That is not a detail: carried
 * in the payload, an export queued a minute before somebody's access was revoked would hand them the
 * data a minute after. A double cannot prove it, because the whole question is what happens across
 * the boundary.
 *
 * **A download is refused until there is something to download.** `queued`, `running`, `failed` and
 * expired are four different answers, and an operator gets a code they can read for each.
 *
 * ## Its own queue prefix, obliterated afterwards
 *
 * `safra-test-<random>` rather than `safra`, so a test run cannot consume a job the development API
 * enqueued, and a worker left running by `pnpm worker` cannot consume a test's.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const REDIS_URL = process.env['REDIS_URL'];
const describeIfReady = DATABASE_URL && REDIS_URL ? describe : describe.skip;

const SETTLE_MS = 15_000;

describeIfReady('the exports queue', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const objects = new Map<string, Buffer>();
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

  let connection: Redis;
  let queue: Queue;
  let worker: Worker;
  let prefix = '';
  let requests: ExportRequestService;
  let staffUserId = '';

  const staff = (): AccessTokenClaims => ({
    sub: staffUserId,
    role: 'operations_manager',
    permissions: [P.BOOKING_READ_ALL],
    locale: 'ar',
    totpEnabled: true,
  });

  beforeEach(async () => {
    await harness.begin();
    objects.clear();

    staffUserId = await seedStaff();

    prefix = `safra-test-${Math.random().toString(36).slice(2, 10)}`;
    connection = new Redis(REDIS_URL ?? '', { maxRetriesPerRequest: null });
    queue = new Queue('exports', { connection, prefix });

    const audit = new AuditService(db);
    const exports = new BookingExportService(db, audit);

    requests = new ExportRequestService(db, audit, storage, queue);

    const processor = new ExportProcessor(
      db,
      exports,
      storage,
      new DeadLetterService(db),
    );

    worker = new Worker('exports', (job) => processor.process(job), {
      connection,
      prefix,
      concurrency: 1,
    });

    worker.on('failed', (job, error) => void processor.onFailed(job, error));
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

  const until = async (predicate: () => Promise<boolean>): Promise<boolean> => {
    const deadline = Date.now() + SETTLE_MS;

    while (Date.now() < deadline) {
      if (await predicate()) return true;

      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    return false;
  };

  const statusOf = async (reference: string): Promise<string | undefined> =>
    (
      await db.execute<{ status: string }>(sql`
        SELECT status::text AS status FROM export_jobs WHERE reference = ${reference}
      `)
    ).rows[0]?.status;

  // ─── The seam ──────────────────────────────────────────────────────────────

  /** Asking returns immediately, with nothing built and a row that says so. */
  it('returns a queued reference without building anything', async () => {
    const { reference, status } = await requests.request(staff(), {});

    expect(reference).toMatch(/^EXP-\d+$/);
    expect(status).toBe('queued');
    expect(objects.size, 'no file exists yet').toBe(0);
  });

  /** And the worker turns it into a file the operator can collect. */
  it('builds the CSV and makes it downloadable', { timeout: 30_000 }, async () => {
    const { reference } = await requests.request(staff(), {});

    expect(
      await until(async () => (await statusOf(reference)) === 'ready'),
      'the row reached ready',
    ).toBe(true);

    const file = await requests.download(staff(), reference);

    expect(file.filename).toBe(`${reference}.csv`);
    /*
      A UTF-8 BOM. Without it Excel on Windows reads the file as the system codepage and every
      Arabic property name becomes mojibake — which is most of this file's content.
    */
    expect(file.csv.toString('utf8').startsWith('﻿')).toBe(true);
  });

  // ─── What the operator is told before it is ready ──────────────────────────

  /** Four states, four answers — never a generic failure or an empty file. */
  it('refuses a download while the file is still being built', async () => {
    const { reference } = await requests.request(staff(), {});

    await expect(requests.download(staff(), reference)).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR.EXPORT_NOT_READY }),
    });
  });

  it('says so when the build failed', { timeout: 30_000 }, async () => {
    const { reference } = await requests.request(staff(), {});

    await db.execute(sql`
      UPDATE export_jobs SET status = 'failed', failure_code = ${ERROR.EXPORT_FAILED}
      WHERE reference = ${reference}
    `);

    await expect(requests.download(staff(), reference)).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR.EXPORT_FAILED }),
    });
  });

  /** An expired file is gone, and saying "not found" would send the operator hunting. */
  it('says so when the file has expired', { timeout: 30_000 }, async () => {
    const { reference } = await requests.request(staff(), {});

    expect(await until(async () => (await statusOf(reference)) === 'ready')).toBe(true);

    await db.execute(sql`
      UPDATE export_jobs SET expires_at = now() - INTERVAL '1 day'
      WHERE reference = ${reference}
    `);

    await expect(requests.download(staff(), reference)).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR.EXPORT_EXPIRED }),
    });
  });

  // ─── Whose file it is ──────────────────────────────────────────────────────

  /**
   * Somebody else's export is a 404, never a 403.
   *
   * The two must be indistinguishable, or `EXP-` — which is sequential — becomes a way to discover
   * how many exports exist and when. This is the same boundary every other reference lookup holds.
   */
  it('hides another operator´s export behind the same 404 as a missing one', async () => {
    const { reference } = await requests.request(staff(), {});
    const stranger = { ...staff(), sub: await seedStaff() };

    await expect(requests.download(stranger, reference)).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR.EXPORT_NOT_FOUND }),
    });

    await expect(requests.download(stranger, 'EXP-999999')).rejects.toMatchObject({
      response: expect.objectContaining({ code: ERROR.EXPORT_NOT_FOUND }),
    });
  });

  /** And the list is scoped the same way, in the WHERE clause rather than afterwards. */
  it('lists only this operator´s own exports', async () => {
    const mine = await requests.request(staff(), {});
    const stranger = { ...staff(), sub: await seedStaff() };

    await requests.request(stranger, {});

    const page = await requests.list(staff(), { page: 1, limit: 50 });

    expect(page.items.map((row) => row.reference)).toContain(mine.reference);
    expect(page.items).toHaveLength(1);
  });

  // ─── The audit trail ───────────────────────────────────────────────────────

  /**
   * Two events, not one.
   *
   * Asking for a file and collecting it are different acts by possibly different people, and the
   * synchronous version could only record one — before the response, so an abandoned download still
   * counted as an export.
   */
  it(
    'records the request and the collection separately',
    { timeout: 30_000 },
    async () => {
      const { reference } = await requests.request(staff(), { status: 'confirmed' });

      expect(await auditCount('booking.export_requested')).toBeGreaterThan(0);
      expect(await auditCount('booking.exported'), 'nothing collected yet').toBe(0);

      expect(await until(async () => (await statusOf(reference)) === 'ready')).toBe(true);

      await requests.download(staff(), reference);

      expect(await auditCount('booking.exported')).toBeGreaterThan(0);
    },
  );

  // ─── Fixtures ──────────────────────────────────────────────────────────────

  const auditCount = async (action: string): Promise<number> =>
    Number(
      (
        await db.execute<{ count: string }>(sql`
          SELECT count(*)::text AS count FROM audit_log
          WHERE action = ${action} AND actor_user_id = ${staffUserId}::uuid
        `)
      ).rows[0]?.count ?? 0,
    );

  /** One staff account, so an export has somebody to belong to. */
  async function seedStaff(): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('exp-' || gen_random_uuid() || '@safra.test', '+963900000078',
              'operations_manager', 'active')
      RETURNING id
    `);

    const id = made.rows[0]?.id;

    if (!id) throw new Error('Staff fixture produced no row.');

    return id;
  }
});
