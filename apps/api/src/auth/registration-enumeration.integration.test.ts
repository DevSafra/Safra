import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import type { LoginCodeService } from './login-code.service.js';
import { AuthService } from './auth.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import type { FieldEncryptionService } from '../common/crypto/field-encryption.service.js';
import type { TokenService } from './token.service.js';
import type { TwoFactorService } from './two-factor.service.js';

/**
 * Registration must not reveal whether an address is already registered.
 *
 * ## What this replaces
 *
 * `POST /auth/register` answered `409 auth.email_taken` for a taken address, justified on the
 * grounds that a signup form reveals this by design. It does not have to, and one request with no
 * side effects and a definitive answer is the cheapest account-enumeration oracle a system can
 * offer — cheaper than the lockout oracle closed the same day, which at least cost five requests
 * and a denial of service.
 *
 * ## The four channels a difference could leak through
 *
 * Status code, response body, wording, and TIMING. The first three are asserted directly. The
 * fourth is the one that survives careless fixes, so it has its own test: hashing the password
 * only on the create path would have made "taken" tens of milliseconds faster than "new", which is
 * the same oracle expressed as a stopwatch.
 *
 * Skipped when DATABASE_URL is unset; CI provisions a database and runs it.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** One password for every path here, so the stopwatch measures the same work each time. */
const PASSWORD = 'A-Correct-Password-1';

