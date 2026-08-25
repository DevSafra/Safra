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
   * Ages every existing row, so ORDER matters (2026-08-25).
   *
   * ## Why this is necessary, and why its absence made four of five tests toothless
   *
   * `created_at` defaults to `now()`, and `now()` is the TRANSACTION timestamp — this suite runs
   * inside one rollback transaction, so **every row it writes carries the identical instant**.
   * `ORDER BY min(created_at)` over ties is arbitrary, which means the retirement query could not be
   * observed to pick the oldest, the newest, or anything else.
   *
   * Measured on 2026-08-25 by mutation: reversing the query's ordering to retire the NEWEST family —
   * signing somebody out at the moment they sign in, which the third test's docblock calls "THE
   * assertion" — left all five tests GREEN. Only deleting the cap outright failed one of them.
   *
   * So each sign-in is followed by pushing everything already written one minute further into the
   * past. The rows then have a real order, and the mutation above now fails.
   *
   * This is the trap `.claude/CLAUDE.md` records under "`now()` is the TRANSACTION timestamp".
   */
  async function ageExistingRows(): Promise<void> {
    await db.execute(sql`
      UPDATE refresh_tokens
      SET created_at = created_at - interval '1 minute'
      WHERE user_id = ${userId}::uuid
    `);
  }

  /** A sign-in that is genuinely NEWER than every session before it. */
  async function signInLater(): Promise<Awaited<ReturnType<typeof signIn>>> {
    await ageExistingRows();

    return signIn();
  }

  /** The family a refresh token belongs to, so a test can name the session it just created. */
  async function familyOf(refreshToken: string): Promise<string> {
    const rows = await db.execute<{ family_id: string }>(sql`
      SELECT family_id FROM refresh_tokens
      WHERE user_id = ${userId}::uuid
      ORDER BY created_at DESC, family_id
      LIMIT 1
    `);

    expect(refreshToken).toBeTruthy();

    return rows.rows[0]?.family_id ?? '';
  }

  /** Which families are still live, oldest first — the order the cap decides on. */
  async function liveFamiliesOldestFirst(): Promise<string[]> {
    const rows = await db.execute<{ family_id: string }>(sql`
      SELECT family_id FROM refresh_tokens
      WHERE user_id = ${userId}::uuid AND revoked_at IS NULL
      GROUP BY family_id
      ORDER BY min(created_at) ASC
    `);

    return rows.rows.map((row) => row.family_id);
  }

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

  /**
   * The OLDEST session goes, and the newest survive — asserted on rows that have a real order.
   *
   * This is what the suite claimed and could not show. With every `created_at` tied, retiring the
   * newest family passed every test above; with the rows aged, the identity of the survivors is
   * observable and the mutation fails.
   */
  it('retires the oldest session and keeps the newest', async () => {
    const families: string[] = [];

    for (let i = 0; i < CAP; i += 1) {
      const issued = await signInLater();

      families.push(await familyOf(issued.refreshToken));
    }

    /* At the cap, all ten are live and in the order they were created. */
    expect(await liveFamiliesOldestFirst()).toStrictEqual(families);

    const eleventh = await signInLater();
    const newest = await familyOf(eleventh.refreshToken);
    const survivors = await liveFamiliesOldestFirst();

    expect(survivors).toHaveLength(CAP);

    /* The first one signed in is gone… */
    expect(survivors).not.toContain(families[0]);
    /* …the one just issued is not… */
    expect(survivors).toContain(newest);
    /* …and it is the LAST of them, so nothing else was reordered. */
    expect(survivors.at(-1)).toBe(newest);
    /* …and the other nine are exactly the nine that were not oldest. */
    expect(survivors.slice(0, CAP - 1)).toStrictEqual(families.slice(1));
  });

  /**
   * A rotation retires nothing, even when the retirement query CAN see an order.
   *
   * **Honest limit, stated because it would otherwise be assumed away:** this test cannot fail
   * against a missing `isNewSession` guard, and neither can any other. A rotation adds a row to an
   * EXISTING family, so an `OFFSET CAP` over families finds nothing past the cap whatever the guard
   * says — measured by mutation on 2026-08-25. The guard is a cost and clarity measure, not a
   * correctness one, and `token.service.ts` now says so instead of claiming otherwise.
   *
   * What this DOES prove, with the rows aged so ordering is observable, is the property somebody
   * actually depends on: refreshing a session does not end any session, including the oldest one —
   * which is the one being refreshed here, and the one a retirement would take first.
   */
  it('retires nothing on a rotation, whichever way the rows are ordered', async () => {
    const families: string[] = [];

    for (let i = 0; i < CAP; i += 1) {
      const issued = await signInLater();

      families.push(await familyOf(issued.refreshToken));
    }

    for (let i = 0; i < 5; i += 1) {
      await ageExistingRows();
      await service.issue(claims(), { familyId: families[0] });
    }

    /* Every family still live, the oldest one included — it is the one being refreshed. */
    expect(await liveFamiliesOldestFirst()).toStrictEqual(families);
  });
});
