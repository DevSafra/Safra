import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import type { EnforcementNotifier } from './enforcement-notifier.js';
import { EnforcementService } from './enforcement.service.js';
import { interleaved } from '../common/testing/interleaved.testing.js';

/**
 * A fine waived by two operators at once is waived once.
 *
 * The «already waived» check read `waived_at` before the transaction, and the UPDATE matched on
 * the id alone, so two presses both passed and both posted a reversal: the partner was credited
 * the fine twice, and the ledger showed «Fine −50, Waiver +50, Waiver +50». The rollback harness
 * has one connection, so the other operator's whole waiver is run at the moment this one opens its
 * transaction, which is the window.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const REASON = 'ثبت أن الإغلاق كان بسبب انقطاع الكهرباء في المدينة كلها';

describeIfDb('a fine two operators waive at once', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const fx = {
    rateToSyp: () => Promise.resolve('13000.00000000'),
  } as unknown as FxRateService;
  const notifier = {
    fineWaived: () => Promise.resolve(),
  } as unknown as EnforcementNotifier;

  const serviceOver = (handle: Database) =>
    new EnforcementService(
      handle,
      new AuditService(handle),
      new LedgerService(handle),
      fx,
      notifier,
    );

  let staff: AccessTokenClaims;
  let partnerId = '';
  let violationId = '';

  beforeEach(async () => {
    await harness.begin();
    await seed();
  });

  afterEach(() => harness.rollback());
  afterAll(() => harness.close());

  const waive = (service: EnforcementService) =>
    service.waive(staff, violationId, { reason: REASON });

  const waiverGroups = async () =>
    Number(
      (
        await db.execute<{ n: string }>(sql`
          SELECT count(DISTINCT entry_group_id)::text AS n FROM ledger_entries
          WHERE partner_id = ${partnerId}::uuid
        `)
      ).rows[0]?.n ?? 0,
    );

  /** Watched to fail against the old code: two reversal groups, and no refusal. */
  it('posts one reversal and tells the second operator it is already waived', async () => {
    const refusal = await waive(
      serviceOver(interleaved(db, () => waive(serviceOver(db)))),
    ).catch((error: unknown) => error);

    expect(codeOf(refusal)).toBe(ERROR.VIOLATION_ALREADY_WAIVED);
    expect(await waiverGroups(), 'the fine reversed twice').toBe(1);
  });

  /** The control: one operator, one waiver, and it lands. */
  it('waives it when nobody else is acting', async () => {
    await waive(serviceOver(db));

    expect(await waiverGroups()).toBe(1);

    const row = await db.execute<{ waived: string | null }>(sql`
      SELECT waived_at::text AS waived FROM partner_violations WHERE id = ${violationId}::uuid
    `);

    expect(row.rows[0]?.waived).not.toBeNull();
  });

  /** A fined violation on a partner of this test's own, and the operator waiving it. */
  async function seed(): Promise<void> {
    const made = await db.execute<{
      partner: string;
      violation: string;
      staff: string;
    }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS type_id
      ), pu AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('wv-p-' || gen_random_uuid() || '@safra.test', '+963900000161', 'partner',
                'active', 'ar')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email, verification)
        SELECT pu.id, ref.type_id, 'Waive Race', 'إعفاء', ref.city_id, 'x', '+963900000161',
               'wv-p-' || gen_random_uuid() || '@safra.test', 'approved'
        FROM pu, ref RETURNING id
      ), vi AS (
        INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, description,
                                        score_penalty, fine_amount, fine_currency_id)
        SELECT pa.id, 'stale_calendar', 1, 'fined', ${REASON}, 0, '50.00',
               (SELECT id FROM currencies WHERE code = 'USD')
        FROM pa RETURNING id
      ), st AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES ('wv-s-' || gen_random_uuid() || '@safra.test', '+963900000162', 'super_admin',
                'active', 'ar')
        RETURNING id
      )
      SELECT pa.id AS partner, vi.id AS violation, st.id AS staff FROM pa, vi, st
    `);

    const row = made.rows[0];

    if (!row) throw new Error('Seed produced no row.');

    partnerId = row.partner;
    violationId = row.violation;
    staff = {
      sub: row.staff,
      role: 'super_admin',
      permissions: [],
      locale: 'ar',
    } as unknown as AccessTokenClaims;
  }
});
