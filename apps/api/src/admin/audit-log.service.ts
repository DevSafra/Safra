import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, type OffsetPage, offsetPage } from '@safra/contracts';

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
  /** 1-based. The screen shows it, so the API speaks in the same terms. */
  readonly page: number;
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

  /**
   * The row count for a page, over the SAME `FROM … WHERE` the list uses.
   *
   * Sharing one fragment between the list and the count is the point, not tidiness: a count built
   * from a separately written predicate drifts from the list it describes, and a total that
   * disagrees with what the table can page through is worse than showing no total.
   */
  private async countOf(fromWhere: SQL): Promise<number> {
    /*
      Counted over a LIMIT-ed subquery, so the database stops reading at COUNT_CAP + 1 rows
      instead of scanning the whole matching set. An uncapped count(*) is unbounded work on
      every page view of an ever-growing table — which rule 2 forbids — and nobody reading a
      console table needs to know the exact size of a set they will never page through.
    */
    const result = await this.db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM (SELECT 1 ${fromWhere} LIMIT ${COUNT_CAP + 1}) capped`,
    );

    return Number(result.rows[0]?.n ?? 0);
  }

  /** `OFFSET` for a 1-based page. */
  private pageOffset(query: { page: number; limit: number }): SQL {
    return sql`OFFSET ${(query.page - 1) * query.limit}`;
  }

  async list(query: AuditQuery): Promise<OffsetPage<AuditEntry>> {
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

    const where =
      conditions.length > 0 ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    // One extra row reveals whether a further page exists, without a COUNT over a
    // table that only ever grows.
    // One fragment, used by both queries below — see `countOf`.
    const fromWhere = sql`
      FROM audit_log a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${where}`;

    const [rows, total] = await Promise.all([
      this.db.execute<{
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
        ${fromWhere}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    return offsetPage(
      rows.rows.map((row) => ({
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
      total,
      query,
    );
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
