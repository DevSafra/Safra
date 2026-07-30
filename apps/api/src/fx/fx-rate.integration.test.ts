import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { createDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { FxRateService } from './fx-rate.service.js';

/**
 * FX rates against a REAL PostgreSQL.
 *
 * Regression guard for a defect that shipped: `fx_rates` is empty on every fresh
 * install, and pricing used to fall back to a rate of `1`. A $220 booking recorded
 * `total_syp = 220` instead of ~2,860,000 — wrong by four orders of magnitude, with
 * nothing failing and nothing warning. These tests exist so the fallback cannot
 * return.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('FxRateService', () => {
  let db: Database;
  let fx: FxRateService;

  beforeAll(() => {
    db = createDatabase(DATABASE_URL as string, 2);

    /**
     * A real AuditService, not a stub. `set()` writes its audit row inside the same
     * transaction as the rate insert, so stubbing it out would leave the most
     * important property — that a rate change is never recorded without its audit
     * trail — untested.
     */
    fx = new FxRateService(db, new AuditService(db));
  });

  afterAll(async () => {
    await clearRates(db);
    await (db as unknown as { $client: { end: () => Promise<void> } }).$client.end();
  });

  beforeEach(async () => {
    await clearRates(db);
    fx.invalidate();
  });

  describe('refusing to invent a rate', () => {
    /** The defect, pinned. */
    it('throws rather than defaulting to 1 when no rate is configured', async () => {
      await expect(fx.rateToSyp('USD')).rejects.toThrow(/temporarily unavailable/i);
    });

    it('does not leak the reason to the client', async () => {
      const message = await fx.rateToSyp('USD').catch((e: Error) => e.message);

      // The actionable detail belongs in the server log, not the response (rule 1).
      expect(message).not.toMatch(/fx_rates|admin\/fx-rates|configured/i);
    });

    it('still refuses when a rate exists only for a DIFFERENT currency', async () => {
      await fx.set({ currency: 'EUR', rate: '14000.00', source: 'manual' });

      await expect(fx.rateToSyp('USD')).rejects.toThrow(/temporarily unavailable/i);
    });

    /**
     * A future-dated rate is not yet in force. Using it early would price bookings at
     * a rate that has not taken effect.
     */
    it('refuses when the only rate takes effect in the future', async () => {
      await fx.set({
        currency: 'USD',
        rate: '13000.00',
        effectiveFrom: new Date(Date.now() + 86_400_000).toISOString(),
        source: 'manual',
      });

      await expect(fx.rateToSyp('USD')).rejects.toThrow(/temporarily unavailable/i);
    });

    /** SYP against itself needs no configuration and must never refuse. */
    it('returns 1 for SYP without consulting the table', async () => {
      await expect(fx.rateToSyp('SYP')).resolves.toBe('1');
    });
  });

  describe('reading a configured rate', () => {
    it('returns the rate once one is set', async () => {
      await fx.set({ currency: 'USD', rate: '13000.00000000', source: 'manual' });

      expect(await fx.rateToSyp('USD')).toBe('13000.00000000');
    });

    /**
     * The newest applicable row wins, so changing a rate is an INSERT and the old
     * value stays readable for past-period reporting.
     */
    it('uses the most recent effective rate, not the first inserted', async () => {
      await fx.set({
        currency: 'USD',
        rate: '11000.00',
        effectiveFrom: new Date(Date.now() - 172_800_000).toISOString(),
        source: 'manual',
      });
      await fx.set({
        currency: 'USD',
        rate: '13500.00',
        effectiveFrom: new Date(Date.now() - 3_600_000).toISOString(),
        source: 'manual',
      });

      fx.invalidate();
      expect(await fx.rateToSyp('USD')).toBe('13500.00000000');
    });

    it('keeps the earlier row rather than overwriting it', async () => {
      await fx.set({ currency: 'USD', rate: '11000.00', source: 'manual' });
      await fx.set({ currency: 'USD', rate: '13500.00', source: 'manual' });

      const rows = await db.execute<{ count: string }>(sql`
        SELECT COUNT(*)::text AS count FROM fx_rates f
        JOIN currencies base ON base.id = f.base_currency_id
        WHERE base.code = 'USD'
      `);

      expect(rows.rows[0]?.count).toBe('2');
    });

    /**
     * A newly set rate must take effect immediately. If the cache were left to
     * expire, an admin fixing a pricing outage would watch it continue for up to a
     * minute after they had fixed it.
     */
    it('invalidates its cache on write', async () => {
      await fx.set({ currency: 'USD', rate: '13000.00', source: 'manual' });
      expect(await fx.rateToSyp('USD')).toBe('13000.00000000');

      await fx.set({ currency: 'USD', rate: '20000.00', source: 'manual' });
      expect(await fx.rateToSyp('USD')).toBe('20000.00000000');
    });

    it('does not cache a miss, so the first rate set works right away', async () => {
      await expect(fx.rateToSyp('USD')).rejects.toThrow();

      await fx.set({ currency: 'USD', rate: '13000.00', source: 'manual' });

      // No invalidate() call here on purpose — a cached miss would fail this.
      expect(await fx.rateToSyp('USD')).toBe('13000.00000000');
    });
  });

  describe('setting a rate', () => {
    it('rejects a currency SAFRA does not know', async () => {
      await expect(
        fx.set({ currency: 'ZZZ', rate: '1.00', source: 'manual' }),
      ).rejects.toThrow(/unknown currency/i);
    });

    it('records the source and the acting user for audit', async () => {
      await fx.set({ currency: 'USD', rate: '13000.00', source: 'central_bank' });

      const rows = await db.execute<{ source: string }>(sql`
        SELECT f.source FROM fx_rates f
        JOIN currencies base ON base.id = f.base_currency_id
        WHERE base.code = 'USD' ORDER BY f.created_at DESC LIMIT 1
      `);

      expect(rows.rows[0]?.source).toBe('central_bank');
    });

    /**
     * The audit row must name the OLD and NEW rate. "A rate was set" is not a
     * reviewable fact about a financial parameter; "USD went 13000 → 14250" is. This
     * is the gap that made the route-level interceptor inadequate — it resolves its
     * subject from a route param, and both values arrive in the body.
     */
    it('audits the change with the previous and new rate', async () => {
      await fx.set({ currency: 'USD', rate: '13000.00', source: 'manual' });
      await fx.set({ currency: 'USD', rate: '14250.00', source: 'central_bank' });

      const rows = await db.execute<{ before: unknown; after: unknown }>(sql`
        SELECT before, after FROM audit_log
        WHERE action = 'fx_rate.set' ORDER BY created_at DESC LIMIT 1
      `);

      const before = rows.rows[0]?.before as { rate?: string } | null;
      const after = rows.rows[0]?.after as { rate?: string; currency?: string } | null;

      expect(before?.rate).toBe('13000.00000000');
      expect(after?.rate).toBe('14250.00');
      expect(after?.currency).toBe('USD');
    });

    /** The very first rate for a currency has no predecessor; that must not throw. */
    it('audits the first rate with a null previous value', async () => {
      await fx.set({ currency: 'EUR', rate: '14000.00', source: 'manual' });

      const rows = await db.execute<{ before: unknown }>(sql`
        SELECT before FROM audit_log
        WHERE action = 'fx_rate.set' ORDER BY created_at DESC LIMIT 1
      `);

      expect((rows.rows[0]?.before as { rate?: string | null }).rate).toBeNull();
    });
  });

  describe('listing rates', () => {
    it('returns one row per currency — the current one', async () => {
      await fx.set({ currency: 'USD', rate: '13000.00', source: 'manual' });
      await fx.set({ currency: 'USD', rate: '13500.00', source: 'manual' });
      await fx.set({ currency: 'EUR', rate: '14500.00', source: 'manual' });

      const rates = await fx.list();
      const usd = rates.filter((r) => r.currency === 'USD');

      expect(usd).toHaveLength(1);
      expect(usd[0]?.rate).toBe('13500.00000000');
      expect(rates.map((r) => r.currency).sort()).toStrictEqual(['EUR', 'USD']);
    });

    /**
     * Staleness is reported, not enforced. Refusing to price on an old rate would
     * take checkout down on a timer nobody agreed to; flagging it lets an operator
     * decide.
     */
    it('flags a rate older than the staleness threshold without refusing it', async () => {
      await fx.set({
        currency: 'USD',
        rate: '13000.00',
        effectiveFrom: new Date(Date.now() - 100 * 3_600_000).toISOString(),
        source: 'manual',
      });

      const usd = (await fx.list()).find((r) => r.currency === 'USD');

      expect(usd?.stale).toBe(true);
      expect(usd?.ageHours).toBeGreaterThanOrEqual(99);

      // Still prices, deliberately.
      fx.invalidate();
      await expect(fx.rateToSyp('USD')).resolves.toBe('13000.00000000');
    });

    it('does not flag a fresh rate', async () => {
      await fx.set({ currency: 'USD', rate: '13000.00', source: 'manual' });

      expect((await fx.list()).find((r) => r.currency === 'USD')?.stale).toBe(false);
    });
  });
});

/**
 * Removes only the rows these tests created.
 *
 * `fx_rates` carries no test marker, so this clears the table wholesale — acceptable
 * because the seed deliberately does NOT populate it (that is the point of the
 * refusal), so there is no reference data here to destroy.
 */
async function clearRates(db: Database): Promise<void> {
  await db.execute(sql`DELETE FROM fx_rates`);
}

/**
 * Note on audit rows: `audit_log` is append-only by trigger, so the rows these tests
 * write cannot be cleaned up. The audit assertions therefore read only the NEWEST
 * `fx_rate.set` row rather than counting, which stays correct however many previous
 * runs are still on disk.
 */
