import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import { PropertyTypesController } from './property-types.controller.js';

/**
 * §8.2 — «أنواع أخرى قابلة للإضافة من الإدارة».
 *
 * ## What this has to prove
 *
 * That an accommodation type can be added WITHOUT a migration, which is the whole sentence. The
 * seven the SRS lists were rows nothing could write, so the capability was absent rather than
 * broken — and an absent capability is what a test like this is for.
 *
 * The retire path needs its own assertions for a different reason: `properties.property_type_id`
 * is a foreign key, so «remove a type» is a request the database would refuse and the product must
 * not make. What it does instead — take it off the list a partner chooses from, leave every
 * existing listing alone — is a behaviour somebody could reasonably change into a delete later.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('accommodation types', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const types = new PropertyTypesController(db);

  /** Distinctive, so it cannot collide with a seeded code. */
  const NEW_CODE = 'guest_house_test';

  beforeEach(() => harness.begin());
  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  it('adds a type that a partner can then choose', async () => {
    await types.create({
      code: NEW_CODE,
      nameAr: 'بيت ضيافة',
      nameEn: 'Guest house',
      nameDe: 'Gästehaus',
      hasMultipleUnits: true,
    });

    const listed = await types.list();
    const added = listed.find((type) => type.code === NEW_CODE);

    expect(added, 'the new type is in the list').toBeDefined();
    expect(added?.nameAr).toBe('بيت ضيافة');
    expect(added?.hasMultipleUnits).toBe(true);
    /* Active on arrival, or adding one would not make it choosable. */
    expect(added?.isActive).toBe(true);
    expect(added?.inUse).toBe(0);
  });

  /** It goes to the END. The seeded seven are ordered deliberately. */
  it('puts a new type last rather than among the seeded ones', async () => {
    await types.create({
      code: NEW_CODE,
      nameAr: 'بيت ضيافة',
      nameEn: 'Guest house',
      nameDe: 'Gästehaus',
      hasMultipleUnits: false,
    });

    const listed = await types.list();

    expect(listed.at(-1)?.code).toBe(NEW_CODE);
    /* The control: there were other types before it, so "last" means something. */
    expect(listed.length).toBeGreaterThan(1);
  });

  it('refuses a code that is already taken', async () => {
    const existing = (await types.list())[0];

    expect(existing, 'the seed has types to collide with').toBeDefined();

    await expect(
      types.create({
        code: existing?.code ?? '',
        nameAr: 'x',
        nameEn: 'x',
        nameDe: 'x',
        hasMultipleUnits: false,
      }),
    ).rejects.toMatchObject({ response: { code: ERROR.PROPERTY_TYPE_CODE_TAKEN } });
  });

  /**
   * Retiring takes a type off the list and touches nothing else.
   *
   * Asserted against a type that IS in use, because that is the case a delete could not serve and
   * the one where "leave the listings alone" means something.
   */
  it('retires a type in use without disturbing its listings', async () => {
    const inUse = (await types.list()).find((type) => type.inUse > 0);

    expect(inUse, 'the seed has a type with listings').toBeDefined();

    const before = await countProperties(inUse?.code ?? '');

    await types.setActive(inUse?.code ?? '', { isActive: false });

    const after = await types.list();
    const retired = after.find((type) => type.code === inUse?.code);

    expect(retired?.isActive).toBe(false);
    /* Still listed for staff — «why can nobody pick this» needs an answer on this screen. */
    expect(retired, 'a retired type is still shown to staff').toBeDefined();
    expect(await countProperties(inUse?.code ?? ''), 'its listings are untouched').toBe(
      before,
    );

    /* And it comes back. */
    await types.setActive(inUse?.code ?? '', { isActive: true });

    expect((await types.list()).find((type) => type.code === inUse?.code)?.isActive).toBe(
      true,
    );
  });

  it('refuses to retire a type that does not exist', async () => {
    await expect(
      types.setActive('not_a_type_at_all', { isActive: false }),
    ).rejects.toMatchObject({ response: { code: ERROR.PROPERTY_TYPE_NOT_FOUND } });
  });

  async function countProperties(code: string): Promise<string> {
    const rows = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n
      FROM properties p
      JOIN property_types t ON t.id = p.property_type_id
      WHERE t.code = ${code} AND p.deleted_at IS NULL
    `);

    return rows.rows[0]?.n ?? '0';
  }
});
