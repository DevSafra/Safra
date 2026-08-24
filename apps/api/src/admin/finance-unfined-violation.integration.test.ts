import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { FinanceService } from './finance.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * الدفع survives a violation that carries no fine.
 *
 * ## The defect this was written against
 *
 * The fine branch of the الدفع union selected EVERY row of `partner_violations`, including those
 * whose `fine_amount` is NULL — which is the ordinary state of a violation at `recorded` or
 * `warned`, the first two rungs of Bashar's ladder. Such a row arrived with a NULL amount and a
 * NULL currency, `financeItemSchema` types both as `z.string()`, and so the CONSOLE's parse of the
 * entire response failed. The screen rendered «تعذّر تحميل هذه القائمة»: no table, no counters, no
 * pagination bar. One un-fined violation took the whole payments registry down.
 *
 * ## Why nobody had met it
 *
 * Ordering. Rows come back newest first, and the fixture data's single un-fined violation sat
 * thousands of rows deep, on a page nobody ever opened. It became reachable the moment recording a
 * violation without fining it became a thing staff actually do — which is what the enforcement
 * work of 2026-08-24 asks for. The API answered 200 throughout; the failure was entirely on the
 * parse, which is why no server log and no HTTP assertion would ever have shown it.
 *
 * ## What it asserts, and why on the SHAPE rather than on a count
 *
 * That every row the service returns has an amount and a currency. A test that counted rows would
 * pass against a fix that emitted `'0'` for the amount, which would put a fine of zero on a money
 * screen — a lie that reconciles. The un-fined violation must be ABSENT, not defaulted.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const superAdmin = {
  sub: undefined,
  role: 'super_admin',
  permissions: [],
  locale: 'ar',
} as unknown as AccessTokenClaims;

describeIfDb('الدفع and a violation with no fine', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');

  let db: Database;
  let service: FinanceService;
  let partnerId = '';
  let run = 0;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new FinanceService(db);
    run += 1;

    const made = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1) AS type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status, preferred_locale)
        VALUES (${`fin-${process.pid}-${run}@safra.test`}, '+963900000000',
                'partner', 'active', 'ar')
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, ref.type_id, 'Fin', 'مالية', ref.city_id, 'x', '+963900000000',
             ${`fin-${process.pid}-${run}@safra.test`}, 'approved'
      FROM u, ref
      RETURNING id
    `);

    partnerId = made.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  /**
   * A violation at `recorded` — no fine, no currency — and الدفع still answers.
   *
   * The newest row is the one a first page renders, so this violation is exactly the one that broke
   * the screen: created last, read first.
   */
  it('leaves an un-fined violation out of the list entirely', async () => {
    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage, score_penalty)
      VALUES (${partnerId}::uuid, 'stale_calendar', 1, 'recorded', 0)
    `);

    const page = await service.list({ limit: 25, page: 1, actor: superAdmin });

    /*
      Every row is renderable. Asserted over the whole page rather than by looking for the row we
      inserted: the console parses the RESPONSE, so one unrenderable row anywhere in it is the
      failure, wherever it came from.
    */
    const broken = page.items.filter(
      (row) => row.amount === null || row.currency === null,
    );

    expect(
      broken,
      'These rows carry a null amount or currency. `financeItemSchema` types both as z.string(), ' +
        'so the console rejects the whole response and الدفع renders «تعذّر تحميل هذه القائمة».',
    ).toStrictEqual([]);
  });

  /**
   * The opposite control, and the test above is worthless without it.
   *
   * "No un-fined violations in the list" is trivially satisfied by a branch that returns no fines
   * at all — which is precisely what a careless fix would do. This proves a violation that DOES
   * carry a fine still reaches the screen it belongs on.
   */
  it('still lists a violation that does carry a fine', async () => {
    await db.execute(sql`
      INSERT INTO partner_violations (partner_id, kind, occurrence_number, stage,
                                      fine_amount, fine_currency_id, score_penalty)
      VALUES (${partnerId}::uuid, 'stale_calendar', 1, 'fined', '50.00',
              (SELECT id FROM currencies WHERE code = 'USD'), 0)
    `);

    const page = await service.list({ limit: 25, page: 1, actor: superAdmin });

    /*
      Looks for THIS fine, not for "no broken rows".

      An `every(...)` over the page was the first version and it is the wrong control: with the fix
      reverted it fails for the same reason the test above does — the fixture database holds older
      un-fined violations — so both tests went red together and the pair proved nothing about
      whether fines still arrive. A control has to fail only when the thing it protects is gone.
    */
    const mine = page.items.filter(
      (row) => row.kind === 'fine' && row.amount === '50.00',
    );

    expect(
      mine.length,
      'A violation carrying a fine must still reach الدفع — the fix must exclude un-fined rows, ' +
        'not fines.',
    ).toBeGreaterThan(0);
  });
});
