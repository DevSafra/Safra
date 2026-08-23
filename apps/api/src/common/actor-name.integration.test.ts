import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ADMIN_DISPLAY_NAME } from '@safra/contracts';

import { actorName } from './actor-name.sql.js';

/**
 * A super admin is shown as «Admin», and their address never leaves the database
 * (Bashar, 2026-08-23).
 *
 * ## Why this is an integration test and not a unit one
 *
 * The whole claim is about what a QUERY returns. `actorName` builds a `CASE` over a Postgres enum
 * column, and the two ways it could be wrong — comparing an enum to text without a cast, or
 * substituting for the wrong roles — are both invisible until Postgres runs it. A unit test over
 * the fragment's string would assert that I typed what I typed.
 *
 * ## What it pins
 *
 * That the substitution happens for `super_admin` and for NOBODY else. An operations manager
 * acting on a partner is a named colleague, and a partner querying a decision should be able to
 * say who made it — over-applying this would erase that while looking like a privacy improvement.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const SUPER = '99990000-0000-0000-0000-0000000000d1';
const OPS = '99990000-0000-0000-0000-0000000000d2';
const CUSTOMER = '99990000-0000-0000-0000-0000000000d3';

const SUPER_EMAIL = 'actor-name-super@safra.test';
const OPS_EMAIL = 'actor-name-ops@safra.test';
const CUSTOMER_EMAIL = 'actor-name-customer@safra.test';

describeIfDb('actorName', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;

    await db.execute(sql`
      INSERT INTO users (id, email, role, status, password_hash, preferred_locale)
      VALUES (${SUPER}::uuid, ${SUPER_EMAIL}, 'super_admin'::user_role, 'active', 'x', 'ar'),
             (${OPS}::uuid, ${OPS_EMAIL}, 'operations_manager'::user_role, 'active', 'x', 'ar'),
             (${CUSTOMER}::uuid, ${CUSTOMER_EMAIL}, 'customer'::user_role, 'active', 'x', 'ar')
      ON CONFLICT DO NOTHING`);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  async function shown(id: string): Promise<string | null> {
    const rows = await db.execute<{ who: string | null }>(sql`
      SELECT ${actorName(sql`u.email`, sql`u.role`)} AS who
      FROM users u WHERE u.id = ${id}::uuid
    `);

    return rows.rows[0]?.who ?? null;
  }

  it('shows a super admin as Admin, never their address', async () => {
    expect(await shown(SUPER)).toBe(ADMIN_DISPLAY_NAME);
  });

  /** The point of the control: the address is not selected, so it cannot reach a response. */
  it('does not return the super admin’s address at all', async () => {
    expect(await shown(SUPER)).not.toContain('@');
  });

  /**
   * The limit of the control, and the more important half.
   *
   * Anonymising every staff role would look like a stronger privacy posture and would be a
   * regression: a partner told only that «a member of staff» rejected them cannot follow it up.
   */
  it('leaves other staff named', async () => {
    expect(await shown(OPS)).toBe(OPS_EMAIL);
  });

  it('leaves customers named', async () => {
    expect(await shown(CUSTOMER)).toBe(CUSTOMER_EMAIL);
  });

  /** A null actor — a system action — stays null rather than becoming «Admin». */
  it('does not turn the system into Admin', async () => {
    const rows = await db.execute<{ who: string | null }>(sql`
      SELECT ${actorName(sql`u.email`, sql`u.role`)} AS who
      FROM (SELECT NULL::text AS email, NULL::user_role AS role) u
    `);

    expect(rows.rows[0]?.who).toBeNull();
  });
});
