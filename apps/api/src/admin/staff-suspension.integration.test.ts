import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { PasswordService } from '../common/crypto/password.service.js';
import { StaffService } from './staff.service.js';
import type { TokenService } from '../auth/token.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { MailService, OutgoingMail } from '../mail/mail.service.js';

/**
 * Disabling a staff account (Bashar, 2026-08-23).
 *
 * *"When I set the status to غير نشط then the employee should not be able to login with his
 * account… The employee should get a notification per email about that."*
 *
 * Three separate things have to be true and none of them implies the others:
 *
 * 1. **The status is written**, so the sign-in gate has something to refuse against.
 * 2. **Live sessions are revoked**, because refusing new sign-ins does nothing about the tab
 *    somebody already has open.
 * 3. **The person is told**, and by email, because the sign-in screen deliberately cannot say —
 *    `AuthService.login` answers a suspended account exactly as it answers a wrong password so a
 *    suspended address cannot be confirmed by probing.
 *
 * The email is the interesting one to test, because it is the piece that has no other symptom: a
 * suspension with no notice looks identical to a suspension with one, from every screen.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('disabling a staff account', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  const sent: OutgoingMail[] = [];
  const mail = {
    send: (message: OutgoingMail) => {
      sent.push(message);
      return Promise.resolve();
    },
  } as unknown as MailService;

  const revoked: string[] = [];
  const tokens = {
    revokeAllForUser: (id: string) => {
      revoked.push(id);
      return Promise.resolve();
    },
    staffPermissions: () => Promise.resolve([]),
  } as unknown as TokenService;

  const service = new StaffService(
    db,
    { ADMIN_URL: 'https://admin.safra.example' } as never,
    new AuditService(db),
    new AuthTokenService(db),
    mail,
    new PasswordService(),
    tokens,
  );

  let run = 0;
  let actorId = '';

  const admin = (id: string): AccessTokenClaims =>
    ({ sub: id, role: 'super_admin', permissions: [], locale: 'ar' }) as never;

  async function makeStaff(role = 'support_agent', locale = 'ar'): Promise<string> {
    const made = await db.execute<{ id: string }>(sql`
      INSERT INTO users (full_name, email, role, status, preferred_locale, password_hash)
      VALUES ('موظف اختبار',
              ${`susp-${process.pid}-${run}-${Math.abs(role.length + locale.length)}-${Date.now()}@safra.test`},
              ${role}::user_role, 'active', ${locale}, 'x')
      RETURNING id
    `);

    return made.rows[0]?.id ?? '';
  }

  beforeEach(async () => {
    await harness.begin();
    run += 1;
    sent.length = 0;
    revoked.length = 0;
    /* A second super admin, so suspending the first is never the last-administrator refusal. */
    actorId = await makeStaff('super_admin');
  });

  afterEach(async () => {
    await harness.rollback();
  });

  afterAll(async () => {
    await harness.close();
  });

  it('writes the status, revokes the sessions, and emails the person', async () => {
    const userId = await makeStaff();

    await service.setStatus(admin(actorId), userId, 'suspended');

    const row = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM users WHERE id = ${userId}::uuid
    `);

    expect(row.rows[0]?.status).toBe('suspended');
    expect(revoked).toEqual([userId]);
    expect(sent).toHaveLength(1);
  });

  /**
   * The message is the one the person can act on.
   *
   * Not asserting the whole body — copy changes and a test that pins prose blocks the catalogue.
   * These three facts are the reason the email exists: it says the account was disabled, it says
   * the account still EXISTS (disabled and deleted are the same event from outside, and only one is
   * worth panicking about), and it points somewhere other than the sign-in screen, which by design
   * can never explain.
   */
  it('tells them it is reversible and where to go, in Arabic', async () => {
    const userId = await makeStaff();

    await service.setStatus(admin(actorId), userId, 'suspended');

    const message = sent[0];

    expect(message?.subject).toContain('تم تعطيل حسابك');
    expect(message?.text).toContain('لن تتمكن من تسجيل الدخول');
    expect(message?.text).toContain('لم يُحذف الحساب');
    expect(message?.text).toContain('مسؤول النظام');
  });

  /** Bashar's rule, on the newest template: Arabic first, English underneath. */
  it('carries the English underneath the Arabic', async () => {
    const userId = await makeStaff();

    await service.setStatus(admin(actorId), userId, 'suspended');

    const text = sent[0]?.text ?? '';
    const arabic = text.indexOf('لن تتمكن من تسجيل الدخول');
    const english = text.indexOf('you can no longer sign in');

    expect(arabic).toBeGreaterThanOrEqual(0);
    expect(english).toBeGreaterThan(arabic);
    expect(sent[0]?.subject).toContain('has been disabled');
  });

  /**
   * Reinstatement is announced too.
   *
   * Somebody told they were locked out and then silently let back in learns to distrust both
   * messages. This is also the control for the test above: a service that mailed on every status
   * change would pass that one, and a service that mailed on none would fail both.
   */
  it('emails on reinstatement as well, with a different message', async () => {
    const userId = await makeStaff();

    await service.setStatus(admin(actorId), userId, 'suspended');
    await service.setStatus(admin(actorId), userId, 'active');

    expect(sent).toHaveLength(2);
    expect(sent[1]?.subject).not.toBe(sent[0]?.subject);
    expect(sent[1]?.text).toContain('أُعيد تنشيط حسابك');

    /* Reinstating does NOT revoke — there is nothing to revoke and it would be a second lockout. */
    expect(revoked).toEqual([userId]);
  });

  /**
   * A German staff member gets German too, and it comes THIRD.
   *
   * The rule names Arabic and English. Dropping German for a German reader as a side effect of it
   * would be the failure `.claude/CLAUDE.md` opens with — the way you find out a language was
   * missing is somebody reading a script they cannot read.
   */
  it('adds the reader’s own language third when it is neither', async () => {
    const userId = await makeStaff('support_agent', 'de');

    await service.setStatus(admin(actorId), userId, 'suspended');

    const text = sent[0]?.text ?? '';

    expect(text.indexOf('لن تتمكن من تسجيل الدخول')).toBeGreaterThanOrEqual(0);
    expect(text.indexOf('you can no longer sign in')).toBeGreaterThan(
      text.indexOf('لن تتمكن من تسجيل الدخول'),
    );
    expect(text.indexOf('nicht mehr anmelden')).toBeGreaterThan(
      text.indexOf('you can no longer sign in'),
    );
  });

  /** An Arabic reader gets two blocks, not the same Arabic twice. */
  it('does not repeat a language for an Arabic or English reader', async () => {
    const userId = await makeStaff('support_agent', 'ar');

    await service.setStatus(admin(actorId), userId, 'suspended');

    const text = sent[0]?.text ?? '';
    const first = text.indexOf('لن تتمكن من تسجيل الدخول');

    expect(text.indexOf('لن تتمكن من تسجيل الدخول', first + 1)).toBe(-1);
  });

  /**
   * A mail failure must NOT roll back the suspension.
   *
   * The wrong direction for this failure is an account that quietly stays active because a mail
   * server was slow. The suspension is decided; the notice is a best effort on top of it.
   */
  it('still suspends when the email cannot be sent', async () => {
    const failing = new StaffService(
      db,
      { ADMIN_URL: 'https://admin.safra.example' } as never,
      new AuditService(db),
      new AuthTokenService(db),
      { send: () => Promise.reject(new Error('smtp down')) } as unknown as MailService,
      new PasswordService(),
      tokens,
    );

    const userId = await makeStaff();

    await expect(
      failing.setStatus(admin(actorId), userId, 'suspended'),
    ).resolves.toBeUndefined();

    const row = await db.execute<{ status: string }>(sql`
      SELECT status::text AS status FROM users WHERE id = ${userId}::uuid
    `);

    expect(row.rows[0]?.status).toBe('suspended');
    expect(revoked).toEqual([userId]);
  });
});
