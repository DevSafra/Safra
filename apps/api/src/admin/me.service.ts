import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import {
  ERROR,
  type MarkSeenInput,
  type SectionSeen,
  type TablePageSizeInput,
} from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { unauthorized } from '../common/errors/app-error.js';

export interface StaffPreferences {
  /** Registry → rows per page. Absent keys mean "never changed", which is the default. */
  readonly tablePageSizes: Record<string, number>;
  /**
   * Registry → the batch boundary and how far down it this reader has read.
   *
   * An absent key means «never looked», and that deliberately makes NOTHING new rather than
   * everything: a new operator must not be greeted by a badge counting every customer the platform
   * has ever had.
   */
  readonly sectionSeenAt: Record<string, SectionSeen>;
}

/**
 * Preferences belonging to the signed-in staff member.
 *
 * Every method takes the SUBJECT of the access token and nothing else. There is no overload that
 * accepts a user id, deliberately: see the controller's note — the absence is what makes an
 * ownership check impossible to forget.
 */
@Injectable()
export class MeService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async preferences(userId: string | undefined): Promise<StaffPreferences> {
    const id = this.require(userId);

    const rows = await this.db.execute<{
      table_page_sizes: unknown;
      section_seen_at: unknown;
    }>(sql`
      SELECT table_page_sizes, section_seen_at
      FROM users WHERE id = ${id} AND deleted_at IS NULL
    `);

    const stored = rows.rows[0]?.table_page_sizes;
    const seen = rows.rows[0]?.section_seen_at;

