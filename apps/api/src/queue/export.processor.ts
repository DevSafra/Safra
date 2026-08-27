import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { BookingExportService } from '../admin/booking-export.service.js';
import { ExportRequestService } from '../admin/export-request.service.js';
import { StorageService } from '../storage/storage.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { QUEUE } from './queue.definitions.js';
import { DeadLetterService } from './dead-letter.service.js';
import { EXPORT_JOB, type ExportJobData } from './export.job.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * Where a built CSV lives.
 *
 * `exports/`, outside the `properties/*` anonymous-read grant — the same reasoning as `incoming/`
 * and a stronger case: this is not one stranger's photograph, it is every booking a filter matched,
 * with customer names in it. It is fetched through the API by an authorised caller whose download
 * writes an audit row, never by a URL that works for anybody holding it.
 */
const EXPORT_PREFIX = 'exports';

/**
 * The `exports` queue's worker-side body.
 *
 * ## Authorisation is REBUILT here, never carried
 *
 * The job payload is a row id and nothing else. This processor reads who asked from the row, and
 * their city scope from `users` and `staff_scope_cities` — as they stand NOW, not as they stood
 * when the request was made. That is the whole reason claims are not in the payload: a job queued
 * one minute before somebody's access was revoked must not hand them the data a minute after.
 *
 * The scope is then applied by the same `scopeFilter` the synchronous export used, through the same
 * `BookingExportService`. There is one query that decides what an export contains, and it is not
 * here.
 *
 * ## Why a failed export is not retried three times by default
 *
 * It is — `exports` declares two attempts — but the interesting case is the one that cannot
 * succeed: a filter matching nothing, a requester who was archived. Those fail identically twice
 * and then dead-letter, which is right, because the row goes `failed` with a code the operator can
 * read and act on. `docs/background-jobs-design.md` puts it exactly: "User-visible; failure must
 * reach the person who asked."
 */
@Injectable()
export class ExportProcessor {
  private readonly logger = new Logger(ExportProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly exports: BookingExportService,
    private readonly storage: StorageService,
    private readonly deadLetters: DeadLetterService,
  ) {}

  /** Runs one job. Throws to request a retry. */
  async process(job: Job<ExportJobData>): Promise<void> {
    if (job.name !== EXPORT_JOB) {
      /* Deploy skew — an older worker meeting a job a newer API enqueued. Retrying cannot help. */
      throw new Error(`Unknown job name on the ${QUEUE.exports} queue: ${job.name}`);
    }

    const { exportId } = job.data;

    /*
      Claimed, not just read.

      `UPDATE … WHERE status IN ('queued','running') RETURNING` makes a redelivery harmless and
      also moves the row to `running` in the same statement — which is the state the operator sees,
      and the difference between "waiting" and "working" on a file that takes minutes.
    */
    const claimed = await this.db.execute<{
      requested_by: string;
      filters: Record<string, string | null>;
      reference: string;
    }>(sql`
      UPDATE export_jobs SET status = 'running'
      WHERE id = ${exportId}::uuid AND status IN ('queued', 'running')
      RETURNING requested_by_user_id AS requested_by, filters, reference
    `);

    const row = claimed.rows[0];

    if (!row) {
      this.logger.log(`Export ${exportId} is already finished; nothing to do.`);

      return;
    }

    const actor = await this.actorFor(row.requested_by);

    if (!actor) {
      /*
        Terminal, and deliberately not a retry: the requester is gone or archived, and no number of
        attempts brings back the authorisation this file depended on.
      */
      await this.fail(exportId, ERROR.EXPORT_FAILED);
      this.logger.error(`Export ${row.reference}: the requester no longer exists.`);

      return;
    }

    /*
      The same service the synchronous endpoint used, unchanged — including `scopeFilter`, which is
      what makes this file contain only what its requester may see.

      `audit: false`: the request already wrote `booking.export_requested`, and the download writes
      `booking.exported`. A third row here would record an export that nobody has yet received.
    */
    const built = await this.exports.toCsv(actor, {
      q: row.filters['q'] ?? undefined,
      status: row.filters['status'] ?? undefined,
      audit: false,
    });

    const fileKey = `${EXPORT_PREFIX}/${row.reference}.csv`;

    await this.storage.put(
      fileKey,
      Buffer.from(built.csv, 'utf8'),
      'text/csv; charset=utf-8',
    );

    await this.db.execute(sql`
      UPDATE export_jobs
      SET status = 'ready',
          row_count = ${built.rowCount},
          file_key = ${fileKey},
          failure_code = NULL,
          expires_at = now() + (${ExportRequestService.retentionDays}::int * INTERVAL '1 day')
      WHERE id = ${exportId}::uuid
    `);

    this.logger.log(`Export ${row.reference} ready: ${built.rowCount} rows.`);
  }

