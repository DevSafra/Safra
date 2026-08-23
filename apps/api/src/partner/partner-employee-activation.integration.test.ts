import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { AuthTokenService } from '../auth/auth-token.service.js';
import { PartnerEmployeesService } from './partner-employees.service.js';
import { codeOf } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { Env } from '../config/env.js';
import type { MailService } from '../mail/mail.service.js';
import type { TokenService } from '../auth/token.service.js';

/**
 * `POST /partner/employee-invitation` — the public route that turns an invitation into an account.
 *
 * ## Why this file exists
 *
 * `partner-employees.integration.test.ts` covers nineteen paths and not this one, and this is the
 * riskiest method in the feature by some distance. It is the only `@Public()` route the employees
 * work adds; it redeems a CREDENTIAL — whoever holds a live token sets the password on that
 * account; and it is the single statement that raises a `customer` to `partner_employee`. Every
 * other invitation flow in this codebase is covered (`staff.integration.test.ts`,
 * `partner-application.integration.test.ts`). This one had nothing at all.
 *
 * Two employees endpoints today were reported working and answered 500 on first use, both because
 * no test executed their SQL. So this drives the real service against a real database, with a real
 * `AuthTokenService` issuing and redeeming real rows — a stubbed token service would prove that
 * the code calls `redeem`, which is not the thing in doubt.
 *
 * ## The shape of what is checked
 *
 * The happy path is one test. The other eleven are refusals, because a redemption route is defined
 * by what it declines: a token spent twice, a token of the wrong PURPOSE, and every way the
 * employment can have stopped being real between the mail being sent and the link being clicked.
 * The check is days old by the time somebody acts on it, which is the whole reason the service
 * re-reads rather than trusting the token.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

/** Argon2id output is the service's caller's job; this only has to be a distinguishable string. */
const HASH =
  '$argon2id$v=19$m=65536,t=3,p=4$aaaaaaaaaaaaaaaa$bbbbbbbbbbbbbbbbbbbbbbbbbbbb';

