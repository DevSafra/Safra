import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSION_GROUPS, STAFF_ASSIGNABLE_PERMISSIONS } from '@safra/contracts';

/**
 * أدوار الموظفين renders unpaged, and this is what keeps that exception honest.
 *
 * ## Why the screen has no pager
 *
 * `.claude/CLAUDE.md` requires `TablePagination` under every paged list, with one documented
 * exception: bounded REFERENCE data, where the screen exists to show the complete set. Staff roles
 * are that. A role is a JOB — «مدير عام», «مسؤول مالي», «مشرف حجوزات» — and an organisation has a
 * handful of those however many people it employs. A super admin about to name a new one needs to
 * see every role that already exists, or they will create «مشرف حجوزات» twice.
 *
 * `GET /admin/staff-roles` returns them whole rather than by page, so a bar would either print a
 * total from a full fetch — bounding nothing, which is the point of rule 2 — or lie.
 *
 * ## Why a test rather than a comment
 *
 * The standing instruction is explicit: "Do not add an exception without a test that holds it to
 * account." A comment saying "these stay small" is a hope. This is the alarm.
 *
 * The threshold is deliberately generous. It is not "how many we expect", it is "past here the
 * screen has stopped being a reference list and needs paging like every other registry".
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Past this the screen is a registry, not a reference list. */
const MAX_UNPAGED_ROLES = 40;

describeIfDb('staff roles stay small enough to render unpaged', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  it(`holds no more than ${MAX_UNPAGED_ROLES} live roles`, async () => {
    const rows = await db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM staff_roles WHERE deleted_at IS NULL
    `);

    const n = rows.rows[0]?.n ?? 0;

    expect(
      n,
      `أدوار الموظفين renders every role on one screen with no TablePagination bar, on the ` +
        `grounds that it is bounded reference data. There are now ${n} of them. Either this is ` +
        `data that should not be there, or the screen has outgrown the exception and needs ` +
        `pageQuerySchema + OFFSET like every other registry — see "Tables and pagination" in ` +
        `.claude/CLAUDE.md. Do not raise this number to make the test pass.`,
    ).toBeLessThanOrEqual(MAX_UNPAGED_ROLES);
  });

  /**
   * The capability list is bounded too, but by a DIFFERENT argument, and it is the one that
   * changed today.
   *
   * It was eleven, for partners' employees, and rendered as a flat two-column list. Staff roles
   * offer sixty-three, which is why the form groups them — so the ceiling that matters is no
   * longer "how many checkboxes" but "how many per group". A group of forty is a wall again.
   *
   * Unlike the roles, this grows only when an engineer edits `STAFF_ASSIGNABLE_PERMISSIONS`, so
   * the failure arrives in a code review — which is where it can still be cheaply reconsidered.
   */
  it('keeps every capability group small enough to read', () => {
    const perGroup = new Map<string, number>();

    for (const permission of STAFF_ASSIGNABLE_PERMISSIONS) {
      const prefix = permission.split('.')[0] ?? '';

      perGroup.set(prefix, (perGroup.get(prefix) ?? 0) + 1);
    }

    expect(
      STAFF_ASSIGNABLE_PERMISSIONS.length,
      `The role form renders one checkbox per assignable capability, split across ` +
        `${PERMISSION_GROUPS.length} groups. At ${STAFF_ASSIGNABLE_PERMISSIONS.length} it is ` +
        `still a form somebody reads; past 90 the groups themselves need subdividing before more ` +
        `are added.`,
    ).toBeLessThanOrEqual(90);
  });
});
