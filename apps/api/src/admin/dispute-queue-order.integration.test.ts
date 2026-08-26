import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { DisputeService } from './dispute.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * النزاعات is a WORK QUEUE: unresolved first, oldest of those at the top.
 *
 * ## Why this test exists rather than the comment that used to
 *
 * `dispute.service.ts` carried the sentence *"Unresolved first, then oldest first inside each
 * group: the queue's job is to surface what has been waiting longest"* directly above
 * `ORDER BY d.created_at DESC` — newest first, no status grouping at all. The comment described a
 * queue and the query returned a feed, and nothing anywhere disagreed with it for as long as nobody
 * asserted the behaviour. That is the third recorded instance of a true-sounding note describing an
 * intention rather than a change (`O-staff-2`, the آخر نشاط docblock, `O-cons-1`), and the only
 * defence that has ever worked is an assertion.
 *
 * ## Why the order matters operationally
 *
 * Bashar, 2026-08-24: a dispute FREEZES the partner's payout. An unresolved one is money held and a
 * business waiting, so the oldest is the most expensive — an operator working top-down must meet it
 * first. Chronology is what an activity feed optimises for and it is the wrong axis here.
 *
 * ## The fixture is deliberately out of order in BOTH dimensions
 *
 * An old resolved dispute, a new unresolved one and an older unresolved one. A fixture where age and
 * status happen to agree would pass against `created_at DESC`, against `created_at ASC`, and against
 * the correct expression — which is exactly how the original defect survived.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const superAdmin = {
  sub: undefined,
  role: 'super_admin',
  permissions: [],
  locale: 'ar',
} as unknown as AccessTokenClaims;

describeIfDb('النزاعات ordering', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');

  let db: Database;
  let service: DisputeService;
  let run = 0;

  /**
   * One dispute on its own booking, at a chosen age and status.
   *
   * `created_at` is written explicitly rather than left to `now()`: every row a rollback-harness test
   * writes shares one transaction timestamp, so three disputes created in a loop would be
   * indistinguishable by age and the ordering under test would have nothing to order.
   */
  async function makeDispute(
    label: string,
    status: 'open' | 'resolved',
    ageDays: number,
  ): Promise<string> {
    const made = await db.execute<{ reference: string }>(sql`
      WITH b AS (
        SELECT id, partner_id, customer_profile_id FROM bookings
        WHERE deleted_at IS NULL AND customer_profile_id IS NOT NULL
        ORDER BY created_at DESC OFFSET ${run * 3 + ageDays} LIMIT 1
      )
      INSERT INTO disputes (booking_id, partner_id, customer_profile_id, kind, status, title,
                            created_at
                            ${status === 'resolved' ? sql`, resolution, closed_at` : sql``})
      SELECT b.id, b.partner_id, b.customer_profile_id, 'not_as_described',
             ${status}::dispute_status, ${label},
             now() - ${`${ageDays} days`}::interval
             ${status === 'resolved' ? sql`, 'closed for the ordering test', now()` : sql``}
      FROM b
      RETURNING reference
    `);

    return made.rows[0]?.reference ?? '';
  }

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new DisputeService(
      db,
      new AuditService(db),
      new WalletService(db, new FxRateService(db, new AuditService(db))),
      new LedgerService(db),
      new FxRateService(db, new AuditService(db)),
    );
    run += 1;

    /* Clear the field, so the assertion is about THESE three and not about fixture history. */
    await db.execute(
      sql`UPDATE disputes SET deleted_at = now() WHERE deleted_at IS NULL`,
    );
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('puts the OLDEST unresolved dispute first, above a newer one', async () => {
    const oldOpen = await makeDispute('old and open', 'open', 30);
    const newOpen = await makeDispute('new and open', 'open', 1);

    const page = await service.list({ limit: 25, page: 1, actor: superAdmin });
    const order = page.items.map((row) => row.reference);

    expect(order.indexOf(oldOpen)).toBeLessThan(order.indexOf(newOpen));
  });

  /**
   * And an unresolved dispute outranks a closed one whatever their ages.
   *
   * The closed one here is the NEWEST row in the table, so a plain `created_at DESC` would put it at
   * the top — which is the defect this replaces, made visible.
   */
  it('puts every unresolved dispute above a closed one, however recent', async () => {
    const oldOpen = await makeDispute('old and open', 'open', 30);
    const justClosed = await makeDispute('closed today', 'resolved', 0);

    const page = await service.list({ limit: 25, page: 1, actor: superAdmin });
    const order = page.items.map((row) => row.reference);

    expect(order.indexOf(oldOpen)).toBeLessThan(order.indexOf(justClosed));
  });

  /** Among CLOSED disputes the newest is first — nothing is waiting, so recency is what is wanted. */
  it('orders closed disputes newest first', async () => {
    const oldClosed = await makeDispute('closed long ago', 'resolved', 30);
    const newClosed = await makeDispute('closed today', 'resolved', 0);

    const page = await service.list({ limit: 25, page: 1, actor: superAdmin });
    const order = page.items.map((row) => row.reference);

    expect(order.indexOf(newClosed)).toBeLessThan(order.indexOf(oldClosed));
  });
});
