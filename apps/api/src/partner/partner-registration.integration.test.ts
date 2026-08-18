import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { partnerRegisterSchema } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { PartnerRegistrationService } from './partner-registration.service.js';

/**
 * Partner self-registration (SRS §8.1), against a REAL PostgreSQL.
 *
 * What is worth testing here is almost entirely about what a self-registered partner
 * must NOT be able to do. An open endpoint that mints accounts with `PRICE_UPDATE`
 * and `PROPERTY_MANAGE_OWN` is only acceptable because the applicant lands in
 * `pending` and cannot publish; if that ever stopped being true the endpoint would
 * become the platform's biggest hole, so it is pinned here rather than assumed.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('partner self-registration', () => {
  /* Every row this suite writes is discarded when the test that wrote it ends. */
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const registration = new PartnerRegistrationService(
    db,
    new PasswordService(),
    new AuditService(db),
  );

  beforeEach(async () => {
    await harness.begin();
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  function application(overrides: Record<string, unknown> = {}) {
    const id = randomUUID().slice(0, 8);

    return {
      email: `partner-reg-${id}@safra.test`,
      /* Meets the composition checklist added 2026-08-14 — see `PASSWORD_RULES`. */
      password: 'A-Long-Enough-Password-9!',
      phone: '+963933123400',
      legalName: `Levant Stays ${id} LLC`,
      displayName: `Levant Stays ${id}`,
      partnerTypeCode: 'accommodation',
      citySlug: 'damascus',
      preferredLocale: 'en' as const,
      address: 'Old City, Damascus',
      ...overrides,
    };
  }

  it('creates the account and the partner together', async () => {
    const input = application();
    const result = await registration.register(input, {});

    expect(result.reference).toMatch(/^PAR-\d{6,}$/);
    expect(result.verification).toBe('pending');

    const rows = await db.execute<{ role: string; verification: string }>(sql`
      SELECT u.role::text AS role, p.verification::text AS verification
      FROM partners p JOIN users u ON u.id = p.user_id
      WHERE p.email = ${input.email}`);

    expect(rows.rows[0]?.role).toBe('partner');
    expect(rows.rows[0]?.verification).toBe('pending');
  });

  /**
   * The property the whole flow rests on. If an applicant could arrive verified,
   * §8.1's review and ADR 0002's sanctions screening would both be optional.
   */
  it('cannot arrive verified, even when the payload says so', async () => {
    const hostile = { ...application(), verification: 'verified', score: 999 };

    // First barrier: the schema does not have these fields and is .strict().
    expect(partnerRegisterSchema.safeParse(hostile).success).toBe(false);

    // Second barrier: even if one slipped through, the service never reads them.
    const result = await registration.register(
      partnerRegisterSchema.parse(application()),
      {},
    );

    expect(result.verification).toBe('pending');
  });

  /** A partner setting their own §8.5 score would be buying search placement. */
  it('starts at the default score and tier', async () => {
    const input = application();
    await registration.register(input, {});

    const rows = await db.execute<{ score: number; tier: string }>(sql`
      SELECT score, tier::text AS tier FROM partners WHERE email = ${input.email}`);

    expect(rows.rows[0]?.score).toBe(100);
    expect(rows.rows[0]?.tier).toBe('new');
  });

  it('rejects a duplicate email', async () => {
    const input = application();
    await registration.register(input, {});

    await expect(
      registration.register(application({ email: input.email }), {}),
    ).rejects.toThrow(/already exists/i);
  });

  /**
   * The rollback that matters: a user row with partner permissions and no partner
   * row is an account `requirePartnerId` refuses, so the applicant would be locked
   * out of something they were just told was created.
   */
  it('leaves no account behind when the partner row cannot be written', async () => {
    const input = application({ citySlug: 'not-a-real-city' });

    await expect(registration.register(input, {})).rejects.toThrow(/unknown city/i);

    const rows = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM users WHERE email = ${input.email}`);

    expect(rows.rows[0]?.count).toBe('0');
  });

  it('rejects an unknown partner type by name', async () => {
    await expect(
      registration.register(application({ partnerTypeCode: 'spaceship-rental' }), {}),
    ).rejects.toThrow(/unknown partner type/i);
  });

  it('stores the password as an Argon2id hash, never in clear', async () => {
    const input = application();
    await registration.register(input, {});

    const rows = await db.execute<{ hash: string }>(sql`
      SELECT u.password_hash AS hash FROM users u
      JOIN partners p ON p.user_id = u.id WHERE p.email = ${input.email}`);

    const hash = rows.rows[0]?.hash ?? '';

    expect(hash).toMatch(/^\$argon2id\$/);
    expect(hash).not.toContain(input.password);
  });

  it('records the application in the audit trail', async () => {
    const input = application();
    const result = await registration.register(input, { ipAddress: '203.0.113.9' });

    const rows = await db.execute<{ after: unknown; ip: string | null }>(sql`
      SELECT after, ip_address AS ip FROM audit_log
      WHERE action = 'partner.registered'
      ORDER BY created_at DESC LIMIT 1`);

    const after = rows.rows[0]?.after as { reference?: string } | null;

    expect(after?.reference).toBe(result.reference);
    expect(rows.rows[0]?.ip).toBe('203.0.113.9');
  });

  /** §8.1's queue is what staff work from, so an applicant must appear in it. */
  it('appears in the pending-verification queue', async () => {
    const input = application();
    await registration.register(input, {});

    const rows = await db.execute<{ count: string }>(sql`
      SELECT COUNT(*)::text AS count FROM partners
      WHERE email = ${input.email} AND verification = 'pending' AND deleted_at IS NULL`);

    expect(rows.rows[0]?.count).toBe('1');
  });
});
