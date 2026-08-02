import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { type CursorPage, decodeCursor, encodeCursor } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';

export interface AuditEntry {
  readonly id: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly actorEmail: string | null;
  readonly actorRole: string | null;
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string | null;
  readonly ipAddress: string | null;
  readonly createdAt: string;
}

export interface AuditQuery {
  readonly limit: number;
  readonly cursor?: string | undefined;
  readonly action?: string | undefined;
  readonly subjectType?: string | undefined;
  readonly subjectId?: string | undefined;
  readonly actorEmail?: string | undefined;
}

/**
 * Reading the audit trail (SRS §15, §9.3, roadmap item 65).
 *
 * The trail has been written since the beginning and could not be read without SQL
 * access — which meant the one record designed to answer "who did this, and when"
 * was reachable only by the people least likely to be the subject of the question.
 *
 * ## Read-only, and structurally so
 *
 * There is no write path here and no soft delete: `audit_log` is append-only by
 * database trigger, so even a compromised admin session cannot edit history. This
 * service only reads.
 *
 * ## Why it is filtered rather than searched
 *
 * Every filter maps onto an existing index — action, subject, actor, time. Free-text
 * search over `before`/`after` would be the obvious next request and is deliberately
 * absent: those columns hold redacted payloads, an unindexed jsonb scan over a table
 * that only grows would be the slowest query in the system, and the honest way to
 * find "the change that set the fee to 1.99" is to filter by action and read.
 */
@Injectable()
export class AuditLogService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async list(query: AuditQuery): Promise<CursorPage<AuditEntry>> {
    const conditions: SQL[] = [];

    if (query.action) {
      /**
       * Prefix match, so `partner.` finds every partner action without the caller
       * needing to know the full set. Anchored with `LIKE 'x%'` rather than
       * `LIKE '%x%'` precisely so the index still applies.
       */
      conditions.push(sql`a.action LIKE ${query.action + '%'}`);
    }

    if (query.subjectType) {
      conditions.push(sql`a.subject_type = ${query.subjectType}`);
    }

    if (query.subjectId) {
      conditions.push(sql`a.subject_id = ${query.subjectId}::uuid`);
    }

    if (query.actorEmail) {
      conditions.push(sql`lower(u.email) = lower(${query.actorEmail})`);
    }

    if (query.cursor !== undefined) {
      const after = decodeCursor(query.cursor);

      // A 400, never a silent restart from page 1 — see BookingsService.list.
      if (!after) throw new BadRequestException('Malformed pagination cursor.');

      /**
       * Row comparison at FULL timestamp precision. Several audit rows written in
       * one transaction share a `created_at` to the microsecond, and a
       * millisecond-truncated bound would end the page there — the same defect that
       * was found in the wallet statement.
       */
      conditions.push(
        sql`(a.created_at, a.id) < (${after.sortKey}::timestamptz, ${after.id}::uuid)`,
      );
    }

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // One extra row reveals whether a further page exists, without a COUNT over a
    // table that only ever grows.
    const rows = await this.db.execute<{
      id: string;
      action: string;
      subject_type: string;
      subject_id: string | null;
      actor_email: string | null;
      actor_role: string | null;
      before: unknown;
      after: unknown;
      reason: string | null;
      ip_address: string | null;
      created_at: string;
    }>(sql`
      SELECT a.id, a.action, a.subject_type, a.subject_id,
             u.email AS actor_email, a.actor_role::text AS actor_role,
             a.before, a.after, a.reason, a.ip_address,
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${where}
      ORDER BY a.created_at DESC, a.id DESC
      LIMIT ${query.limit + 1}
    `);

    const hasMore = rows.rows.length > query.limit;
    const page = hasMore ? rows.rows.slice(0, query.limit) : rows.rows;
    const last = page.at(-1);

    return {
      items: page.map((row) => ({
        id: row.id,
        action: row.action,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        actorEmail: row.actor_email,
        actorRole: row.actor_role,
        before: row.before,
        after: row.after,
        reason: row.reason,
        ipAddress: row.ip_address,
        createdAt: row.created_at,
      })),
      nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
    };
  }

  /**
   * The distinct actions present, for the filter control.
   *
   * Read from the DATA rather than from a hardcoded list, because the set grows
   * every time an endpoint is added and a stale dropdown would quietly hide the
   * newest — and therefore least-reviewed — actions.
   */
  async actions(): Promise<string[]> {
    const rows = await this.db.execute<{ action: string }>(sql`
      SELECT DISTINCT action FROM audit_log ORDER BY action
    `);

    return rows.rows.map((row) => row.action);
  }
}
