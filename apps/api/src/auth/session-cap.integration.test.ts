import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { TokenService, type AccessTokenClaims } from './token.service.js';
import type { SettingsService } from '../settings/settings.service.js';
import type { Env } from '../config/env.js';

/**
 * The concurrent-session cap, against a REAL PostgreSQL (`O-sec-6`).
 *
 * ## What it is for
 *
 * `refresh_tokens` had no ceiling: an account could hold unlimited live sessions and nothing ever
 * ended one except its own expiry. Every stale session — a shared machine, an old phone, a browser
 * somebody forgot — stayed a live way in for as long as the token lived, invisibly.
 *
 * ## The tests are weighted toward what must NOT happen
 *
 * Retiring too many, or the wrong one, signs somebody out of a session they are using. That is a
 * worse outcome than the unbounded list this replaces, and it would arrive silently. So the cap
 * itself gets one test and the things it must leave alone get four.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** The cap in `token.service.ts`. Duplicated deliberately — see the note on the first test. */
const CAP = 10;

describeIfDb('the concurrent-session cap', () => {
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
    {} as unknown as SettingsService,
  );

  let userId = '';

  const claims = (): AccessTokenClaims => ({
    sub: userId,
    role: 'partner',
    permissions: [],
    locale: 'ar',
    totpEnabled: false,
  });

  beforeEach(async () => {
    await harness.begin();

    const rows = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash)
      VALUES (${`cap-${crypto.randomUUID()}@safra.test`}, '+963900000000',
              'partner', 'active', 'ar', 'x')
      RETURNING id
    `);

    userId = rows.rows[0]?.id ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** Live sessions, counted the way the cap counts them: by FAMILY, not by row. */
  async function liveSessions(): Promise<number> {
    const rows = await db.execute<{ n: string }>(sql`
      SELECT count(DISTINCT family_id)::text AS n
      FROM refresh_tokens
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL AND expires_at > now()
    `);

    return Number(rows.rows[0]?.n ?? 0);
  }

  /** One sign-in — no `familyId`, so a new family. */
  const signIn = () => service.issue(claims(), {});

  /**
   * The cap holds.
   *
   * `CAP` is written out here rather than imported, on purpose: the constant in the service is a
   * product judgement somebody may move, and a test that imported it would follow the change
   * silently and assert nothing. If this fails because the number moved, the number moved.
   */
  it('keeps at most the cap, however many times somebody signs in', async () => {
    for (let i = 0; i < CAP + 5; i += 1) await signIn();

    expect(await liveSessions()).toBe(CAP);
  });

  /** Under the cap, nothing is touched at all. */
  it('leaves every session alone below the cap', async () => {
    for (let i = 0; i < CAP - 1; i += 1) await signIn();

    expect(await liveSessions()).toBe(CAP - 1);
  });

  /**
   * THE assertion. The session that was just created must survive its own creation — retiring
   * newest-first would sign somebody out at the moment they signed in.
   */
  it('never retires the session it has just issued', async () => {
    for (let i = 0; i < CAP; i += 1) await signIn();

    const newest = await signIn();

    const rows = await db.execute<{ revoked: boolean }>(sql`
      SELECT revoked_at IS NOT NULL AS revoked
      FROM refresh_tokens
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC
      LIMIT 1
    `);

    expect(newest.refreshToken).toBeTruthy();
    expect(rows.rows[0]?.revoked).toBe(false);
  });

  /**
   * A ROTATION is not a new session.
   *
   * `issue` is called on every refresh — every fifteen minutes, per active session — carrying the
   * existing family. Counting those would retire somebody's oldest session four times an hour
   * until only the busiest survived.
   */
  it('does not count a rotation as a new session', async () => {
    for (let i = 0; i < CAP; i += 1) await signIn();

    const family = await db.execute<{ family_id: string }>(sql`
      SELECT family_id FROM refresh_tokens
      WHERE user_id = ${userId}::uuid ORDER BY created_at ASC LIMIT 1
    `);

    for (let i = 0; i < 5; i += 1) {
      await service.issue(claims(), { familyId: family.rows[0]?.family_id });
    }

    expect(await liveSessions()).toBe(CAP);
  });

  /** And one account's sign-ins never reach another's sessions. */
  it('retires only the account that signed in', async () => {
    const other = await db.execute<{ id: string }>(sql`
      INSERT INTO users (email, phone, role, status, preferred_locale, password_hash)
      VALUES (${`cap-other-${crypto.randomUUID()}@safra.test`}, '+963900000000',
              'partner', 'active', 'ar', 'x')
      RETURNING id
    `);

    const otherId = other.rows[0]?.id ?? '';

    await service.issue({ ...claims(), sub: otherId }, {});

    for (let i = 0; i < CAP + 5; i += 1) await signIn();

    const rows = await db.execute<{ n: string }>(sql`
      SELECT count(*)::text AS n FROM refresh_tokens
      WHERE user_id = ${otherId}::uuid AND revoked_at IS NULL
    `);

    expect(Number(rows.rows[0]?.n ?? 0)).toBe(1);
  });
});
