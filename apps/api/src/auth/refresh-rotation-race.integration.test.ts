import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { TokenService, type AccessTokenClaims } from './token.service.js';
import { SettingsService } from '../settings/settings.service.js';
import type { Env } from '../config/env.js';

/**
 * Refresh-token rotation under a race, against a REAL PostgreSQL.
 *
 * ## The defect
 *
 * `rotate` read the presented token, checked `revoked_at IS NULL` in JavaScript, issued a new pair
 * and THEN revoked the old one with an unconditional UPDATE. Two refreshes presenting the same token
 * both passed the read before either wrote, so both got a fresh, independent session: one stolen
 * refresh token, replayed alongside its owner, became a second live lineage the reuse detection
 * never saw.
 *
 * ## What is asserted
 *
 * Exactly one of two concurrent rotations succeeds, and the loser is treated as the replay it is —
 * the family is burned, so neither side keeps a live session off the contested token. The control
 * is a single rotation, which must still work.
 *
 * Both rotations share the harness's one connection, which still interleaves them at every await —
 * both reads happen before either write, the interleaving that produced the bug.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('refresh-token rotation', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const service = new TokenService(
    {
      JWT_ACCESS_SECRET: 'a'.repeat(64),
      JWT_REFRESH_SECRET: 'b'.repeat(64),
      ACCESS_TOKEN_TTL: '15m',
      REFRESH_TOKEN_TTL: '30d',
    } as unknown as Env,
    db,
    new SettingsService(db),
  );

  let userId = '';

  const claims = (): AccessTokenClaims => ({
    sub: userId,
    role: 'customer',
    permissions: [],
    locale: 'ar',
  });

  beforeEach(async () => {
    await harness.begin();

    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash,
                         email_verified_at)
      VALUES (${`rotate-${crypto.randomUUID()}@safra.test`}, '+963900000000',
              'customer', 'active', 'ar', 'x', now())
      RETURNING id
    `);

    userId = rows.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  async function liveTokens(): Promise<number> {
    const rows = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM refresh_tokens
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
    `);

    return Number(rows.rows[0]?.n ?? 0);
  }

  it('rotates a token once', async () => {
    const issued = await service.issue(claims(), {});

    const rotated = await service.rotate(issued.refreshToken, {});

    expect(rotated).not.toBeNull();
    expect(await liveTokens()).toBe(1);
  });

  it('lets only one of two concurrent rotations of the same token succeed', async () => {
    const issued = await service.issue(claims(), {});

    const results = await Promise.all([
      service.rotate(issued.refreshToken, {}),
      service.rotate(issued.refreshToken, {}),
    ]);

    expect(results.filter((result) => result !== null)).toHaveLength(1);
  });

  it('treats the losing rotation as a replay and burns the family', async () => {
    const issued = await service.issue(claims(), {});

    await Promise.all([
      service.rotate(issued.refreshToken, {}),
      service.rotate(issued.refreshToken, {}),
    ]);

    expect(await liveTokens()).toBe(0);
  });
});
