import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { CredentialRetentionService } from './credential-retention.service.js';
import { JobRunService } from '../common/jobs/job-run.service.js';

/**
 * The nightly sweep of dead credentials, against a REAL PostgreSQL (`O-sec-6`, `O-sec-11`).
 *
 * ## The property that matters is what it does NOT delete
 *
 * `login_codes` and `refresh_tokens` grow on every sign-in and every rotation, and nothing removed
 * a row from either — unbounded growth, which rule 2 forbids. The sweep closes that. But the
 * dangerous half of a `DELETE` job is never the rows it removes: get the predicate wrong here and
 * this signs every partner and customer out overnight, which is an outage delivered on a cron.
 *
 * So the tests below are weighted accordingly. Each table gets one assertion that the dead row goes
 * and three that a live one, a recent one, and a still-valid one all stay.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('CredentialRetentionService', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const service = new CredentialRetentionService(db, new JobRunService(db));

  let userId = '';

  beforeEach(async () => {
    await harness.begin();

    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash)
      VALUES (${`retention-${crypto.randomUUID()}@safra.test`}, '+963900000000',
              'partner', 'active', 'ar', 'x')
      RETURNING id
    `);

    userId = rows.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** A sign-in code, positioned in time and in lifecycle. */
  async function code(options: {
    ageDays: number;
    consumed?: boolean;
    expired?: boolean;
  }): Promise<void> {
    await db.execute(sql`
      INSERT INTO login_codes (user_id, code_hash, expires_at, consumed_at, created_at)
      VALUES (
        ${userId}::uuid, 'hash',
        now() + (${options.expired ? -1 : 60}::int * INTERVAL '1 minute'),
        ${options.consumed ? sql`now()` : sql`NULL`},
        now() - (${options.ageDays}::int * INTERVAL '1 day')
      )
    `);
  }

  const codeCount = async (): Promise<number> => {
    const rows = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM login_codes WHERE user_id = ${userId}::uuid`,
    );

    return Number(rows.rows[0]?.n ?? 0);
  };

  describe('sign-in codes', () => {
    it('removes a spent code past the window', async () => {
      await code({ ageDays: 30, consumed: true });

      expect(await service.pruneLoginCodes()).toBe(1);
      expect(await codeCount()).toBe(0);
    });

    it('removes an unused code that expired long ago', async () => {
      await code({ ageDays: 30, expired: true });

      expect(await service.pruneLoginCodes()).toBe(1);
    });

    /** Inside the window it is still evidence — that is what the window is for. */
    it('keeps a spent code from this morning', async () => {
      await code({ ageDays: 0, consumed: true });

      expect(await service.pruneLoginCodes()).toBe(0);
      expect(await codeCount()).toBe(1);
    });

    /**
     * THE assertion. A code that is still redeemable must survive whatever the clock says about
     * the row's age, or this job cancels a sign-in somebody is halfway through.
     */
    it('never touches a live code, however the dates fall', async () => {
      await code({ ageDays: 30 });

      expect(await service.pruneLoginCodes()).toBe(0);
      expect(await codeCount()).toBe(1);
    });
  });

  /** A refresh token, positioned the same way. */
  async function token(options: {
    ageDays: number;
    revoked?: boolean;
    expired?: boolean;
  }): Promise<void> {
    await db.execute(sql`
      INSERT INTO refresh_tokens
        (user_id, token_hash, family_id, expires_at, revoked_at, created_at)
      VALUES (
        ${userId}::uuid, ${`hash-${crypto.randomUUID()}`}, gen_random_uuid(),
        now() + (${options.expired ? -1 : 30}::int * INTERVAL '1 day'),
        ${options.revoked ? sql`now()` : sql`NULL`},
        now() - (${options.ageDays}::int * INTERVAL '1 day')
      )
    `);
  }

  const tokenCount = async (): Promise<number> => {
    const rows = await db.execute<{ n: string }>(
      sql`SELECT count(*)::text AS n FROM refresh_tokens WHERE user_id = ${userId}::uuid`,
    );

    return Number(rows.rows[0]?.n ?? 0);
  };

  describe('refresh tokens', () => {
    it('removes a revoked token past the window', async () => {
      await token({ ageDays: 120, revoked: true });

      expect(await service.pruneRefreshTokens()).toBe(1);
      expect(await tokenCount()).toBe(0);
    });

    it('removes one that expired long ago', async () => {
      await token({ ageDays: 120, expired: true });

      expect(await service.pruneRefreshTokens()).toBe(1);
    });

    /** A family revoked by replay detection is the record of a stolen session. */
    it('keeps a revoked token inside the window', async () => {
      await token({ ageDays: 10, revoked: true });

      expect(await service.pruneRefreshTokens()).toBe(0);
      expect(await tokenCount()).toBe(1);
    });

    /**
     * THE assertion, and the reason the predicate asks about lifecycle rather than age.
     *
     * A session refreshed this morning on a token issued months ago is a person who is signed in.
     * Deleting it to save a few bytes signs them out — and it would sign out everybody at once,
     * silently, at half past three in the morning.
     */
    it('never touches a live token, however old the row is', async () => {
      await token({ ageDays: 365 });

      expect(await service.pruneRefreshTokens()).toBe(0);
      expect(await tokenCount()).toBe(1);
    });
  });

  /** The pass records a run, so alerting can see it stop. */
  it('writes a scheduled_job_runs row', async () => {
    await service.prune();

    const rows = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM scheduled_job_runs
      WHERE job = 'credential-retention' ORDER BY finished_at DESC LIMIT 1
    `);

    expect(rows.rows[0]?.status).toBe('completed');
  });
});
