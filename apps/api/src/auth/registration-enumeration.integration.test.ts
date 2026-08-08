import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

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
  );

  let taken = '';

  const input = (email: string) => ({
    email,
    password: 'a-correct-password-1',
    fullName: 'Enumeration Probe',
    phone: '+963900000123',
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
   * Asserted as a RATIO with a generous bound rather than an absolute difference: this runs on
   * whatever CI machine is free, and the property under test is "the same order of magnitude", not
   * "within 5ms". A regression that skipped the hash would show up as a ratio of ten or more.
   */
  it('takes comparable time whether or not the address exists', async () => {
    const time = async (email: string) => {
      const started = performance.now();

      await service.register(input(email));

      return performance.now() - started;
    };

    /* Several of each, interleaved, so a warming pool or a busy moment cannot favour one branch. */
    const takenTimes: number[] = [];
    const newTimes: number[] = [];

    for (let i = 0; i < 3; i += 1) {
      takenTimes.push(await time(taken));
      newTimes.push(await time(fresh()));
    }

    const median = (values: number[]) => [...values].sort((a, b) => a - b)[1] ?? 0;
    const ratio = median(newTimes) / Math.max(median(takenTimes), 0.001);

    expect(ratio).toBeLessThan(3);
    expect(ratio).toBeGreaterThan(1 / 3);
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
});
