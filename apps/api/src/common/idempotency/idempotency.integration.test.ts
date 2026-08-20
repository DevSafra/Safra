import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { IdempotencyService } from './idempotency.service.js';
import { codeOf } from '../errors/app-error.js';

/**
 * The two failure paths that only appear when something else is already failing.
 *
 * EC-003's happy path — press Pay twice, get one booking — is covered where bookings are tested.
 * This suite is about what happens when the RELEASE fails, which is a state no fixture-sized test
 * ever reaches because nothing is under enough pressure to fail twice.
 *
 * Scenario 2 of the load test reached it 487 times in five minutes on 2026-08-20. The pool was
 * exhausted, so the booking could not get a connection and neither could the `DELETE` that releases
 * the claim — and because the release was a bare `await` before `throw error`, the release's own
 * error replaced the real one and the claim was never let go. The customer's retry then got 409
 * «الطلب قيد المعالجة» for the full 24-hour retention, and the checkout form reuses one key per
 * mount, so pressing the button again could not get past it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('IdempotencyService under failure', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let service: IdempotencyService;
  let key: string;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    service = new IdempotencyService(db);
    key = `idem-test-${Math.random().toString(36).slice(2, 12)}`;
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  const call = { key: '', scope: 'booking.create', request: { unit: 'a', nights: 2 } };
  const callFor = (k: string) => ({ ...call, key: k });

  const claim = async (): Promise<{ status: string; age: string } | undefined> => {
    const rows = await db.execute<{ status: string; age: string }>(sql`
      SELECT status, (now() - created_at)::text AS age
      FROM idempotency_keys WHERE key = ${key} LIMIT 1
    `);

    return rows.rows[0];
  };

  // ─── The release path ──────────────────────────────────────────────────────

  it('releases the claim when the handler fails, so a retry can proceed', async () => {
    await expect(
      service.run(callFor(key), () => Promise.reject(new Error('handler exploded'))),
    ).rejects.toThrow('handler exploded');

    expect(await claim()).toBeUndefined();
  });

  /**
   * The regression, and the reason the release is wrapped.
   *
   * A release that cannot run must not become the error the caller sees. Renaming the table inside
   * the rolled-back transaction is the cleanest way to make exactly the `DELETE` fail while leaving
   * the handler's own rejection intact — a pool timeout does the same thing in production and is
   * not reproducible in a test.
   */
  it('reports the handler’s error, not the release’s, when the release fails too', async () => {
    let released = false;

    await expect(
      service.run(callFor(key), async () => {
        /* Make the release impossible, from inside the handler, before it rejects. */
        await db.execute(
          sql`ALTER TABLE idempotency_keys RENAME TO idempotency_keys_gone`,
        );
        released = true;

        throw new Error('the real cause');
      }),
    ).rejects.toThrow('the real cause');

    expect(released, 'the handler ran to its throw').toBe(true);

    await db.execute(sql`ALTER TABLE idempotency_keys_gone RENAME TO idempotency_keys`);
  });

  // ─── Reclaiming an abandoned claim ─────────────────────────────────────────

  /**
   * A fresh claim belongs to whoever is still running, and must NOT be stolen — otherwise pressing
   * Pay twice in quick succession would run the handler twice, which is the whole point of EC-003.
   */
  it('refuses a second caller while the first is still running', async () => {
    const request = { unit: 'a', nights: 2 };
    /*
      The SAME body as the retry, so the refusal comes from the claim being live rather than from the
      hash check — which is a different rule and would pass this test without proving anything.
    */
    const hash = await hashOf(db, request);

    await db.execute(sql`
      INSERT INTO idempotency_keys (key, scope, request_hash, status, expires_at)
      VALUES (${key}, 'booking.create', ${hash}, 'in_progress', now() + interval '24 hours')
    `);

    let ran = false;

    const rejected = await service
      .run({ ...call, key, request }, () => {
        ran = true;

        return Promise.resolve('should not happen');
      })
      .catch((error: unknown) => error);

    expect(ran, 'the handler must not run while another holds the claim').toBe(false);
    expect(codeOf(rejected)).toBe(ERROR.REQUEST_STILL_PROCESSING);
  });

  /** Same key, different body, live claim — the client-bug rule still applies. */
  it('refuses a live claim reused with a different body', async () => {
    await db.execute(sql`
      INSERT INTO idempotency_keys (key, scope, request_hash, status, expires_at)
      VALUES (${key}, 'booking.create', 'a-hash-from-some-other-body', 'in_progress',
              now() + interval '24 hours')
    `);

    const rejected = await service
      .run(callFor(key), () => Promise.resolve('should not happen'))
      .catch((error: unknown) => error);

    expect(codeOf(rejected)).toBe(ERROR.REQUEST_IDEMPOTENCY_KEY_REUSED);
  });

  /**
   * The fix. A claim nobody is working on any more is taken over rather than refused for 24 hours.
   *
   * Backdated by an hour, which is far past the two-minute window and far short of the retention —
   * the case the old code turned into a dead end.
   */
  it('reclaims a claim abandoned longer than the stale window', async () => {
    const request = { unit: 'a', nights: 2 };
    const hash = await hashOf(db, request);

    await db.execute(sql`
      INSERT INTO idempotency_keys (key, scope, request_hash, status, expires_at, created_at)
      VALUES (${key}, 'booking.create', ${hash}, 'in_progress',
              now() + interval '23 hours', now() - interval '1 hour')
    `);

    const result = await service.run({ ...call, key, request }, () =>
      Promise.resolve({ reference: 'BKG-RECLAIMED' }),
    );

    expect(result).toEqual({ reference: 'BKG-RECLAIMED' });
    expect((await claim())?.status).toBe('completed');
  });

  /**
   * Reclaiming must not depend on the abandoned claim having the same body.
   *
   * The stale row's `request_hash` is whatever the abandoned attempt sent. If reclaiming ran the
   * hash comparison first, an abandoned claim from a different body would answer 422 for 24 hours —
   * trading one dead end for another.
   */
  it('reclaims regardless of what the abandoned attempt had submitted', async () => {
    await db.execute(sql`
      INSERT INTO idempotency_keys (key, scope, request_hash, status, expires_at, created_at)
      VALUES (${key}, 'booking.create', 'a-hash-from-some-other-body', 'in_progress',
              now() + interval '23 hours', now() - interval '1 hour')
    `);

    await expect(service.run(callFor(key), () => Promise.resolve('taken'))).resolves.toBe(
      'taken',
    );
  });

  /** A COMPLETED claim is replayed, never reclaimed, however old it is. */
  it('replays a completed claim rather than reclaiming it', async () => {
    const request = { unit: 'a', nights: 2 };
    const hash = await hashOf(db, request);

    await db.execute(sql`
      INSERT INTO idempotency_keys (key, scope, request_hash, status, response_body,
                                    response_status, expires_at, created_at)
      VALUES (${key}, 'booking.create', ${hash}, 'completed', '{"reference":"BKG-FIRST"}'::jsonb,
              201, now() + interval '23 hours', now() - interval '5 hours')
    `);

    let ran = false;

    const result = await service.run({ ...call, key, request }, () => {
      ran = true;

      return Promise.resolve({ reference: 'BKG-SECOND' });
    });

    expect(ran, 'a completed claim must never run the handler again').toBe(false);
    expect(result).toEqual({ reference: 'BKG-FIRST' });
  });
});

/**
 * The request hash the service will compute, obtained from the service itself.
 *
 * Re-implementing the hash in the test would let the two drift and the drift would look like a
 * reclaim failure. Instead: run one successful call with the same body and read back the hash it
 * stored, then remove the row.
 */
async function hashOf(db: Database, request: unknown): Promise<string> {
  const probeKey = `idem-hash-probe-${Math.random().toString(36).slice(2, 12)}`;

  await new IdempotencyService(db).run(
    { key: probeKey, scope: 'booking.create', request },
    () => Promise.resolve('probe'),
  );

  const rows = await db.execute<{ request_hash: string }>(sql`
    SELECT request_hash FROM idempotency_keys WHERE key = ${probeKey} LIMIT 1
  `);

  await db.execute(sql`DELETE FROM idempotency_keys WHERE key = ${probeKey}`);

  const hash = rows.rows[0]?.request_hash;

  if (!hash) throw new Error('The probe call stored no request hash.');

  return hash;
}
