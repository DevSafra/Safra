import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { describeError, framesOnly } from './safe-error.js';

/**
 * A REAL driver failure, described without its bound values (`O-sec-7`).
 *
 * ## Why this exists beside the unit test
 *
 * `safe-error.test.ts` builds a `DrizzleQueryError`-shaped object by hand, which is the right
 * fixture for the helper and cannot prove the thing that actually matters: that the error the REAL
 * driver raises against the REAL database carries its values where `describeError` looks. The whole
 * finding came from watching a live sign-in write `params: someone@safra.test,1` — not from reading
 * the library — so the assertion belongs against a live failure too.
 *
 * If drizzle ever moves the values somewhere else, the hand-built fixture keeps passing and this
 * fails. That is the point of having both.
 *
 * ## Why a savepoint
 *
 * Any error aborts a PostgreSQL transaction, and this suite runs inside one so it can roll back.
 * Provoking a real failure would therefore poison every statement after it, including the harness's
 * own rollback. `SAVEPOINT` / `ROLLBACK TO` scopes the damage to the one statement.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Values chosen to be unmistakable if they ever appear: an address and a hash. */
const EMAIL = 'osec7-probe@safra.test';
const HASH = '$argon2id$v=19$m=65536,t=3,p=4$c3VycmVwdGl0aW91cw$bm90LWEtcmVhbC1oYXNo';

describeIfDb('describing a real driver failure', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  /* Called through, not passed as references — the style every other suite here uses. */
  beforeEach(async () => {
    await harness.begin();
  });
  afterEach(async () => {
    await harness.rollback();
  });
  afterAll(async () => {
    await harness.close();
  });

  /** Provokes a genuine `DrizzleQueryError` with bound parameters, leaving the transaction usable. */
  async function realFailure(): Promise<unknown> {
    await db.execute(sql`SAVEPOINT osec7`);

    try {
      await db.execute(sql`
        INSERT INTO a_table_that_does_not_exist (email, password_hash)
        VALUES (${EMAIL}, ${HASH})
      `);

      throw new Error('The probe statement was expected to fail and did not.');
    } catch (error) {
      await db.execute(sql`ROLLBACK TO SAVEPOINT osec7`);

      return error;
    }
  }

  it('is a failure that really does carry its values, or this test proves nothing', async () => {
    const error = await realFailure();

    /*
      The PRECONDITION, asserted rather than assumed. If the raw error stopped carrying the address,
      every assertion below would pass against a describer that did nothing at all — and somebody
      would then delete the fix as unnecessary.
    */
    const raw = error instanceof Error ? `${error.message}${error.stack ?? ''}` : '';

    expect(raw).toContain(EMAIL);
    expect(raw).toContain(HASH);
  });

  it('withholds both values, and keeps the statement and the SQLSTATE', async () => {
    const described = describeError(await realFailure());

    expect(described).not.toContain(EMAIL);
    expect(described).not.toContain(HASH);
    expect(described).not.toContain('params:');
    expect(described).not.toContain('$argon2');
    expect(described).not.toContain('@');

    /* The useful half, or an operator learns nothing from a failed job. */
    expect(described).toContain('a_table_that_does_not_exist');
    expect(described).toContain('bound parameter(s), NOT logged');
    /* `42P01` is undefined_table. */
    expect(described).toContain('42P01');
  });

  it('withholds them from the stack that is logged beside it', async () => {
    const error = await realFailure();
    const frames = error instanceof Error ? (framesOnly(error) ?? '') : '';

    expect(frames).not.toContain(EMAIL);
    expect(frames).not.toContain(HASH);
    /* And it is still a stack. */
    expect(frames).toContain('    at ');
  });
});
