import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR, type TablePageSizeInput } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { unauthorized } from '../common/errors/app-error.js';

export interface StaffPreferences {
  /** Registry → rows per page. Absent keys mean "never changed", which is the default. */
  readonly tablePageSizes: Record<string, number>;
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

    const rows = await this.db.execute<{ table_page_sizes: unknown }>(sql`
      SELECT table_page_sizes FROM users WHERE id = ${id} AND deleted_at IS NULL
    `);

    const stored = rows.rows[0]?.table_page_sizes;

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
    };
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