  /**
   * Called on every failed attempt; acts only on the last one.
   *
   * Marking the row `failed` on the first attempt would tell an operator their export died while a
   * retry was already on its way to succeeding.
   */
  async onFailed(job: Job<ExportJobData> | undefined, error: Error): Promise<void> {
    if (!job) {
      this.logger.error(
        `An ${QUEUE.exports} job failed before it could be read: ${describeError(error)}`,
      );

      return;
    }

    const attempts = job.opts.attempts ?? 1;

    if (job.attemptsMade < attempts) return;

    await this.fail(job.data.exportId, ERROR.EXPORT_FAILED);

    await this.deadLetters.record({
      queue: QUEUE.exports,
      name: job.name,
      jobId: String(job.id ?? ''),
      /* One row id. Nothing a person typed, no customer data, nothing to redact. */
      payload: job.data,
      error,
      attempts: job.attemptsMade,
    });
  }

  /**
   * The requester, as an actor, with their scope AS IT IS NOW.
   *
   * Assembled from the database rather than from anything the job carried — see the class note.
   * `permissions` is deliberately left empty: `BookingExportService` reads only `scope`, and an
   * actor synthesised here must not be able to satisfy a permission check somewhere it is passed
   * to later.
   */
  private async actorFor(userId: string): Promise<AccessTokenClaims | undefined> {
    const found = await this.db.execute<{
      role: string;
      kind: string;
      outside: string;
      city_ids: string[] | null;
    }>(sql`
      SELECT u.role::text AS role,
             u.scope_kind::text           AS kind,
             u.outside_scope_access::text AS outside,
             (
               SELECT array_agg(sc.city_id)
               FROM staff_scope_cities sc
               WHERE sc.user_id = u.id
             ) AS city_ids
      FROM users u
      WHERE u.id = ${userId}::uuid
        AND u.deleted_at IS NULL
        /* Archived or suspended is the same answer as gone: the file is not built. */
        AND u.status = 'active'
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) return undefined;

    return {
      sub: userId,
      role: row.role,
      permissions: [],
      locale: 'ar',
      totpEnabled: true,
      scope:
        row.kind === 'cities'
          ? {
              kind: 'cities',
              cityIds: row.city_ids ?? [],
              outside: row.outside,
            }
          : { kind: 'all_cities', cityIds: [], outside: row.outside },
    } as AccessTokenClaims;
  }

  /** Marks one export dead with a code the operator can read in their own language. */
  private async fail(exportId: string, code: string): Promise<void> {
    try {
      await this.db.execute(sql`
        UPDATE export_jobs
        SET status = 'failed', failure_code = ${code}
        WHERE id = ${exportId}::uuid AND status <> 'ready'
      `);
    } catch (error) {
      /*
        Swallowed: this runs inside BullMQ's `failed` event, where an unhandled rejection takes the
        worker process down — and with it every other queue on the host.
      */
      this.logger.error(
        `Could not mark export ${exportId} failed: ` + `${describeError(error)}`,
      );
    }
  }
}
