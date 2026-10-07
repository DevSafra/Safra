import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createRollbackDatabase, type Database } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PayoutService } from './payout.service.js';

/**
 * مستحقاتي past fifty payouts (go-live audit, 2026-10-06).
 *
 * `GET /partner/payouts` was `LIMIT 50` with no cursor, and the portal added up whatever came back:
 * the fifty-first transfer and every older one fell off the list, out of «حُوِّل إليك حتى الآن», and
 * off the detail screen, which looked the payout up in that same list. Each of those is asserted
 * here against a partner holding MORE payouts than one page, because the defect is invisible on a
 * fixture that fits in one.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** More than the old cut of 50, so a capped read and a complete one cannot agree. */
const PAID = 53;
const OPEN = 2;

describeIfDb('a partner reading their own payouts', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;
  const service = new PayoutService(
    db,
    new AuditService(db),
    new LedgerService(db),
    new SettingsService(db),
  );

  let mine: AccessTokenClaims;
  let theirs: AccessTokenClaims;
  let oldest = '';
  let foreign = '';

  beforeEach(async () => {
    await harness.begin();

    const ids = await seed();

    mine = claimsFor(ids.mine);
    theirs = claimsFor(ids.theirs);
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('walks every payout by cursor, none twice and none missed', async () => {
    const seen: string[] = [];
    let cursor: string | undefined;

    do {
      const page = await service.listForPartner(mine, {
        limit: 20,
        ...(cursor ? { cursor } : {}),
      });

      expect(page.items.length).toBeLessThanOrEqual(20);
      seen.push(...page.items.map((row) => row.reference));
      cursor = page.nextCursor ?? undefined;
    } while (cursor);

    expect(seen).toHaveLength(PAID + OPEN);
    expect(new Set(seen).size).toBe(PAID + OPEN);
    expect(seen).toContain(oldest);
  });

  it('totals every payout, not the page in view', async () => {
    const page = await service.listForPartner(mine, { limit: 20 });

    expect(page.totals).toStrictEqual([
      {
        currencyCode: 'USD',
        openCount: OPEN,
        openTotal: (OPEN * 10).toFixed(3),
        paidCount: PAID,
        paidTotal: (PAID * 100).toFixed(3),
        nextScheduled: '2026-11-05',
      },
    ]);
  });

  it('opens a payout older than any one page', async () => {
    expect((await service.oneForPartner(mine, oldest)).reference).toBe(oldest);
  });

  /* The opposite control: the same call by another partner is a 404, like a reference that does not exist. */
  it("answers another partner's payout exactly like a missing one", async () => {
    await expect(service.oneForPartner(theirs, oldest)).rejects.toMatchObject({
      response: { code: 'payout.not_found' },
    });
    await expect(service.oneForPartner(mine, 'PYT-NOPE')).rejects.toMatchObject({
      response: { code: 'payout.not_found' },
    });
    expect(
      (await service.listForPartner(mine, { limit: 100 })).items.map((r) => r.reference),
    ).not.toContain(foreign);
  });

  function claimsFor(partnerId: string): AccessTokenClaims {
    return {
      sub: '00000000-0000-4000-8000-00000000beef',
      role: 'partner',
      partnerId,
      permissions: [P.PAYOUT_READ_OWN],
    } as AccessTokenClaims;
  }

  /** Two partners: one with PAID settled payouts and OPEN pending ones, one with a single payout. */
  async function seed(): Promise<{ mine: string; theirs: string }> {
    const partners = await db.execute<{ id: string }>(sql`
      WITH ref AS (
        SELECT (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1) AS city_id,
               (SELECT id FROM partner_types LIMIT 1)                   AS partner_type_id
      ), u AS (
        INSERT INTO users (email, phone, role, status)
        SELECT 'ppl-' || gen_random_uuid() || '@safra.test', '+963900000094', 'partner', 'active'
        FROM generate_series(1, 2)
        RETURNING id
      )
      INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                            address, phone, email, verification)
      SELECT u.id, ref.partner_type_id, 'Payout List', 'مستحقات', ref.city_id, 'x',
             '+963900000094', 'ppl-p-' || gen_random_uuid() || '@safra.test', 'approved'
      FROM u, ref
      RETURNING id
    `);
    const [a, b] = partners.rows.map((row) => row.id);

    if (!a || !b) throw new Error('fixture partners were not created');

    /* Oldest first by `created_at`, so `n = 1` is the transfer the old cut dropped. */
    const made = await db.execute<{ reference: string; n: number }>(sql`
      INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end,
                                   gross_amount, net_amount, status, paid_at, scheduled_for,
                                   released_at, entry_group_id, created_at)
      SELECT ${a}::uuid, (SELECT id FROM currencies WHERE code = 'USD'),
             current_date - 400 + n, current_date - 400 + n,
             (CASE WHEN n <= ${PAID} THEN 100 ELSE 10 END)::numeric,
             (CASE WHEN n <= ${PAID} THEN 100 ELSE 10 END)::numeric,
             (CASE WHEN n <= ${PAID} THEN 'paid' ELSE 'pending_release' END)::payout_status,
             CASE WHEN n <= ${PAID} THEN now() END,
             CASE WHEN n > ${PAID} THEN DATE '2026-11-04' + (n - ${PAID}) END,
             /* A paid payout was released and carries its ledger movement — both by CHECK. */
             CASE WHEN n <= ${PAID} THEN now() END,
             CASE WHEN n <= ${PAID} THEN gen_random_uuid() END,
             now() - ((${PAID + OPEN} - n) * INTERVAL '1 day')
      FROM generate_series(1, ${PAID + OPEN}) AS n
      RETURNING reference, (period_start - (current_date - 400))::int AS n
    `);

    oldest = made.rows.find((row) => row.n === 1)?.reference ?? '';

    const other = await db.execute<{ reference: string }>(sql`
      INSERT INTO partner_payouts (partner_id, currency_id, period_start, period_end, status)
      VALUES (${b}::uuid, (SELECT id FROM currencies WHERE code = 'USD'),
              current_date, current_date, 'pending_release')
      RETURNING reference
    `);

    foreign = other.rows[0]?.reference ?? '';

    return { mine: a, theirs: b };
  }
});
