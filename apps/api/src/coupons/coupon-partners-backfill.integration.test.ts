import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

/**
 * `post/0020_coupon_partners_backfill.sql` is a ONE-OFF, and a deploy must not keep enrolling.
 *
 * ## The defect
 *
 * Every file under `post/` runs on every `db:migrate` (see `packages/db/src/migrate.ts`). This one
 * inserted `status = 'accepted'` for every live coupon × approved partner pair that had no row, so
 * the first deploy after a partner was approved signed them up to every live discount without
 * asking them. That is the opposite of the 2026-09-01 rule the file was written to protect: a
 * coupon does nothing for a partner until THEY accept it.
 *
 * ## How the file is driven
 *
 * Executed verbatim, inside the rollback harness, so the database is untouched afterwards. The
 * marker table is dropped first INSIDE the same rollback: a database where the fixed file already
 * ran holds the marker, and the question here is what the file does to a database meeting it for
 * the first time as well as on every run after.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const BACKFILL = readFileSync(
  join(
    dirname(fileURLToPath(import.meta.url)),
    '../../../../packages/db/migrations/post/0020_coupon_partners_backfill.sql',
  ),
  'utf8',
);

describeIfDb('the pre-opt-in coupon backfill', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let couponId = '';
  let cityId = '';

  beforeEach(async () => {
    await harness.begin();
    await db.execute(sql`DROP TABLE IF EXISTS coupon_partners_backfill`);
    ({ couponId, cityId } = await aCouponFromBeforeTheRule());
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  /* A fixed file from the repository, never caller input: the one place `sql.raw` is the tool. */
  const runBackfill = () => db.execute(sql.raw(BACKFILL));

  const statusFor = async (partnerId: string): Promise<string | undefined> => {
    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM coupon_partners
      WHERE coupon_id = ${couponId}::uuid AND partner_id = ${partnerId}::uuid
    `);

    return rows.rows[0]?.status;
  };

  /**
   * The control. A partner who held the coupon before the opt-in existed keeps holding it, which
   * is the one thing this file is for. Without it, a file that inserts nothing at all would pass
   * every assertion below.
   */
  it('accepts the coupon for a partner approved before the opt-in rule', async () => {
    const old = await aPartner('2026-08-01');

    await runBackfill();

    expect(await statusFor(old)).toBe('accepted');
  });

  it('does not enrol a partner approved after the rule, even on its first run', async () => {
    const recent = await aPartner(null);

    await runBackfill();

    expect(await statusFor(recent), 'enrolled without their decision').toBeUndefined();
  });

  /**
   * The deploy after the deploy. Watched to fail against the old file: the second run inserted an
   * `accepted` row for the partner approved in between.
   */
  it('inserts nothing for a partner approved between two deploys', async () => {
    await aPartner('2026-08-01');
    await runBackfill();

    const later = await aPartner(null);

    await runBackfill();

    expect(await statusFor(later), 'the re-run enrolled them').toBeUndefined();
  });

  /** A live coupon created before 2026-09-01, scoped to one city, with no offer rows yet. */
  async function aCouponFromBeforeTheRule(): Promise<{
    couponId: string;
    cityId: string;
  }> {
    const made = await db.execute<{ id: string; city_id: string }>(sql`
      WITH city AS (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1)
      INSERT INTO coupons (code, type, value_kind, value, starts_at, ends_at,
                           max_redemptions_per_customer, is_active, city_id, created_at)
      SELECT 'BKF' || floor(random() * 1e9)::text, 'city', 'percent', '10',
             now() - interval '60 days', now() + interval '60 days', 1, true, city.id,
             '2026-08-15T10:00:00Z'::timestamptz
      FROM city
      RETURNING id, city_id
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Coupon fixture produced no row.');

    return { couponId: row.id, cityId: row.city_id };
  }

  /** An approved partner in the coupon's city, verified on `verifiedOn` or right now. */
  async function aPartner(verifiedOn: string | null): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      WITH pu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('bkf-p-' || gen_random_uuid() || '@safra.test', '+963900000091', 'partner',
                'active')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id, address,
                            phone, email, verification, verified_at, created_at)
      SELECT pu.id, (SELECT id FROM partner_types LIMIT 1), 'Backfill Test', 'شريك',
             ${cityId}::uuid, 'x', '+963900000091',
             'bkf-p-' || gen_random_uuid() || '@safra.test', 'approved',
             coalesce(${verifiedOn}::timestamptz, now()),
             coalesce(${verifiedOn}::timestamptz, now())
      FROM pu
      RETURNING id
    `);

    const id = made.rows[0]?.id;

    if (!id) throw new Error('Partner fixture produced no row.');

    return id;
  }
});
