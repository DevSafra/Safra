import { Inject, Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { COUNT_CAP, STAFF_ROLES, type OffsetPage, offsetPage } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { resolveSubjects, type AuditSubject } from './audit-subject.js';
import { ADMIN_DISPLAY_NAME } from '@safra/contracts';
import { actorName } from '../common/actor-name.sql.js';

export interface AuditEntry {
  /**
   * What this entry HAPPENED TO, named (Bashar, 2026-08-24) — null when nothing resolves.
   *
   * Populated by the DETAIL reads and by the paged lists, both through `resolveSubjects`, which
   * batches one query per subject type rather than one per row.
   */
  readonly subject?: AuditSubject | null;
  readonly id: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId: string | null;
  readonly actorEmail: string | null;
  /** Who acted, by name. Null for an account created before `users.full_name` existed. */
  readonly actorName?: string | null;
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
      const term = query.actorEmail.trim();

      /*
        «Admin» is searchable, because «Admin» is what the reader can SEE (Bashar, 2026-08-23).

        Substituting the display name without this made the filter disagree with the column beside
        it: a super admin's rows read «Admin», and typing «Admin» into the search box — the obvious
        thing to do — returned nothing, because the predicate still compared an address. What you
        can read has to be what you can search, or the search box is a trap.

        The real address still matches. Somebody investigating who already knows it loses nothing,
        which is the point: this feature stops the address being PUBLISHED, not looked up.

        Branched in TypeScript rather than as a SQL `OR`, so each arm stays a single indexable
        predicate — an `OR` across `u.email` and `u.role` would cost the email index for every
        ordinary search to serve one special term. An account whose address is literally "admin" is
        not reachable by that word alone, which is fine: an address contains an `@`.
      */
      conditions.push(
        term.toLowerCase() === ADMIN_DISPLAY_NAME.toLowerCase()
          ? sql`u.role::text = 'super_admin'`
          : sql`lower(u.email) = lower(${term})`,
      );
    }

    return this.pageOf(conditions, query);
  }

  /**
   * One page of the trail, for any set of conditions.
   *
   * The projection, the ordering, the count cap and the offset live HERE and nowhere else. Two
   * screens read this table — سجل التدقيق whole, and آخر نشاط الموظفين narrowed to our own people —
   * and two copies of this query would drift into showing the same event differently on each.
   */
  private async pageOf(
    conditions: SQL[],
    query: { limit: number; page: number },
  ): Promise<OffsetPage<AuditEntry>> {
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
        actor_name: string | null;
        actor_role: string | null;
        before: unknown;
        after: unknown;
        reason: string | null;
        ip_address: string | null;
        created_at: string;
      }>(sql`
      SELECT a.id, a.action, a.subject_type, a.subject_id,
             ${actorName(sql`u.email`, sql`u.role`)} AS actor_email,
             u.full_name AS actor_name,
             a.actor_role::text AS actor_role,
             a.before, a.after, a.reason, a.ip_address,
             to_char(a.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')
               AS created_at
        ${fromWhere}
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT ${query.limit} ${this.pageOffset(query)}
      `),
      this.countOf(fromWhere),
    ]);

    /*
      Resolved AFTER the page is fetched, over exactly the rows being returned — never as a join in
      the query above. A join would be one LEFT JOIN per subject type on a table that only grows,
      to name at most `limit` things; this is one indexed lookup per type actually present.
    */
    const subjects = await resolveSubjects(
      this.db,
      rows.rows.map((row) => ({
        subjectType: row.subject_type,
        subjectId: row.subject_id,
      })),
    );

    return offsetPage(
      rows.rows.map((row) => ({
        id: row.id,
        action: row.action,
        subjectType: row.subject_type,
        subjectId: row.subject_id,
        subject: subjects.get(`${row.subject_type}:${row.subject_id}`) ?? null,
        actorEmail: row.actor_email,
        /* The person's NAME where the account has one — 165 predate the column and answer null. */
        actorName: row.actor_name,
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
   * آخر نشاط الموظفين — the same trail, narrowed to SAFRA's own people, searchable by person.
   *
   * ## Why this is a method here and not a query of its own
   *
   * الموظفون shows recent staff activity, and سجل التدقيق shows the whole trail. They are one list
   * with two predicates, and written separately they would drift — one gaining a column, the other
   * a filter, until the same event reads differently on two screens. This shares `pageOf` with
   * `list`, so the projection, the ordering, the cap and the paging are decided once.
   *
   * ## The search is by PERSON, and it resolves to ids first
   *
   * Bashar (2026-08-24) asked for a search box over a name or an email. Both live on `users`, not
   * on `audit_log`, so the obvious `WHERE u.email ILIKE '%q%'` would drag a join predicate across
   * an ever-growing table. Instead the term is resolved against `users` — a table bounded by the
   * size of the company — and the result becomes an id list against `audit_log_actor_idx`, which
   * is `(actor_user_id, created_at)` and therefore serves the ordering too.
   *
   * **A term matching nobody returns an EMPTY page, not every row.** The failure to avoid is a
   * search that silently ignores itself: a reader who typed a colleague's name and got the
   * unfiltered list would read the first row as that person's work.
   */
  async staffActivity(
    query: AuditQuery & { readonly actorSearch?: string | undefined },
  ): Promise<OffsetPage<AuditEntry>> {
    const conditions: SQL[] = [
      /*
        STAFF_ROLES, not a deny-list and not four literals. `actor_role` is stamped on the row at
        write time, so this reads what the actor WAS when they acted — which is the right question
        for a trail, and survives somebody later changing role or leaving.
      */
      sql`a.actor_role::text IN (${sql.join(
        STAFF_ROLES.map((role) => sql`${role}`),
        sql`, `,
      )})`,
    ];

    const term = query.actorSearch?.trim();

    if (term) {
      const matches = await this.db.execute<{ id: string }>(sql`
        SELECT id FROM users
        WHERE deleted_at IS NULL
          AND (full_name ILIKE ${'%' + term + '%'} OR email ILIKE ${'%' + term + '%'})
        LIMIT 500
      `);

      const ids = matches.rows.map((row) => row.id);

      /*
        Nobody matched, so nothing matched. `IN ()` is not valid SQL and an empty condition list
        would quietly widen the query to everything — the exact failure this guard exists for.
      */
      if (ids.length === 0) return offsetPage([], 0, query);

      conditions.push(
        sql`a.actor_user_id IN (${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )})`,
      );
    }

    return this.pageOf(conditions, query);
  }

  /**
   * ONE entry, for the screen that explains what happened.
   *
   * Bashar (2026-08-24) asked for a page per activity, "to explain exactly what happened". The
   * explanation is `before` and `after` — the two payloads the row already carries and the list
   * deliberately does not render, because a column wide enough for them is a column nothing else
   * fits in.
   *
   * Narrowed to STAFF actors by the same predicate as the list. Without it, a staff id from the
   * activity panel and a customer's audit row would be reachable through the same URL, and this
   * screen would become a way to read the whole trail without `audit_log.read`.
   */
  async staffEntry(id: string): Promise<AuditEntry | null> {
    const page = await this.pageOf(
      [
        sql`a.id = ${id}::uuid`,
        sql`a.actor_role::text IN (${sql.join(
          STAFF_ROLES.map((role) => sql`${role}`),
          sql`, `,
        )})`,
      ],
      { limit: 1, page: 1 },
    );

    return page.items[0] ?? null;
  }

  /**
   * ONE entry of the WHOLE trail, for سجل التدقيق's detail screen.
   *
   * Unnarrowed, unlike `staffEntry` — this is reached with `audit_log.read`, which is the
   * capability that opens the complete record. `staffEntry` exists precisely because
   * `staff.manage` must NOT reach a customer's or a partner's actions through the same door.
   */
  async entry(id: string): Promise<AuditEntry | null> {
    const page = await this.pageOf([sql`a.id = ${id}::uuid`], { limit: 1, page: 1 });

    return page.items[0] ?? null;
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
