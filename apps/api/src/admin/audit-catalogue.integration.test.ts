import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '@safra/contracts';
import { adminMessages } from '@safra/i18n';
import { createDatabase, type Database } from '@safra/db';

/**
 * The values the platform has actually written are all values the console can name.
 *
 * ## Why this is separate from `audit-actions.test.ts`
 *
 * That test compares two lists in the repository: the declared actions and their Arabic labels. It
 * cannot see an action the code emits and nobody declared — which is the failure that happened.
 * Five call sites build the action with a template literal (`partner.${nextStatus}`,
 * `property.${decision === 'approve' ? 'approved' : 'rejected'}`, and three more), so grepping the
 * source finds ONE action where there are two, and `partner.rejected` and `property.rejected` were
 * both missing while their approvals were present. They are the outcomes of the two verification
 * queues the console exists to work.
 *
 * The database does not have that blind spot. Whatever was written is there, spelled the way the
 * code spelled it.
 *
 * ## Vacuous passes are visible, not silent
 *
 * Over an empty `audit_log` this proves nothing, so the row count is asserted and printed. That is
 * the lesson from `pnpm load:invariants`, which reported "all invariants hold" over two empty tables
 * on 2026-08-20 and was only readable because it printed what it had counted.
 *
 * Read-only: safe against any environment.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('what the platform has written, the console can name', () => {
  let db: Database;

  beforeAll(() => {
    db = createDatabase(DATABASE_URL ?? '', 2);
  });

  afterAll(async () => {
    await db.$client.end();
  });

  const distinct = async (table: string, column: string): Promise<string[]> => {
    const rows = await db.execute<{ v: string }>(
      sql.raw(
        `SELECT DISTINCT ${column}::text AS v FROM ${table} WHERE ${column} IS NOT NULL ORDER BY 1`,
      ),
    );

    return rows.rows.map((row) => row.v);
  };

  it('has written enough for this suite to mean anything', async () => {
    const rows = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM audit_log`,
    );

    const total = Number(rows.rows[0]?.n ?? 0);

    console.log(`audit_log holds ${total.toLocaleString('en')} rows`);

    expect(
      total,
      'An empty audit_log makes every assertion below pass without checking anything. Seed the ' +
        'testbed (`pnpm db:testbed`) before trusting this suite.',
    ).toBeGreaterThan(0);
  });

  it('declares every action present in audit_log', async () => {
    const declared = new Set<string>(AUDIT_ACTIONS);
    const unknown = (await distinct('audit_log', 'action')).filter(
      (action) => !declared.has(action),
    );

    expect(
      unknown,
      'These actions were WRITTEN by the platform and are not in AUDIT_ACTIONS, so the console ' +
        'shows the raw identifier. Add them to packages/contracts/src/audit-actions.ts with an ' +
        'Arabic label — and check the spelling against the service that writes them, because ' +
        'audit_log is append-only.',
    ).toEqual([]);
  });

  it('names every subject type present in audit_log', async () => {
    const catalogue = adminMessages('ar').auditSubject;
    const unknown = (await distinct('audit_log', 'subject_type')).filter(
      (subject) => !(subject in catalogue),
    );

    expect(unknown, 'Add these to `auditSubject` in messages/admin/ar.ts.').toEqual([]);
  });

  /**
   * The same class of gap, one table over.
   *
   * The catalogue listed the six templates from design handoff §8 and the platform sends three
   * entirely different ones — `booking.needs_action`, `review.received`, `review.replied` — so every
   * row of سجل واتساب والبريد was untranslatable. Zero overlap between what was described and what
   * was built.
   */
  it('names every notification template that has been sent', async () => {
    const catalogue = adminMessages('ar').notificationTemplate;
    const unknown = (await distinct('notifications', 'template_key')).filter(
      (key) => !(key in catalogue),
    );

    expect(
      unknown,
      'Add these to `notificationTemplate` in messages/admin/ar.ts.',
    ).toEqual([]);
  });
});
