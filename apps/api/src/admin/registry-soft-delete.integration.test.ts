import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { RegistryService } from './registry.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * A soft-deleted row does not appear in a console registry (Bashar, 2026-08-21).
 *
 * ## The bug this pins
 *
 * A soft delete is what this platform means by removal (P-003): every read filters `deleted_at`,
 * so the row disappears rather than being destroyed. The partners and properties registries did
 * not filter it, so a removed partner or listing stayed in the table while its detail screen
 * answered 404 — the console offering a row nobody can open.
 *
 * `navigation.spec.ts` found it, reporting `/properties → /properties/PRO-103501 (404)` after a
 * partner reset soft-deleted a listing. That spec walks every registry link on every section, and
 * it is the only reason this surfaced at all — no unit test would have, because each query is
 * correct in isolation and only DISAGREES with the detail screen.
 *
 * ## Why a test per registry rather than one
 *
 * The customers registry already filtered correctly, which is what makes the other two an
 * omission rather than a decision. A test per registry is what stops the next one being added
 * without it.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('registries and soft deletes', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const registry = new RegistryService(db);

  /** Unscoped staff: the filter under test must not be doing this by accident. */
  const staff = (): AccessTokenClaims =>
    ({
      sub: '00000000-0000-0000-0000-0000000000b1',
      role: 'super_admin',
      scope: { kind: 'all' },
    }) as unknown as AccessTokenClaims;

  let partnerReference = '';
  let propertyReference = '';

  beforeEach(async () => {
    await harness.begin();

    const made = await db.execute<{ partner: string; property: string }>(sql`
      WITH u AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('soft-' || gen_random_uuid() || '@safra.test', '+963900000400', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email)
        SELECT u.id, (SELECT id FROM partner_types LIMIT 1), 'Soft Delete', 'حذف',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000400', 'soft@safra.test'
        FROM u
        RETURNING id, reference
      ), pr AS (
        INSERT INTO properties (partner_id, city_id, property_type_id, cancellation_policy_id,
                                slug, name_ar, name_en, name_de, address, status)
        SELECT pa.id, (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1),
               (SELECT id FROM property_types LIMIT 1),
               (SELECT id FROM cancellation_policies LIMIT 1),
               'soft-' || gen_random_uuid(), 'عقار', 'Prop', 'Prop', 'x', 'draft'
        FROM pa
        RETURNING reference
      )
      SELECT (SELECT reference FROM pa) AS partner, (SELECT reference FROM pr) AS property
    `);

    partnerReference = made.rows[0]?.partner ?? '';
    propertyReference = made.rows[0]?.property ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  const partnerRefs = async (): Promise<string[]> =>
    (await registry.partners({ limit: 200, page: 1, actor: staff() })).items.map(
      (row) => row.reference,
    );

  const propertyRefs = async (): Promise<string[]> =>
    (await registry.properties({ limit: 200, page: 1, actor: staff() })).items.map(
      (row) => row.reference,
    );

  describe('the partners registry', () => {
    /* The positive first: a filter that hides everything would pass the negative on its own. */
    it('lists a live partner', async () => {
      expect(await partnerRefs()).toContain(partnerReference);
    });

    it('drops one that has been soft-deleted', async () => {
      await db.execute(
        sql`UPDATE partners SET deleted_at = now() WHERE reference = ${partnerReference}`,
      );

      expect(await partnerRefs()).not.toContain(partnerReference);
    });
  });

  describe('the properties registry', () => {
    it('lists a live listing', async () => {
      expect(await propertyRefs()).toContain(propertyReference);
    });

    /** THE case: this exact row, listed and 404ing, is what the browser suite reported. */
    it('drops one that has been soft-deleted', async () => {
      await db.execute(
        sql`UPDATE properties SET deleted_at = now() WHERE reference = ${propertyReference}`,
      );

      expect(await propertyRefs()).not.toContain(propertyReference);
    });
  });
});
