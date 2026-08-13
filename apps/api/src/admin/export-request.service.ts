import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  COUNT_CAP,
  ERROR,
  PERMISSIONS as P,
  offsetPage,
  type PageQuery,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { EXPORT_JOB, exportJobId } from '../queue/export.job.js';
import { JOB_OPTIONS } from '../queue/queue.definitions.js';
import { EXPORTS_QUEUE } from '../queue/queue.tokens.js';
import { StorageService } from '../storage/storage.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, forbidden, notFound } from '../common/errors/app-error.js';

/** `EXP-000112`. Bounded before it reaches a query; the lookup is parameterised regardless. */
const REFERENCE_PATTERN = /^EXP-\d{1,12}$/;

/**
 * How long a built CSV stays downloadable.
 *
 * Seven days rather than forever. A booking export is the largest concentration of customer data
 * this platform produces, and an object that outlives the reason it was made is a breach waiting
 * for a bucket misconfiguration. Long enough that somebody who requested one on Friday can collect
 * it on Monday.
 */
const RETENTION_DAYS = 7;

type ExportRow = {
  reference: string;
  kind: string;
  status: string;
  row_count: number | null;
  filters: Record<string, string | null>;
  failure_code: string | null;
  requested_by: string;
  requested_by_email: string;
  created_at: string;
  expires_at: string | null;
};

/**
 * تصدير الحجوزات — asking for a CSV, and coming back for it.
 *
 * ## What changed, and why the cap could go
 *
 * The export used to be built inside `GET /admin/bookings/export` and streamed back, capped at
 * 20,000 rows **because** it was synchronous — an operator exporting a busy quarter received a
 * truncated file with a comment at the bottom explaining that it was one. Rule 2 names exports among
 * the work that must not block a request, so the cap was that rule being paid for in missing data.
 *
 * A queued export has no reason to be capped: nobody is holding a connection open.
 *
 * ## Authorisation is asked twice, and the second time is the one that counts
 *
 * Requesting needs `BOOKING_READ_ALL`. Downloading asks AGAIN, and also asks whether this caller is
 * the person who requested it. Both are necessary and neither is redundant: permissions change
 * between a request and a collection, and an export is a file with somebody else's customers in it.
 *
 * The scope that shapes the file is read from the DATABASE by the worker, never carried in the job
 * — see `export.job.ts`. Carried, an export would outlive the permission that justified it.
 *
 * ## Two audit rows, not one
 *
 * `booking.export_requested` when it is asked for, `booking.exported` when bytes actually leave.
 * The old synchronous version could only write one, and wrote it before the response — which meant
 * an abandoned download still recorded as an export. Splitting them says exactly what happened:
 * somebody asked, and separately, somebody collected.
 */