describeIfDb('activating a partner employee', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: PartnerEmployeesService;
  let authTokens: AuthTokenService;
  let revoked: string[] = [];

  let partnerId = '';
  let ownerUserId = '';
  let employeeUserId = '';
  let employmentId = '';
  let roleId = '';

  const owner = (): AccessTokenClaims =>
    ({ sub: ownerUserId, role: 'partner' }) as unknown as AccessTokenClaims;

  /** A live invitation for the fixture employee, as `invite` would have sent. */
  const issueToken = async (): Promise<string> =>
    (
      await authTokens.issue(
        employeeUserId,
        'partner_employee_invitation',
        72 * 60 * 60 * 1000,
      )
    ).token;

  const roleOf = async (userId: string): Promise<string> => {
    const rows = await db.execute<{ role: string }>(sql`
      SELECT role::text AS role FROM users WHERE id = ${userId}::uuid
    `);

    return rows.rows[0]?.role ?? '';
  };

  beforeEach(async () => {
    await harness.begin();

    revoked = [];
    authTokens = new AuthTokenService(db);

    service = new PartnerEmployeesService(
      db,
      new AuditService(db),
      authTokens,
      {
        revokeAllForUser: (id: string) => {
          revoked.push(id);

          return Promise.resolve();
        },
      } as unknown as TokenService,
      { send: () => Promise.resolve() } as unknown as MailService,
      { PARTNER_URL: 'https://partner.example' } as Env,
    );

    const made = await db.execute<{
      partner: string;
      owner: string;
      employee: string;
      employment: string;
      role: string;
    }>(sql`
      WITH ou AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('act-owner-' || gen_random_uuid() || '@safra.test', '+963900000700',
                'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email)
        SELECT ou.id, (SELECT id FROM partner_types LIMIT 1), 'Act Co', 'تفعيل',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000700', 'act@safra.test'
        FROM ou
        RETURNING id
      ), eu AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('act-emp-' || gen_random_uuid() || '@safra.test', '+963900000701',
                'customer', 'active')
        RETURNING id
      ), r AS (
        INSERT INTO partner_employee_roles (partner_id, name, permissions)
        SELECT pa.id, 'استقبال-' || gen_random_uuid(), ARRAY['booking.read_own']
        FROM pa
        RETURNING id
      ), em AS (
        INSERT INTO partner_employees (partner_id, user_id, role_id, status, full_name)
        SELECT pa.id, eu.id, r.id, 'active', 'رنا الاستقبال' FROM pa, eu, r
        RETURNING id
      )
      SELECT (SELECT id FROM pa) AS partner, (SELECT id FROM ou) AS owner,
             (SELECT id FROM eu) AS employee, (SELECT id FROM em) AS employment,
             (SELECT id FROM r) AS role
    `);

    const row = made.rows[0];

    partnerId = row?.partner ?? '';
    ownerUserId = row?.owner ?? '';
    employeeUserId = row?.employee ?? '';
    employmentId = row?.employment ?? '';
    roleId = row?.role ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  // ── It works at all ─────────────────────────────────────────────────────────

  /**
   * THE test, and the least interesting-sounding one: the statement runs.
   *
   * Both employees endpoints that shipped broken today would have failed exactly here, on a
   * column that does not exist, and nothing in the suite executed them.
   */
  it('sets the password, promotes the account and marks the address verified', async () => {
    const token = await issueToken();

    await service.acceptInvitation(token, HASH);

    const rows = await db.execute<{
      role: string;
      password_hash: string | null;
      verified: boolean;
    }>(sql`
      SELECT role::text AS role, password_hash, email_verified_at IS NOT NULL AS verified
      FROM users WHERE id = ${employeeUserId}::uuid
    `);

    expect(rows.rows[0]).toMatchObject({
      role: 'partner_employee',
      password_hash: HASH,
      verified: true,
    });
  });

  /*
    A customer account being converted held CUSTOMER sessions. A role change that takes fifteen
    minutes to apply is not a role change — see the note on `PermissionsGuard`'s token lag.
  */
  it('revokes every session the account already held', async () => {
    await service.acceptInvitation(await issueToken(), HASH);

    expect(revoked).toContain(employeeUserId);
  });

  it('shows the employee as activated on the partner’s list', async () => {
    await service.acceptInvitation(await issueToken(), HASH);

    const page = await service.list(partnerId, { limit: 20 });

    expect(page.items[0]).toMatchObject({ activated: true, invitationPending: false });
  });

  // ── The token is a credential ───────────────────────────────────────────────

  it('refuses a token that has already been spent', async () => {
    const token = await issueToken();

    await service.acceptInvitation(token, HASH);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  it('refuses a token nobody issued', async () => {
    await expect(service.acceptInvitation('a'.repeat(43), HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  it('refuses an expired token', async () => {
    const token = await issueToken();

    await db.execute(sql`
      UPDATE auth_tokens SET expires_at = now() - interval '1 minute'
      WHERE user_id = ${employeeUserId}::uuid
    `);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  /**
   * A PURPOSE is not decoration — it is what stops one invitation redeeming into another's role.
   *
   * `partner_invitation` redeems into `role = 'partner'`, the OWNER of a business. If this route
   * accepted one, anybody holding a partner invitation could spend it here instead, and the two
   * flows would differ only in which endpoint the holder chose to call. The API keeps them as
   * separate purposes for exactly this reason and the test says so out loud.
   */
  it('refuses a partner-invitation token spent in the employee slot', async () => {
    const wrong = await authTokens.issue(
      employeeUserId,
      'partner_invitation',
      72 * 60 * 60 * 1000,
    );

    await expect(service.acceptInvitation(wrong.token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });

    /* And it is not silently consumed either — the owner's own link must still work. */
    expect(await roleOf(employeeUserId)).toBe('customer');
  });

  // ── The employment is re-checked, because the link outlives the decision ────

  /*
    Each of these is a state the employment can be in by the time somebody clicks, days later.
    They are separate tests rather than a loop because the SETUP is the interesting part of each —
    what changed — and a loop would hide it behind a table.
  */

  it('refuses a link whose employment was removed', async () => {
    const token = await issueToken();

    await service.remove(owner(), partnerId, employmentId);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
    expect(await roleOf(employeeUserId)).toBe('customer');
  });

  it('refuses a link whose employment was suspended', async () => {
    const token = await issueToken();

    await service.update(owner(), partnerId, employmentId, { status: 'suspended' });

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  it('refuses a link whose employer was soft-deleted', async () => {
    const token = await issueToken();

    await db.execute(sql`
      UPDATE partners SET deleted_at = now() WHERE id = ${partnerId}::uuid
    `);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  it('refuses a link whose employer was suspended', async () => {
    const token = await issueToken();

    await db.execute(sql`
      UPDATE partners SET suspended_at = now(), suspended_reason = 'test'
      WHERE id = ${partnerId}::uuid
    `);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  it('refuses a link whose role was withdrawn from the catalogue', async () => {
    const token = await issueToken();

    await db.execute(sql`
      UPDATE partner_employee_roles SET deleted_at = now() WHERE id = ${roleId}::uuid
    `);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  /**
   * An account that has BECOME staff is not demoted by a link somebody still holds.
   *
   * The conversion is `customer` → `partner_employee` and nothing else. Without the role check a
   * held invitation would be a way to strip an operations manager of their permissions days after
   * they were hired — a denial of service against a staff account, triggered by a stranger.
   */
  it('refuses a link for an account that has since become staff', async () => {
    const token = await issueToken();

    await db.execute(sql`
      UPDATE users SET role = 'operations_manager'::user_role
      WHERE id = ${employeeUserId}::uuid
    `);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
    expect(await roleOf(employeeUserId)).toBe('operations_manager');
  });

  it('refuses a link for an account that has since been deleted', async () => {
    const token = await issueToken();

    await db.execute(sql`
      UPDATE users SET deleted_at = now() WHERE id = ${employeeUserId}::uuid
    `);

    await expect(service.acceptInvitation(token, HASH)).rejects.toMatchObject({
      response: { code: ERROR.EMPLOYEE_INVITATION_INVALID },
    });
  });

  /**
   * Every refusal is the SAME code, and that is deliberate rather than lazy.
   *
   * Expired, spent, forged, employment withdrawn, employer suspended — distinguishing them tells
   * somebody working through invitation links which of their guesses were close. This asserts the
   * property directly, because it is the kind of thing a later "helpful" change erodes one branch
   * at a time.
   */
  it('answers every refusal with one indistinguishable code', async () => {
    const spent = await issueToken();

    await service.acceptInvitation(spent, HASH);

    const forged = await service
      .acceptInvitation('b'.repeat(43), HASH)
      .catch((error: unknown) => error);
    const replayed = await service
      .acceptInvitation(spent, HASH)
      .catch((error: unknown) => error);

    expect(codeOf(forged)).toBe(ERROR.EMPLOYEE_INVITATION_INVALID);
    expect(codeOf(replayed)).toBe(codeOf(forged));
  });
});
