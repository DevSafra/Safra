import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditLogService } from './audit-log.service.js';

/**
 * آخر نشاط الموظفين — searching the trail by the person who acted (Bashar, 2026-08-24).
 *
 * ## What is worth proving
 *
 * A search box has one failure mode that matters and it is silent: a term that matches nobody
 * returning EVERYTHING. The reader typed a colleague's name, got a full list, and reads the first
 * row as that colleague's work. Every other assertion here exists to make that one meaningful —
 * without the "finds the right person" cases, a service that always returned an empty page would
 * pass the important test perfectly.
 *
 * ## Why the fixtures write audit rows directly
 *
 * `audit_log` is append-only by trigger and has a foreign key to `users`, so a row cannot be
 * invented for an actor who does not exist. That is the same constraint the application works
 * under, which is what makes these rows representative.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('the staff activity trail', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const audit = new AuditLogService(db);

  let run = 0;
  let hanan = '';
  let omar = '';
  let customer = '';

  async function makeUser(
    fullName: string | null,
    role: string,
    label: string,
  ): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (full_name, email, role, status, preferred_locale, password_hash)
      VALUES (${fullName},
              ${`act-${process.pid}-${run}-${label}@safra.test`},
              ${role}::user_role, 'active', 'ar', 'x')
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  async function act(userId: string, role: string, action: string): Promise<void> {
    await db.execute(sql`
      INSERT INTO audit_log (actor_user_id, actor_role, action, subject_type, subject_id)
      VALUES (${userId}::uuid, ${role}::user_role, ${action}, 'user', ${userId}::uuid)
    `);
  }

  const page = (q?: string) =>
    audit.staffActivity({ limit: 20, page: 1, ...(q ? { actorSearch: q } : {}) });

  beforeEach(async () => {
    await harness.begin();
    run += 1;

    hanan = await makeUser('حنان العلي', 'support_agent', 'hanan');
    omar = await makeUser('عمر ناصر', 'finance_officer', 'omar');
    customer = await makeUser('زبون', 'customer', 'customer');

    await act(hanan, 'support_agent', 'booking.cancelled');
    await act(omar, 'finance_officer', 'payout.executed');
    await act(customer, 'customer', 'auth.registered');
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /** The list is SAFRA's own people. A customer's action belongs to سجل التدقيق, not to الموظفون. */
  it('shows staff actions and not a customer’s', async () => {
    const actions = (await page()).items.map((item) => item.action);

    expect(actions).toContain('booking.cancelled');
    expect(actions).toContain('payout.executed');
    expect(actions).not.toContain('auth.registered');
  });

  it('finds a person by their name', async () => {
    const found = await page('حنان');

    expect(found.items.map((item) => item.action)).toEqual(['booking.cancelled']);
  });

  it('finds a person by part of their email', async () => {
    const found = await page(`${run}-omar`);

    expect(found.items.map((item) => item.action)).toEqual(['payout.executed']);
  });

  /** Case-insensitive, because nobody types an address the way it is stored. */
  it('ignores case in an email search', async () => {
    const found = await page(`${run}-OMAR`.toUpperCase());

    expect(found.items.map((item) => item.action)).toEqual(['payout.executed']);
  });

  /**
   * THE assertion. A term matching nobody returns NOTHING.
   *
   * `IN ()` is not valid SQL, so the tempting implementation — build a condition only when there
   * are ids — widens the query to every row instead. The reader then reads somebody else's work as
   * the person they searched for, and nothing anywhere says the search was ignored.
   */
  it('returns an empty page for a term matching nobody, not every row', async () => {
    const found = await page('لا-أحد-بهذا-الاسم');

    expect(found.items).toEqual([]);
    expect(found.total).toBe(0);
  });

  /**
   * A search that matches a CUSTOMER still returns nothing.
   *
   * The name resolves to a real user id, so the id filter is satisfied — and the staff predicate
   * has to refuse it independently. A search box that reached a customer's actions would be a way
   * to read the wider trail without `audit_log.read`.
   */
  it('does not reach a customer’s actions through their name', async () => {
    const found = await page('زبون');

    expect(found.items).toEqual([]);
  });

  it('pages, and reports a total the pager can print', async () => {
    for (let index = 0; index < 5; index += 1) {
      await act(hanan, 'support_agent', 'booking.cancelled');
    }

    const first = await audit.staffActivity({ limit: 2, page: 1, actorSearch: 'حنان' });
    const second = await audit.staffActivity({ limit: 2, page: 2, actorSearch: 'حنان' });

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(first.total).toBe(6);
    /* Different rows on each page — an OFFSET that repeats a row is the classic paging fault. */
    expect(first.items.map((i) => i.id)).not.toEqual(second.items.map((i) => i.id));
  });

  /** An account with no name is still searchable by address — 165 of them have no name. */
  it('finds a nameless account by its email', async () => {
    const nameless = await makeUser(null, 'operations_manager', 'nameless');

    await act(nameless, 'operations_manager', 'setting.changed');

    const found = await page(`${run}-nameless`);

    expect(found.items.map((item) => item.action)).toEqual(['setting.changed']);
  });

  describe('one entry', () => {
    it('reads back a staff entry by id', async () => {
      const listed = await page('حنان');
      const id = listed.items[0]?.id ?? '';

      await expect(audit.staffEntry(id)).resolves.toMatchObject({
        id,
        action: 'booking.cancelled',
      });
    });

    /** A customer's entry is not reachable here, by id or otherwise. */
    it('refuses a customer’s entry', async () => {
      const row = await db.execute<{ id: string }>(sql`
        SELECT id FROM audit_log WHERE actor_user_id = ${customer}::uuid LIMIT 1
      `);

      await expect(audit.staffEntry(row.rows[0]?.id ?? '')).resolves.toBeNull();
    });

    it('answers null for an id that names nothing', async () => {
      await expect(
        audit.staffEntry('00000000-0000-4000-8000-000000000000'),
      ).resolves.toBeNull();
    });
  });
});
