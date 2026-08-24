import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ADMIN_DISPLAY_NAME } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditLogService } from './audit-log.service.js';

/**
 * A super admin acts under «Admin», and NOTHING in an audit read carries their identity.
 *
 * ## Why this is phrased as "no field carries it" rather than "the email is absent"
 *
 * Because the assertion that existed was the narrow one, and a new field walked straight around it.
 * `users.full_name` arrived on 2026-08-23 and every audit read began selecting it raw, two lines
 * below the helper that substitutes «Admin» for the address. The e2e spec asserted
 * `not.toContain(STAFF_EMAIL)` and stayed green, because a name is not an email.
 *
 * It was found by a screenshot: project-e9 changed a screen to prefer the name, rebuilt, and looked
 * at it — three rows that had read «Admin» now read a person's name.
 *
 * So this test asks the general question instead. It reads the whole entry, walks EVERY string in
 * it, and fails if any of them is the account's real name or address. A fourth identifying field
 * added next month fails here on the day it is added, rather than the day somebody happens to
 * render it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a super admin acts under a pseudonym', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const audit = new AuditLogService(db);

  let run = 0;

  async function actor(
    role: string,
    name: string,
    label: string,
  ): Promise<[string, string]> {
    const email = `anon-${process.pid}-${run}-${label}@safra.test`;
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (full_name, email, role, status, preferred_locale, password_hash)
      VALUES (${name}, ${email}, ${role}::user_role, 'active', 'ar', 'x')
      RETURNING id
    `);

    /*
      `subject_type = 'user'`, pointing at the actor's own row — a SELF-ACTION, which is what a
      sign-in is.

      The fixture wrote `'setting'` with a user id, so the subject resolved to nothing and the walk
      below had no subject to inspect. The test passed while a super admin's name was being printed
      in the entity column of every self-action row. A test whose fixture cannot reach the field it
      is protecting is not weaker than no test — it is worse, because it reports coverage.

      project-e9 found the live row by screenshot and predicted this exact gap before I looked.
    */
    await db.execute(sql`
      INSERT INTO audit_log (actor_user_id, actor_role, action, subject_type, subject_id)
      VALUES (${made.rows[0]?.id}::uuid, ${role}::user_role, 'auth.signed_in', 'user',
              ${made.rows[0]?.id}::uuid)
    `);

    return [made.rows[0]?.id ?? '', email];
  }

  /** Every string anywhere in the entry, including nested payloads. */
  function strings(value: unknown): string[] {
    if (typeof value === 'string') return [value];
    if (Array.isArray(value)) return value.flatMap(strings);
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).flatMap(strings);
    }

    return [];
  }

  beforeEach(async () => {
    await harness.begin();
    run += 1;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('carries neither the name nor the address of a super admin, in any field', async () => {
    const name = `اسم-حقيقي-${run}`;
    const [, email] = await actor('super_admin', name, 'super');

    const page = await audit.list({ limit: 5, page: 1 });
    const values = strings(page.items);

    expect(values).not.toContain(name);
    expect(values).not.toContain(email);
    expect(values).toContain(ADMIN_DISPLAY_NAME);
  });

  /**
   * The control, and it is what makes the assertion above mean anything.
   *
   * A service that withheld every actor's identity would pass the first test perfectly and would be
   * wrong: the pseudonym is for `super_admin` alone, and the whole point of an audit trail is that
   * ordinary staff are named.
   */
  it('names an ordinary staff member', async () => {
    const name = `موظف-${run}`;
    const [, email] = await actor('support_agent', name, 'agent');

    const values = strings(await audit.list({ limit: 5, page: 1 }).then((p) => p.items));

    expect(values).toContain(name);
    expect(values).toContain(email);
  });

  /**
   * The ENTITY column, which is where the leak moved to when the actor column was fixed.
   *
   * Asserted on `subject` by name rather than relying on the walk, because the walk only covers
   * this if the fixture's subject happens to resolve — and for two hours it did not. An assertion
   * that names the field it protects cannot be quietly bypassed by a fixture change.
   */
  it('pseudonymises a super admin named as the SUBJECT, not only as the actor', async () => {
    const name = `اسم-حقيقي-${run}`;
    const [, email] = await actor('super_admin', name, 'self');

    const entry = (await audit.list({ limit: 5, page: 1 })).items[0];

    expect(entry?.subject).toBeDefined();
    expect(entry?.subject?.label).toBe(ADMIN_DISPLAY_NAME);
    expect(entry?.subject?.label).not.toBe(name);
    expect(entry?.subject?.reference).toBeNull();
    expect(strings([entry])).not.toContain(email);
  });

  /**
   * The control for the one above: an ordinary staff member named as a subject IS named.
   *
   * Bashar's rule that an entry names the thing it happened to still holds for everybody else, and
   * a fix that pseudonymised every user subject would pass the assertion above perfectly.
   */
  it('still names an ordinary staff member as the subject', async () => {
    const name = `موظف-هدف-${run}`;
    await actor('support_agent', name, 'subject-agent');

    const entry = (await audit.list({ limit: 5, page: 1 })).items[0];

    expect(entry?.subject?.label).toBe(name);
  });

  /** The narrow read is held to the same rule — it shares `pageOf`, and that is worth proving. */
  it('holds the same rule on the staff activity list', async () => {
    const name = `اسم-حقيقي-${run}`;
    await actor('super_admin', name, 'super-activity');

    const page = await audit.staffActivity({ limit: 5, page: 1 });

    expect(strings(page.items)).not.toContain(name);
  });
});