describeIfDb('registration does not reveal whether an address is taken', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const db: Database = harness.db;
  const passwords = new PasswordService();

  const service = new AuthService(
    db,
    passwords,
    {} as unknown as TokenService,
    {} as unknown as FieldEncryptionService,
    {} as unknown as TwoFactorService,
    /*
      Never reached: every path here either has no second factor or has an authenticator enrolled,
      and a partner without one is what `login-code.service` covers in its own suite.
    */
    {} as unknown as LoginCodeService,
  );

  let taken = '';

  const input = (email: string) => ({
    email,
    /* Meets the composition checklist added 2026-08-14 — see `PASSWORD_RULES`. */
    password: PASSWORD,
    fullName: 'Enumeration Probe',
    phone: '+963900000123',
    /* Required since 2026-08-14 — a choice must be made, and this is one of the three. */
    gender: 'undisclosed' as const,
    preferredLocale: 'ar' as const,
  });

  const fresh = () => `reg-new-${crypto.randomUUID()}@safra.test`;

  beforeEach(async () => {
    await harness.begin();

    taken = `reg-taken-${crypto.randomUUID()}@safra.test`;
    await service.register(input(taken));
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('resolves rather than throwing for an address that is taken', async () => {
    await expect(service.register(input(taken))).resolves.toBeDefined();
  });

  it('creates nothing the second time', async () => {
    await service.register(input(taken));

    const rows = await db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM users WHERE email = ${taken}`,
    );

    expect(rows.rows[0]?.n).toBe(1);
  });

  /**
   * The shape the CONTROLLER sees is allowed to differ — it has to choose which email to send.
   * What must not differ is anything it puts on the wire, and the controller answers
   * `202 { ok: true }` in both branches unconditionally.
   */
  it('reports the outcome internally so the right email can be sent', async () => {
    const created = await service.register(input(fresh()));
    const existing = await service.register(input(taken));

    expect(created.created).toBe(true);
    expect(existing.created).toBe(false);

    /* Both carry a user id, so the audit row has a subject either way. */
    expect(created.userId).toBeTruthy();
    expect(existing.userId).toBeTruthy();
  });

  /**
   * TIMING — the channel a careless fix leaves open.
   *
   * Argon2id dominates this endpoint: tens of milliseconds against a sub-millisecond indexed
   * lookup. Hashing only when creating would make "taken" obviously faster, and no amount of care
   * over the response body would hide it.
   *
   * ## Measured against a HASH, not against each other
   *
   * This compared the two paths to one another and required their ratio to stay under 3. It flaked
   * on 2026-08-30 at 3.196, and the instrumented run showed why: the two paths differ by about
   * 2.4× **for a reason that is not the hash**. Measured on this machine, a bare hash costs 16–18ms,
   * the taken path 20–28ms (hash plus an indexed lookup) and the create path 27–46ms (hash, lookup,
   * and the rows it writes). Writing an account cannot be free, so a ratio between the two asserted
   * something the system never guaranteed and had roughly one noisy sample of headroom.
   *
   * The property that IS guaranteed, and the one the oracle turns on, is that **neither path is
   * cheaper than a password hash**. Skipping the hash on the taken path — the regression this whole
   * file exists to catch — drops it to a bare lookup of a few milliseconds, a quarter of a hash and
   * an order of magnitude below the bound below. So this measures a hash here and now, on the same
   * machine in the same second, and compares each path to that.
   *
   * ## Minima, because timing noise is one-sided
   *
   * A busy scheduler, a GC pause or a slow pool can only make a sample SLOWER. The fastest of
   * several is therefore the best estimate of what the work actually costs, and it is what keeps
   * this stable while 200 other test files run beside it. A median still carries the noise.
   *
   * ## What this does NOT claim
   *
   * That the two answers are indistinguishable by a stopwatch. They are not: creating an account
   * costs measurably more than declining to. That residual is recorded in `docs/FUTURE-WORK.md`
   * with its mitigations — every probe of an unregistered address leaves an account behind, and
   * `POST /auth/register` allows five attempts a minute per IP.
   */
  it('costs at least a password hash whether or not the address exists', async () => {
    const time = async (run: () => Promise<unknown>) => {
      const started = performance.now();

      await run();

      return performance.now() - started;
    };

    /* Interleaved, so a warming pool or a busy moment cannot favour one of the three. */
    const hashTimes: number[] = [];
    const takenTimes: number[] = [];
    const newTimes: number[] = [];

    for (let i = 0; i < 5; i += 1) {
      hashTimes.push(await time(() => passwords.hash(PASSWORD)));
      takenTimes.push(await time(() => service.register(input(taken))));
      newTimes.push(await time(() => service.register(input(fresh()))));
    }

    const fastest = (values: number[]) => Math.min(...values);
    const floor = fastest(hashTimes) * 0.8;

    /*
      0.8 rather than 1.0: the same algorithm measured in a tight loop and inside `register` can
      differ a little with JIT warmth and Argon2's memory reuse. A path that skipped the hash would
      come in at roughly a QUARTER of one, so the margin costs nothing that matters.
    */
    expect(
      fastest(takenTimes),
      'the taken path must still hash the password',
    ).toBeGreaterThan(floor);

    expect(fastest(newTimes), 'and so must the create path').toBeGreaterThan(floor);
  });

  /*
    And the specific mechanism, asserted directly rather than only through the clock: the password
    is hashed on BOTH paths. A stopwatch test alone would pass on a fast machine if somebody later
    moved the hash back inside the create branch and the database happened to be slow.
  */
  it('hashes the password even when the address is taken', async () => {
    const spy = vi.spyOn(passwords, 'hash');

    await service.register(input(taken));

    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockRestore();
  });
  /**
   * A second account is never created for an address that already has one.
   *
   * Bashar asked for this explicitly (2026-08-14). It was already true — `users_email_unique` is a
   * partial unique index over the live rows, and `register` returns `created: false` without
   * inserting — but "already true" is a property somebody has to be able to check, and nothing
   * asserted it directly. The tests above prove the two ANSWERS are indistinguishable; this proves
   * what actually happened behind the identical answer.
   */
  it('creates no second account for an address that already has one', async () => {
    const email = fresh();

    const first = await service.register(input(email));
    const second = await service.register(input(email));

    expect(first.created, 'the first attempt made the account').toBe(true);
    expect(second.created, 'the second did not').toBe(false);
    /* The same account, not a new one that happens to share the address. */
    expect(second.userId).toBe(first.userId);

    const accounts = await db.execute<{ count: string }>(sql`
      SELECT count(*)::text AS count FROM users
      WHERE email = ${email} AND deleted_at IS NULL
    `);

    expect(accounts.rows[0]?.count, 'exactly one row for the address').toBe('1');
  });
});