@Injectable()
export class ExportRequestService {
  private readonly logger = new Logger(ExportRequestService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
    @Inject(EXPORTS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Records the request, enqueues the build, and answers with the reference to come back for. */
  async request(
    claims: AccessTokenClaims | undefined,
    filters: { q?: string | undefined; status?: string | undefined },
  ): Promise<{ reference: string; status: string }> {
    const requesterId = claims?.sub;

    if (!requesterId) throw forbidden(ERROR.AUTH_REQUIRED);

    /*
      Stored as an allow-listed object, never as whatever arrived.

      These two fields ARE the filter vocabulary — the same pair `RegistriesController` validates for
      the list, so the export and the registry cannot describe different sets. A spread of the
      request body would put arbitrary keys into a `jsonb` column that the worker later reads back
      and builds a query from.
    */
    const stored = {
      q: filters.q ?? null,
      status: filters.status ?? null,
    };

    const created = await this.db.execute<{ id: string; reference: string }>(sql`
      INSERT INTO export_jobs (requested_by_user_id, kind, filters, status)
      VALUES (${requesterId}::uuid, 'bookings', ${JSON.stringify(stored)}::jsonb, 'queued')
      RETURNING id, reference
    `);

    const row = created.rows[0];

    if (!row) throw badRequest(ERROR.REQUEST_VALIDATION_FAILED);

    await this.audit.record({
      actorUserId: claims.sub,
      actorRole: claims.role,
      action: 'booking.export_requested',
      subjectType: 'booking_export',
      subjectId: row.id,
      after: {
        reference: row.reference,
        filters: stored,
        /* Whether the requester's own scope will narrow the file — the auditor needs to know. */
        scoped: claims.scope?.kind === 'cities',
      },
    });

    try {
      await this.queue.add(
        EXPORT_JOB,
        { exportId: row.id },
        { ...JOB_OPTIONS.exports, jobId: exportJobId(row.id) },
      );
    } catch (error) {
      /*
        Swallowed, as everywhere else an enqueue happens after a commit. The row stays `queued`,
        which is exactly what `safra_exports_pending_oldest_seconds` alerts on and what a re-drive
        would pick up — and the operator sees «في الانتظار» rather than a request that vanished.
      */
      this.logger.error(
        `Could not enqueue export ${row.reference}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'The row stays queued and is recoverable by re-drive.',
      );
    }

    return { reference: row.reference, status: 'queued' };
  }

  /**
   * The exports this caller may see.
   *
   * Their OWN, always. Everybody else's only with `STAFF_MANAGE` — because the list names who asked
   * for what slice of customer data and when, which is an oversight surface rather than a
   * convenience. Scoped in the WHERE clause, never filtered afterwards.
   */
  async list(claims: AccessTokenClaims | undefined, query: PageQuery) {
    const requesterId = claims?.sub;

    if (!requesterId) throw forbidden(ERROR.AUTH_REQUIRED);

    const seesEveryone = claims.permissions?.includes(P.STAFF_MANAGE) ?? false;

    /*
      One `FROM … WHERE`, shared by the page and the count.

      The house rule for every paginated list: a count built from a separately written predicate
      drifts from the list it describes, and a total above a table that runs out early is worse than
      no total at all.
    */
    const fromWhere = sql`
      FROM export_jobs e
      JOIN users u ON u.id = e.requested_by_user_id
      WHERE e.deleted_at IS NULL
        ${seesEveryone ? sql`` : sql`AND e.requested_by_user_id = ${requesterId}::uuid`}
    `;

    const rows = await this.db.execute<ExportRow>(sql`
      SELECT e.reference, e.kind, e.status::text AS status, e.row_count, e.filters,
             e.failure_code, e.requested_by_user_id AS requested_by, u.email AS requested_by_email,
             e.created_at::text, e.expires_at::text
      ${fromWhere}
      ORDER BY e.created_at DESC, e.reference DESC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}
    `);

    /* The house envelope — capped total, derived page count, so `TablePagination` reads it. */
    return offsetPage(
      rows.rows.map((row) => this.viewOf(row)),
      await this.countOf(fromWhere),
      query,
    );
  }

  /**
   * The bytes, if this caller may have them.
   *
   * Returns the buffer rather than a URL. A signed URL would be a link that works for anybody who
   * has it and leaves no record of who followed it; a booking export is the one file where both of
   * those matter most. The audit row is written BEFORE the bytes leave, so a download abandoned
   * mid-stream still records that it started.
   */
  async download(
    claims: AccessTokenClaims | undefined,
    reference: string,
  ): Promise<{ filename: string; csv: Buffer }> {
    const requesterId = claims?.sub;

    if (!requesterId) throw forbidden(ERROR.AUTH_REQUIRED);

    if (!REFERENCE_PATTERN.test(reference)) throw notFound(ERROR.EXPORT_NOT_FOUND);

    const seesEveryone = claims.permissions?.includes(P.STAFF_MANAGE) ?? false;

    /*
      Ownership is IN the query, not a check afterwards.

      Fetch-then-compare answers differently for "somebody else's export" than for "no such export",
      and `EXP-` is sequential enough to walk. One 404 covers both.
    */
    const found = await this.db.execute<{
      id: string;
      file_key: string | null;
      status: string;
      row_count: number | null;
      expires_at: string | null;
    }>(sql`
      SELECT id, file_key, status::text AS status, row_count, expires_at::text
      FROM export_jobs
      WHERE reference = ${reference}
        AND deleted_at IS NULL
        ${seesEveryone ? sql`` : sql`AND requested_by_user_id = ${requesterId}::uuid`}
      LIMIT 1
    `);

    const row = found.rows[0];

    if (!row) throw notFound(ERROR.EXPORT_NOT_FOUND);

    /* A file that is not built yet is a different answer from one that never will be. */
    if (row.status !== 'ready' || !row.file_key) {
      throw badRequest(
        row.status === 'failed' ? ERROR.EXPORT_FAILED : ERROR.EXPORT_NOT_READY,
      );
    }

    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      throw badRequest(ERROR.EXPORT_EXPIRED);
    }

    const csv = await this.storage.get(row.file_key);

    /* Pruned, or never written. Either way the honest answer is that it is gone, not a 500. */
    if (!csv) throw badRequest(ERROR.EXPORT_EXPIRED);

    await this.audit.record({
      actorUserId: claims.sub,
      actorRole: claims.role,
      action: 'booking.exported',
      subjectType: 'booking_export',
      subjectId: row.id,
      after: { reference, rowCount: row.row_count, bytes: csv.byteLength },
    });

    return { filename: `${reference}.csv`, csv };
  }

  /** The row count for a page, capped, over the same `FROM … WHERE` the list uses. */
  private async countOf(fromWhere: SQL): Promise<number> {
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  private viewOf(row: ExportRow) {
    return {
      reference: row.reference,
      kind: row.kind,
      status: row.status,
      rowCount: row.row_count,
      filters: row.filters,
      failureCode: row.failure_code,
      requestedByEmail: row.requested_by_email,
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    };
  }

  /** Days after which a built export stops being downloadable. Read by the worker. */
  static get retentionDays(): number {
    return RETENTION_DAYS;
  }
}
