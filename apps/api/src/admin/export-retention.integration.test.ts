import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';

import { exportFileKey } from '../queue/export.job.js';
import { unlockedJobRuns } from '../common/jobs/job-run.testing.js';
import type { StorageService } from '../storage/storage.service.js';
import { ExportRetentionService } from './export-retention.service.js';

/**
 * Booking exports are deleted after seven days, as الخصوصية says they are.
 *
 * ## The defect
 *
 * `RETENTION_DAYS` stopped the download after seven days and nothing deleted anything: 573 files in
 * the development bucket were past their expiry on 2026-10-06, each one every booking a filter
 * matched with customers' names in it.
 *
 * ## What is asserted
 *
 * The FILE is gone from storage and the ROW is archived, for an expired `ready` export and for a
 * `failed` one whose bytes may exist without a `file_key`. Beside them, three that must be left
 * alone — inside their seven days, still building, already archived — so «nothing happened» cannot
 * pass for «it discriminated». A store that refuses a deletion keeps its row for the next pass, and
 * a second pass over the same rows deletes nothing more.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('deleting booking exports past their seven days', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const objects = new Map<string, Buffer>();
  const removed: string[] = [];
  /** Keys the store refuses to delete, as a bucket having a bad minute would. */
  const refusing = new Set<string>();

  const storage = {
    remove: (key: string) => {
      if (refusing.has(key)) return Promise.reject(new Error('503 Slow Down'));

      removed.push(key);
      objects.delete(key);

      return Promise.resolve();
    },
  } as unknown as StorageService;

  let service: ExportRetentionService;
  let requester = '';

  beforeEach(async () => {
    await harness.begin();
    objects.clear();
    removed.length = 0;
    refusing.clear();

    /*
      The development database's own exports, settled INSIDE the rollback: the sweep is global, and
      every count below is about the rows this test writes.
    */
    await db.execute(
      sql`UPDATE export_jobs SET deleted_at = now() WHERE deleted_at IS NULL`,
    );

    service = new ExportRetentionService(db, storage, unlockedJobRuns(db));
    requester = await aStaffMember();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('deletes the file and archives the row once an export has expired', async () => {
    const expired = await anExport({ status: 'ready', daysOld: 8, expiresInDays: -1 });

    const result = await service.prune();

    expect(result).toEqual({ deleted: 1, storageFailures: 0 });
    expect(removed).toEqual([exportFileKey(expired.reference)]);
    expect(objects.has(exportFileKey(expired.reference))).toBe(false);
    expect(await stateOf(expired.id)).toEqual({ archived: true, file_key: null });
  });

  /**
   * A FAILED export's bytes may exist — the worker writes the file before recording it — so its
   * deterministic key is deleted too, dated from its creation since it has no expiry.
   */
  it('deletes a failed export past seven days, by the key its file would have', async () => {
    const failed = await anExport({ status: 'failed', daysOld: 8, expiresInDays: null });

    expect((await service.prune()).deleted).toBe(1);
    expect(removed).toEqual([exportFileKey(failed.reference)]);
    expect((await stateOf(failed.id))?.archived).toBe(true);
  });

  /** The discrimination, all in one test so each «left alone» sits beside a «deleted». */
  it('leaves alone everything still inside its window or still being built', async () => {
    const expired = await anExport({ status: 'ready', daysOld: 9, expiresInDays: -2 });
    const fresh = await anExport({ status: 'ready', daysOld: 1, expiresInDays: 6 });
    const building = await anExport({
      status: 'running',
      daysOld: 30,
      expiresInDays: null,
    });
    const recentFailure = await anExport({
      status: 'failed',
      daysOld: 2,
      expiresInDays: null,
    });

    expect((await service.prune()).deleted, 'exactly the one expired export').toBe(1);
    expect(removed).toEqual([exportFileKey(expired.reference)]);

    for (const kept of [fresh, building, recentFailure]) {
      expect((await stateOf(kept.id))?.archived, kept.reference).toBe(false);
      expect(objects.has(exportFileKey(kept.reference)), kept.reference).toBe(true);
    }
  });

  /**
   * A deletion the store refused keeps its row, so the next pass tries again — and one refusal does
   * not cost the rest of the batch their deletion.
   */
  it('keeps the row for the next pass when the store refuses to delete', async () => {
    const stuck = await anExport({ status: 'ready', daysOld: 10, expiresInDays: -3 });
    const other = await anExport({ status: 'ready', daysOld: 9, expiresInDays: -2 });

    refusing.add(exportFileKey(stuck.reference));

    expect(await service.prune()).toEqual({ deleted: 1, storageFailures: 1 });
    expect((await stateOf(stuck.id))?.archived).toBe(false);
    expect((await stateOf(other.id))?.archived).toBe(true);

    refusing.clear();

    expect(await service.prune()).toEqual({ deleted: 1, storageFailures: 0 });
    expect((await stateOf(stuck.id))?.archived).toBe(true);
  });

  it('deletes nothing more when it runs again', async () => {
    await anExport({ status: 'ready', daysOld: 8, expiresInDays: -1 });

    expect((await service.prune()).deleted).toBe(1);
    expect(await service.prune()).toEqual({ deleted: 0, storageFailures: 0 });
    expect(removed).toHaveLength(1);
  });

  /** Through the scheduled entry point, so the run the runbook reads is written under its name. */
  it('records its run as export-retention', async () => {
    await anExport({ status: 'ready', daysOld: 8, expiresInDays: -1 });

    await service.sweep();

    const run = await db.execute<{ status: string; detail: { deleted: number } }>(sql`
      SELECT status::text AS status, detail FROM scheduled_job_runs
      WHERE job = 'export-retention' ORDER BY finished_at DESC LIMIT 1
    `);

    expect(run.rows[0]?.status).toBe('completed');
    expect(run.rows[0]?.detail.deleted).toBe(1);
  });

  // ─── Fixtures ──────────────────────────────────────────────────────────────

  /** One export row, aged as the case needs, with its file in the store. */
  async function anExport(options: {
    status: 'ready' | 'failed' | 'running';
    daysOld: number;
    expiresInDays: number | null;
  }): Promise<{ id: string; reference: string }> {
    const made = await db.execute<{ id: string; reference: string }>(sql`
      INSERT INTO export_jobs (requested_by_user_id, kind, filters, status, created_at,
                               expires_at)
      VALUES (${requester}::uuid, 'bookings', '{}'::jsonb, ${options.status}::export_status,
              now() - (${options.daysOld}::int * INTERVAL '1 day'),
              ${
                options.expiresInDays === null
                  ? null
                  : sql`now() + (${options.expiresInDays}::int * INTERVAL '1 day')`
              })
      RETURNING id, reference
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Export fixture produced no row.');

    const key = exportFileKey(row.reference);

    /* A `failed` row carries no key even when its bytes were written — see the service note. */
    if (options.status !== 'failed') {
      await db.execute(
        sql`UPDATE export_jobs SET file_key = ${key} WHERE id = ${row.id}::uuid`,
      );
    }

    objects.set(key, Buffer.from('reference,customer\n'));

    return row;
  }

  const stateOf = async (id: string) =>
    (
      await db.execute<{ archived: boolean; file_key: string | null }>(sql`
        SELECT deleted_at IS NOT NULL AS archived, file_key
        FROM export_jobs WHERE id = ${id}::uuid
      `)
    ).rows[0];

  async function aStaffMember(): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status)
      VALUES ('exp-ret-' || gen_random_uuid() || '@safra.test', '+963900000079',
              'operations_manager', 'active')
      RETURNING id
    `);

    const id = made.rows[0]?.id;

    if (!id) throw new Error('Staff fixture produced no row.');

    return id;
  }
});
