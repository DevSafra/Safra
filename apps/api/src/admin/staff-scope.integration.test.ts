import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { StaffScopeService } from './staff-scope.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * Scoping a staff member to cities — the write path (§8.2).
 *
 * ## This service had NO tests, and its main case had never worked
 *
 * `PUT /admin/staff/:userId/scope` answered 500 on every `cities` scope, from two array bindings
 * that interpolate a JS array as a TUPLE rather than as a Postgres array. Two things hid it
 * perfectly from each other: the console's only caller was deleted with `ScopePanel` on
 * 2026-08-23, so nothing produced a 500 — and nothing producing a 500 was why nobody looked.
 * `grep -rn "StaffScopeService" apps/api/src --include='*.test.ts'` returned zero.
 *
 * Found by project-e9 on 2026-08-24, by building the replacement editor and pressing save. The
 * feature was reported as a missing SCREEN; it was a missing screen in front of a broken write.
 *
 * ## Why the tests below lead with the cities path
 *
 * `all_cities` never reaches either binding — it is guarded by `citySlugs.length > 0` — so a suite
 * that covered the refusals and the unscoped case would have been green throughout. The assertions
 * that matter are the ones that write a row.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('scoping a staff member to cities', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new StaffScopeService(db, new AuditService(db));

  let run = 0;
  let actorId = '';
  let memberId = '';
  let slugs: string[] = [];

  const admin = (id: string): AccessTokenClaims =>
    ({ sub: id, role: 'super_admin', permissions: [], locale: 'ar' }) as never;

  async function makeStaff(role = 'support_agent'): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (full_name, email, role, status, preferred_locale, password_hash)
      VALUES ('موظف نطاق',
              ${`scope-${process.pid}-${run}-${role}-${Date.now()}@safra.test`},
              ${role}::user_role, 'active', 'ar', 'x')
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  /** The scope as the DATABASE holds it — never as the service reports it back. */
  async function storedScope(userId: string) {
    const row = await db.execute<{ kind: string; outside: string }>(sql`
      SELECT scope_kind::text AS kind, outside_scope_access::text AS outside
      FROM users WHERE id = ${userId}::uuid
    `);
    const cities = await db.execute<{ slug: string }>(sql`
      SELECT c.slug FROM staff_scope_cities s
      JOIN cities c ON c.id = s.city_id
      WHERE s.user_id = ${userId}::uuid
      ORDER BY c.slug
    `);

    return {
      kind: row.rows[0]?.kind,
      outside: row.rows[0]?.outside,
      slugs: cities.rows.map((r) => r.slug),
    };
  }

  beforeEach(async () => {
    await harness.begin();
    run += 1;

    actorId = await makeStaff('super_admin');
    memberId = await makeStaff();

    const cities = await db.execute<{ slug: string }>(sql`
      SELECT slug FROM cities WHERE deleted_at IS NULL ORDER BY slug LIMIT 2
    `);

    slugs = cities.rows.map((r) => r.slug);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * THE regression. One city, saved, and readable back out of the table.
   *
   * Asserted against the DATABASE rather than the service's return value: a write that reported
   * success without persisting is precisely the failure a return-value assertion cannot see.
   */
  it('saves a single city', async () => {
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: [slugs[0] ?? ''],
      outside: 'none',
    });

    await expect(storedScope(memberId)).resolves.toEqual({
      kind: 'cities',
      outside: 'none',
      slugs: [slugs[0]],
    });
  });

  /** Two, because a one-element array can pass a tuple binding by accident. */
  it('saves several cities', async () => {
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: slugs,
      outside: 'read_only',
    });

    const stored = await storedScope(memberId);

    expect(stored.kind).toBe('cities');
    expect(stored.outside).toBe('read_only');
    expect(stored.slugs.sort()).toEqual([...slugs].sort());
  });

  /** The set is REPLACED, not merged — narrowing a scope has to actually narrow it. */
  it('replaces the previous set rather than adding to it', async () => {
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: slugs,
      outside: 'none',
    });
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: [slugs[0] ?? ''],
      outside: 'none',
    });

    await expect(storedScope(memberId)).resolves.toMatchObject({ slugs: [slugs[0]] });
  });

  /** Going back to every city clears the rows, so nothing stale can be read as a restriction. */
  it('clears the cities when the scope goes back to all_cities', async () => {
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: slugs,
      outside: 'none',
    });
    await service.set(admin(actorId), memberId, {
      kind: 'all_cities',
      citySlugs: [],
      outside: 'none',
    });

    await expect(storedScope(memberId)).resolves.toEqual({
      kind: 'all_cities',
      outside: 'none',
      slugs: [],
    });
  });

  /**
   * An unknown slug refuses the WHOLE request, and writes nothing.
   *
   * Silently dropping it would produce a narrower scope than the administrator asked for and tell
   * them it succeeded. The second assertion is the one that matters: a 400 raised after a partial
   * write passes a test that only checks the exception.
   */
  it('refuses an unrecognised city and leaves the scope untouched', async () => {
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: [slugs[0] ?? ''],
      outside: 'none',
    });

    await expect(
      service.set(admin(actorId), memberId, {
        kind: 'cities',
        citySlugs: [slugs[0] ?? '', 'not-a-city'],
        outside: 'none',
      }),
    ).rejects.toMatchObject({ status: 400 });

    await expect(storedScope(memberId)).resolves.toMatchObject({ slugs: [slugs[0]] });
  });

  /** Nobody may narrow their own scope — an instant, self-inflicted blind spot. */
  it('refuses to change your own scope', async () => {
    await expect(
      service.set(admin(actorId), actorId, {
        kind: 'cities',
        citySlugs: slugs,
        outside: 'none',
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  /** A `cities` scope with no cities is accepted — it is how an administrator starts building one. */
  it('accepts a cities scope with nothing selected yet', async () => {
    await service.set(admin(actorId), memberId, {
      kind: 'cities',
      citySlugs: [],
      outside: 'none',
    });

    await expect(storedScope(memberId)).resolves.toEqual({
      kind: 'cities',
      outside: 'none',
      slugs: [],
    });
  });
});
