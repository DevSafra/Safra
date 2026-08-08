import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { SettingsAdminService } from './settings-admin.service.js';
import { SettingsService } from './settings.service.js';

/**
 * The Rules Engine against a REAL PostgreSQL (SRS §9.3, P-005).
 *
 * Settings govern money — the commission rate, the service fee, the SLA window — so
 * the properties worth pinning are not "the form works" but: a bad value cannot get
 * in, a change cannot happen without its record, and that record cannot later be
 * altered.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('SettingsAdminService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  let db: Database;
  let admin: SettingsAdminService;
  let settings: SettingsService;

  /**
   * This suite owns its own setting rather than editing a real one.
   *
   * It used to edit `booking.confirmation_window_minutes`, which `BookingActionsService`
   * and `CatalogService` both read, while vitest runs files in parallel — so another
   * suite could observe a changed value and fail for a reason with no visible
   * connection to settings. Restoring in `afterEach` shrank that window but could not
   * close it.
   *
   * A row created here consumes nothing, so no window exists at all.
   *
   * ONE stable key, not one per run. It cannot be deleted afterwards —
   * `settings_history` holds a foreign key to `settings.id` and is append-only by
   * trigger, so any setting that has ever been edited is permanent. A per-run key would
   * therefore leave a new undeletable row behind every time. This leaves exactly one,
   * ever, and its description explains itself to anyone who meets it in the Rules
   * Engine screen.
   */
  const KEY = 'test.settings_admin_fixture';
  const ORIGINAL_VALUE = 120;
  let original: unknown;

  beforeEach(async () => {
    await harness.begin();

    db = harness.db;
    settings = new SettingsService(db);
    admin = new SettingsAdminService(db, settings, new AuditService(db));

    /**
     * Insert-if-absent then reset, rather than `ON CONFLICT`. The unique index on
     * settings is PARTIAL (`WHERE deleted_at IS NULL`), so an `ON CONFLICT` clause has
     * to repeat that predicate exactly or Postgres rejects it — a detail of the index
     * that a test has no business depending on.
     */
    await db.execute(sql`
      INSERT INTO settings (key, scope, value, value_schema, description_en)
      SELECT ${KEY}, 'global', ${JSON.stringify(ORIGINAL_VALUE)}::jsonb, 'positiveInt',
             'Integration-test fixture for the settings editor. Read by no code; safe to ignore.'
      WHERE NOT EXISTS (
        SELECT 1 FROM settings WHERE key = ${KEY} AND deleted_at IS NULL
      )
    `);

    await db.execute(sql`
      UPDATE settings SET value = ${JSON.stringify(ORIGINAL_VALUE)}::jsonb
      WHERE key = ${KEY} AND deleted_at IS NULL
    `);

    original = ORIGINAL_VALUE;
  });

  /**
   * Nothing to remove. The fixture row is permanent by design — see the note on `KEY` —
   * and `afterEach` has already restored its value, so the next run starts clean.
   */
  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  beforeEach(() => {
    settings.invalidate();
  });

  /**
   * Still restored per test, so each one starts from a known value regardless of
   * ordering. Cheap, and it keeps the assertions independent.
   */
  afterEach(async () => {
    await db.execute(sql`
      UPDATE settings SET value = ${JSON.stringify(original)}::jsonb
      WHERE key = ${KEY} AND scope = 'global'
    `);

    settings.invalidate();
  });

  describe('rejecting values that would silently misconfigure the platform', () => {
    /**
     * The failure mode this guards. `SettingsService.getNumber` falls back to the
     * caller's default when the stored value is not a number — so a rate saved as a
     * string leaves every commission using the hardcoded fallback while the admin
     * screen displays the new figure. Nothing throws and nothing warns.
     */
    it('refuses a numeric setting supplied as a string', async () => {
      await expect(admin.update(KEY, '90', undefined, {})).rejects.toThrow(
        /whole number/i,
      );
    });

    it('refuses a rate outside 0..1, which is how 7% becomes 700%', async () => {
      await expect(
        admin.update('commission.partner_rate', 7, undefined, {}),
      ).rejects.toThrow(/between 0 and 1/i);
    });

    it('refuses a negative fine, which would invert who owes whom', async () => {
      await expect(
        admin.update('partner.first_violation_fine', -10, undefined, {}),
      ).rejects.toThrow(/positive amount/i);
    });

    /**
     * A typo must not create a second, plausible-looking key. `commision.partner_rate`
     * would never be consulted, and the real setting would stay silently in force.
     */
    it('refuses to create a key that was never seeded', async () => {
      await expect(
        admin.update('commision.partner_rate', 0.07, undefined, {}),
      ).rejects.toThrow(/settings are seeded/i);
    });

    /**
     * `payment.provider_routing` is a nested object this editor cannot check. Waving
     * an unknown schema through is how a typo breaks payment routing.
     */
    it('refuses a schema it cannot validate rather than accepting it', async () => {
      await expect(
        admin.update('payment.provider_routing', { '*': [] }, undefined, {}),
      ).rejects.toThrow(/cannot validate/i);
    });

    it('leaves the stored value untouched after a rejection', async () => {
      await admin.update(KEY, '90', undefined, {}).catch(() => undefined);

      const row = await db.execute<{ value: unknown }>(
        sql`SELECT value FROM settings WHERE key = ${KEY} AND scope = 'global'`,
      );

      expect(row.rows[0]?.value).toEqual(original);
    });
  });

  describe('recording the change', () => {
    it('writes history and audit together with the value', async () => {
      const before = await currentValue(db, KEY);

      await admin.update(KEY, 91, 'Ramadan pilot', {});

      const history = await admin.history(KEY, 1);

      expect(history[0]).toMatchObject({
        previousValue: before,
        newValue: 91,
        reason: 'Ramadan pilot',
      });

      const audit = await db.execute<{ after: { value: number } }>(sql`
        SELECT after FROM audit_log
        WHERE action = 'setting.updated' AND after->>'key' = ${KEY}
        ORDER BY created_at DESC LIMIT 1
      `);

      expect(audit.rows[0]?.after.value).toBe(91);
    });

    /**
     * The point of invalidating rather than waiting out the 30-second TTL: an
     * operator who closes the same-day cutoff must see it take effect, not wonder
     * whether the save worked.
     */
    it('makes the new value readable immediately, not after the cache TTL', async () => {
      await settings.get(KEY, 0); // Warm the cache with the old value.
      await admin.update(KEY, 92, undefined, {});

      expect(await settings.get(KEY, 0)).toBe(92);
    });
  });

  describe('the history is evidence', () => {
    /**
     * Regression guard. `settings_history` was created without the append-only
     * trigger its siblings (`audit_log`, `timeline_events`, `ledger_entries`) all
     * carry, so the record of who changed a commission rate could be rewritten or
     * deleted outright — by anything holding a database connection.
     */
    it('cannot be updated', async () => {
      await admin.update(KEY, 93, 'to be tampered with', {});

      await expect(
        db.execute(sql`
          UPDATE settings_history SET reason = 'covered up'
          WHERE key = ${KEY} AND reason = 'to be tampered with'
        `),
      ).rejects.toSatisfy(isAppendOnlyRefusal);
    });

    it('cannot be deleted', async () => {
      await expect(
        db.execute(sql`DELETE FROM settings_history WHERE key = ${KEY}`),
      ).rejects.toSatisfy(isAppendOnlyRefusal);
    });
  });
});

/**
 * Asserts the rejection came from the append-only trigger, not from anything else.
 *
 * Drizzle wraps a driver error as "Failed query: …" and hangs the real one off
 * `cause`, so matching the top-level message would pass for ANY failed statement —
 * including a typo in the test's own SQL. The trigger's own text is what proves the
 * guard fired.
 */
function isAppendOnlyRefusal(error: unknown): boolean {
  const cause = (error as { cause?: unknown }).cause;
  const message = cause instanceof Error ? cause.message : String(error);

  return /append-only/i.test(message);
}

async function currentValue(db: Database, key: string): Promise<unknown> {
  const row = await db.execute<{ value: unknown }>(
    sql`SELECT value FROM settings WHERE key = ${key} AND scope = 'global'`,
  );

  return row.rows[0]?.value;
}
