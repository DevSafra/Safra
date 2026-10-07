import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { JobRunService } from '../common/jobs/job-run.service.js';
import { describeError } from '../common/errors/safe-error.js';
import { exportFileKey } from '../queue/export.job.js';
import { StorageService } from '../storage/storage.service.js';
import { ExportRequestService } from './export-request.service.js';

/** Its own advisory-lock key — see `SlaService` for what sharing one costs. */
const EXPORT_RETENTION_LOCK_KEY = 8_421_011;

/** Per pass, so a backlog after an outage is worked through over nights rather than in one go. */
const BATCH = 500;

/**
 * Deletes booking exports once their seven days are up — the half `RETENTION_DAYS` never had.
 *
 * ## The promise this keeps
 *
 * الخصوصية tells customers «ملفات التصدير التي يطلبها الموظفون تُحذف بعد سبعة أيام», and
 * `ExportRequestService` stopped SERVING a file after seven days. Nothing deleted one. Every CSV
 * ever built was still in the bucket, each one every booking a filter matched with the customer's
 * name beside it, and the download refusing to hand it out is a statement about one route, not
 * about where the data is. A bucket misconfiguration would have published all of them.
 *
 * ## The file is deleted; the row is archived
 *
 * The bytes are the customer data and they go. The row is a record that somebody ASKED for an
 * export, which the same page promises is never hard-deleted automatically: it gets `deleted_at`,
 * which takes it off تصدير الحجوزات and makes its download answer «not found», and loses its
 * `file_key`, so nothing points at an object that is no longer there.
 *
 * ## Storage first, then the row, and each is safe to repeat
 *
 * A row archived before its file is deleted is a file nobody will ever look for again. The other
 * way round, a crash between the two leaves an unarchived row whose file is already gone — and the
 * next pass deletes it again, which an object store answers with success, and archives it. So a
 * failed deletion keeps the row for the next night and is counted, never thrown: one bucket error
 * must not cost the other 499 rows their deletion.
 *
 * ## `failed` rows are swept too
 *
 * Their bytes may exist. The worker writes the file and THEN records it on the row, so an export
 * whose row update failed has a CSV in the bucket and no `file_key` — which is why the key is
 * derived from the reference by `exportFileKey` rather than read from the column. Dated from
 * `created_at`, because a failure never set `expires_at`.
 *
 * `queued` and `running` are left alone: a build could still finish, and archiving its row first
 * would leave the worker writing a file the sweep has already decided does not exist.
 */
@Injectable()
export class ExportRetentionService {
  private readonly logger = new Logger(ExportRetentionService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly storage: StorageService,
    private readonly runs: JobRunService,
  ) {}

  async sweep(): Promise<void> {
    await this.runs
      .runExclusively('export-retention', EXPORT_RETENTION_LOCK_KEY, () => this.prune())
      .catch((error: unknown) => {
        /* Recorded by `runExclusively` before it re-threw; the next night retries. */
        this.logger.error(`Export retention failed: ${describeError(error)}`);
      });
  }

  /** One pass. Exposed for the integration test, which cannot wait for the night. */
  async prune(): Promise<{ deleted: number; storageFailures: number }> {
    const due = await this.db.execute<{ id: string; reference: string }>(sql`
      SELECT id, reference
      FROM export_jobs
      WHERE deleted_at IS NULL
        AND status IN ('ready', 'failed')
        AND coalesce(
              expires_at,
              created_at + (${ExportRequestService.retentionDays}::int * INTERVAL '1 day')
            ) <= now()
      ORDER BY created_at
      LIMIT ${BATCH}
    `);

    let deleted = 0;
    let storageFailures = 0;

    for (const row of due.rows) {
      try {
        await this.storage.remove(exportFileKey(row.reference));
      } catch (error) {
        storageFailures += 1;
        this.logger.warn(
          `Export ${row.reference}: the file could not be deleted (${describeError(error)}). ` +
            'The row is kept and the next pass tries again.',
        );
        continue;
      }

      const archived = await this.db.execute(sql`
        UPDATE export_jobs
        SET deleted_at = now(), file_key = NULL
        WHERE id = ${row.id}::uuid AND deleted_at IS NULL
        RETURNING id
      `);

      deleted += archived.rows.length;
    }

    if (deleted > 0 || storageFailures > 0) {
      this.logger.log(
        `Deleted ${deleted} expired export file(s); ${storageFailures} could not be deleted.`,
      );
    }

    return { deleted, storageFailures };
  }
}