    /*
      Shape-checked on the way out, not trusted. The column is `jsonb`, which has no schema at
      rest: a row touched by a migration or a fixture can hold anything, and this value ends up
      deciding a `LIMIT`. `storedPageSize` on the reading side does the per-key check; this is the
      container check, so a scalar or an array cannot reach a caller expecting an object.
    */
    return {
      tablePageSizes:
        typeof stored === 'object' && stored !== null && !Array.isArray(stored)
          ? (stored as Record<string, number>)
          : {},
      /* The same container check, for the same reason: `jsonb` has no schema at rest. */
      sectionSeenAt:
        typeof seen === 'object' && seen !== null && !Array.isArray(seen)
          ? (seen as Record<string, SectionSeen>)
          : {},
    };
  }

  /**
   * Records what this reader has now been shown of a registry.
   *
   * ## Three marks, and one rule
   *
   * - `since` — the bottom of the current batch.
   * - `readTo` — how far down it the reader has got, clamped so it can never fall BELOW `since`.
   * - `readFrom` — the top of everything they have been shown.
   *
   * Unread is the interval `(since, readTo)`, so the badge falls by exactly what each page shows and
   * a row stops being marked once it has been on screen — Bashar, 2026-08-28: «when I switch to
   * other page, the only seen marked rows should be not marked anymore».
   *
   * ## Why the batch RE-OPENS instead of a second rule for late arrivals
   *
   * Rows that arrive while the reader is in the section sit ABOVE everything they have seen, and a
   * fully-read batch has no room for them: `readTo` is already at `since`. Two earlier attempts got
   * this wrong. Retiring the batch at `now()` swallowed them outright. Counting them with a second
   * predicate — «newer than the top I have seen» — put them back in the badge but reproduced the
   * original defect one level up: reading the NEWEST of them moved that top past the others, and the
   * older ones fell through both rules at once.
   *
   * So when a finished batch is opened again and the page now shows something newer than the top of
   * what was seen, the batch simply re-opens from that old top. The late arrivals become an ordinary
   * batch and every rule above applies to them unchanged. One mechanism, no special case.
   *
   * ## What is trusted, and what is not
   *
   * `since` only ever moves to a value the reader was previously SHOWN. The two reported marks come
   * from the client because only the client knows which page it rendered, and both are clamped to
   * `now()`; `readTo` is taken as a minimum and `readFrom` as a maximum. The blast radius is the
   * caller's own badge.
   *
   * One statement rather than read-modify-write: two tabs paging the same registry would otherwise
   * each write back the state they read, and the second would undo the first.
   */
  async markSeen(userId: string | undefined, input: MarkSeenInput): Promise<void> {
    const id = this.require(userId);
    const reportedTo = input.readTo ?? null;
    const reportedFrom = input.readFrom ?? null;

    await this.db.execute(sql`
      UPDATE users AS u
      SET section_seen_at = jsonb_set(
            coalesce(u.section_seen_at, '{}'::jsonb),
            array[${input.section}::text],
            (
              WITH cur AS (
                SELECT
                  (u.section_seen_at -> ${input.section} ->> 'since')::timestamptz    AS since,
                  (u.section_seen_at -> ${input.section} ->> 'readTo')::timestamptz   AS read_to,
                  (u.section_seen_at -> ${input.section} ->> 'readFrom')::timestamptz AS read_from,
                  least(${reportedTo}::timestamptz, now())                            AS rep_to,
                  least(${reportedFrom}::timestamptz, now())                          AS rep_from
              ), state AS (
                SELECT cur.*,
                  -- Finished: the frontier has reached the bottom of the batch.
                  (cur.read_to IS NOT NULL AND cur.read_to <= cur.since) AS finished,
                  -- Something newer than anything that was seen is on screen now.
                  (cur.rep_from IS NOT NULL
                     AND (cur.read_from IS NULL OR cur.rep_from > cur.read_from)) AS above
                FROM cur
              ), next AS (
                SELECT
                  -- Re-opened from the top of what was seen; otherwise the batch stands.
                  CASE WHEN state.finished AND state.above
                       THEN coalesce(state.read_from, state.since)
                       ELSE state.since END AS since,
                  -- A re-opened batch starts with nothing read in it.
                  CASE WHEN state.finished AND state.above THEN NULL
                       ELSE state.read_to END AS read_to,
                  state.rep_to, state.rep_from, state.read_from
                FROM state
              )
              SELECT CASE
                -- Never looked: this visit starts the clock, and nothing is unread.
                WHEN (SELECT since FROM cur) IS NULL THEN jsonb_build_object(
                  'since', to_jsonb(now()), 'readTo', 'null'::jsonb, 'readFrom', 'null'::jsonb)
                ELSE jsonb_build_object(
                  'since', to_jsonb((SELECT since FROM next)),
                  -- Down only, and never past the bottom of the batch.
                  'readTo', CASE
                    WHEN (SELECT rep_to FROM next) IS NULL
                      THEN to_jsonb((SELECT read_to FROM next))
                    ELSE to_jsonb(greatest(
                      least(coalesce((SELECT read_to FROM next), (SELECT rep_to FROM next)),
                            (SELECT rep_to FROM next)),
                      (SELECT since FROM next)))
                  END,
                  -- Up only: the highest row ever shown.
                  'readFrom', CASE
                    WHEN (SELECT rep_from FROM next) IS NULL
                      THEN to_jsonb((SELECT read_from FROM next))
                    ELSE to_jsonb(greatest((SELECT read_from FROM next),
                                           (SELECT rep_from FROM next)))
                  END)
              END
            ),
            true
          ),
          updated_at = now()
      WHERE u.id = ${id} AND u.deleted_at IS NULL
    `);
  }

  /**
   * Remembers one registry's page size.
   *
   * `jsonb_set` rather than read-modify-write: two tabs changing two different registries at the
   * same moment would otherwise each write back the map they read, and the second would erase the
   * first. The merge happens in the database, on the row, under its own lock.
   *
   * `section` reached here through `z.enum(TABLE_SECTIONS)`, so the key is one of fourteen
   * literals — and it is still passed as a PARAMETER rather than interpolated, because "validated
   * upstream" is a reason to expect a value to be safe, not a reason to build SQL out of it.
   */
  async setTablePageSize(
    userId: string | undefined,
    input: TablePageSizeInput,
  ): Promise<void> {
    const id = this.require(userId);

    await this.db.execute(sql`
      UPDATE users
      SET table_page_sizes =
            jsonb_set(
              coalesce(table_page_sizes, '{}'::jsonb),
              array[${input.section}::text],
              to_jsonb(${input.size}::int),
              true
            ),
          updated_at = now()
      WHERE id = ${id} AND deleted_at IS NULL
    `);
  }

  /**
   * The token's subject, or a refusal.
   *
   * Reached only if the global `JwtAuthGuard` let the request through without a subject, which
   * should not happen — so this is a guard against a future change to the guard, not against a
   * caller. It refuses rather than defaulting to a user, because the alternative to "who is
   * this" having no answer is writing to somebody.
   */
  private require(userId: string | undefined): string {
    if (!userId) throw unauthorized(ERROR.AUTH_SESSION_MISSING);

    return userId;
  }
}
