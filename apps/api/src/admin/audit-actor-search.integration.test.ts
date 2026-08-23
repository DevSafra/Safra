import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ADMIN_DISPLAY_NAME } from '@safra/contracts';

import { AuditLogService } from './audit-log.service.js';

/**
 * What سجل التدقيق shows for an actor must be what you can search for
 * (Bashar, 2026-08-23).
 *
 * ## The defect this pins
 *
 * Substituting «Admin» for a super admin's address in the SELECT left the FILTER comparing the
 * address, so the column and the search box disagreed. A reader saw «Admin», typed «Admin» — the
 * only thing they could type, since the address is deliberately not shown — and got nothing back.
 * A search box that cannot find what the page is displaying is worse than no search box: it
 * answers "no such actor" about an actor on the screen.
 *
 * ## Both terms have to work, and the second is not redundant
 *
 * The real address still matches, because this feature stops the address being PUBLISHED rather
 * than looked up. Somebody investigating who already holds it — from the database, from a ticket —
 * must not be worse off than before the change.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** `limit` and `page` are required — the schema defaults them for real callers. */
const PAGE = { limit: 25, page: 1 } as const;

const SUPER = '99990000-0000-0000-0000-0000000000e1';
const OPS = '99990000-0000-0000-0000-0000000000e2';
const SUPER_EMAIL = 'audit-search-super@safra.test';
const OPS_EMAIL = 'audit-search-ops@safra.test';

describeIfDb('audit log actor search', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: AuditLogService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new AuditLogService(db);

    await db.execute(sql`
      INSERT INTO users (id, email, role, status, password_hash, preferred_locale)
      VALUES (${SUPER}::uuid, ${SUPER_EMAIL}, 'super_admin'::user_role, 'active', 'x', 'ar'),
             (${OPS}::uuid, ${OPS_EMAIL}, 'operations_manager'::user_role, 'active', 'x', 'ar')
      ON CONFLICT DO NOTHING`);

    await db.execute(sql`
      INSERT INTO audit_log (actor_user_id, actor_role, action, subject_type, subject_id)
      VALUES (${SUPER}::uuid, 'super_admin'::user_role, 'setting.updated', 'setting',
              ${SUPER}::uuid),
             (${OPS}::uuid, 'operations_manager'::user_role, 'setting.updated', 'setting',
              ${OPS}::uuid)`);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  it('finds a super admin’s rows by the name the screen shows', async () => {
    const found = await service.list({ ...PAGE, actorEmail: ADMIN_DISPLAY_NAME });

    expect(found.items.length).toBeGreaterThan(0);
    expect(found.items.every((e) => e.actorRole === 'super_admin')).toBe(true);
  });

  /** Case-insensitively, because nobody types a capital by agreement. */
  it('finds them by «admin» in any case', async () => {
    const found = await service.list({ ...PAGE, actorEmail: 'admin' });

    expect(found.items.length).toBeGreaterThan(0);
  });

  /** And what it returns is still labelled «Admin», never the address. */
  it('shows those rows as Admin rather than an address', async () => {
    const found = await service.list({ ...PAGE, actorEmail: ADMIN_DISPLAY_NAME });

    expect(found.items[0]?.actorEmail).toBe(ADMIN_DISPLAY_NAME);
    expect(found.items.some((e) => e.actorEmail?.includes('@'))).toBe(false);
  });

  /**
   * The address still works — an investigator who holds it is no worse off.
   */
  it('still finds a super admin by their real address', async () => {
    const found = await service.list({ ...PAGE, actorEmail: SUPER_EMAIL });

    expect(found.items.length).toBeGreaterThan(0);
    expect(found.items[0]?.actorEmail).toBe(ADMIN_DISPLAY_NAME);
  });

  /**
   * And «Admin» does not become a wildcard.
   *
   * The branch replaces the email predicate entirely, so the risk is that it widens the search
   * rather than redirecting it — other staff must not appear under it.
   */
  it('does not return other staff under Admin', async () => {
    const found = await service.list({ ...PAGE, actorEmail: ADMIN_DISPLAY_NAME });

    expect(found.items.some((e) => e.actorEmail === OPS_EMAIL)).toBe(false);
  });

  it('still finds other staff by their address, named', async () => {
    const found = await service.list({ ...PAGE, actorEmail: OPS_EMAIL });

    expect(found.items.length).toBeGreaterThan(0);
    expect(found.items[0]?.actorEmail).toBe(OPS_EMAIL);
  });
});
