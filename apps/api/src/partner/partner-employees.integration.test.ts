import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRollbackDatabase, type Database } from '@safra/db';
import { ERROR, PERMISSIONS as P } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import {
  PartnerEmployeesService,
  type EmployeePage,
} from './partner-employees.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import type { AuthTokenService } from '../auth/auth-token.service.js';
import type { Env } from '../config/env.js';
import type { MailService } from '../mail/mail.service.js';
import type { TokenService } from '../auth/token.service.js';

/**
 * A partner's own staff, exercised AGAINST A DATABASE (Bashar, 2026-08-23).
 *
 * ## Why this file exists, stated plainly
 *
 * The service shipped referencing `users.full_name`, a column this platform does not have on that
 * table and never did. Both of its endpoints answered 500 on every call — and `pnpm verify` was
 * green over all of it, because nothing anywhere executed `list` or `invite` against Postgres. The
 * security session found it only as a side effect of `remove` returning `this.list(...)`.
 *
 * That is the exact failure this project already has a standing note about: a green suite over an
 * unusable feature. A unit test with a mocked database would have been green too. So every test
 * below runs real SQL, and the first one is the least interesting-sounding assertion in the file —
 * that the list can be read at all.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('a partner managing its own staff', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  const db: Database = harness.db;

  let service: PartnerEmployeesService;
  let partnerId = '';
  let otherPartnerId = '';
  let ownerUserId = '';
  let roleId = '';
  let sent: { to: string; subject: string }[] = [];
  let revoked: string[] = [];

  const owner = (): AccessTokenClaims =>
    ({
      sub: ownerUserId,
      role: 'partner',
      permissions: [P.PARTNER_EMPLOYEE_MANAGE],
    }) as unknown as AccessTokenClaims;

  beforeEach(async () => {
    await harness.begin();

    sent = [];
    revoked = [];

    service = new PartnerEmployeesService(
      db,
      new AuditService(db),
      {
        issue: () => Promise.resolve({ token: 'a-token-long-enough-to-pass', id: 'x' }),
      } as unknown as AuthTokenService,
      {
        revokeAllForUser: (id: string) => {
          revoked.push(id);

          return Promise.resolve();
        },
      } as unknown as TokenService,
      {
        send: (mail: { to: string; subject: string }) => {
          sent.push({ to: mail.to, subject: mail.subject });

          return Promise.resolve();
        },
      } as unknown as MailService,
      { PARTNER_URL: 'https://partner.example' } as Env,
    );

    const made = await db.execute<{
      partner: string;
      other: string;
      owner: string;
      role: string;
    }>(sql`
      WITH ou AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('emp-owner-' || gen_random_uuid() || '@safra.test', '+963900000600', 'partner', 'active')
        RETURNING id
      ), pa AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email)
        SELECT ou.id, (SELECT id FROM partner_types LIMIT 1), 'Emp Co', 'موظفون',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000600', 'emp@safra.test'
        FROM ou
        RETURNING id
      ), ou2 AS (
        INSERT INTO users (email, phone, role, status)
        VALUES ('emp-other-' || gen_random_uuid() || '@safra.test', '+963900000601', 'partner', 'active')
        RETURNING id
      ), pb AS (
        INSERT INTO partners (user_id, partner_type_id, legal_name, display_name, city_id,
                              address, phone, email)
        SELECT ou2.id, (SELECT id FROM partner_types LIMIT 1), 'Other Co', 'آخر',
               (SELECT id FROM cities WHERE deleted_at IS NULL LIMIT 1), 'x',
               '+963900000601', 'emp2@safra.test'
        FROM ou2
        RETURNING id
      ), r AS (
        /*
          The role belongs to the partner this fixture just created — roles are per-partner since
          2026-08-23. SELECT ... FROM pa rather than a bare VALUES, because a CTE may reference a
          SIBLING CTE even though it cannot read a table another CTE has just written.

          No backticks in this comment: it sits inside a sql template literal and a backtick would
          end it. Fourth time that has cost time today.
        */
        INSERT INTO partner_employee_roles (partner_id, name, permissions)
        SELECT pa.id, 'استقبال-' || gen_random_uuid(),
               ARRAY['booking.read_own', 'booking.check_in']
        FROM pa
        RETURNING id
      )
      SELECT (SELECT id FROM pa) AS partner, (SELECT id FROM pb) AS other,
             (SELECT id FROM ou) AS owner, (SELECT id FROM r) AS role
    `);

    const row = made.rows[0];

    partnerId = row?.partner ?? '';
    otherPartnerId = row?.other ?? '';
    ownerUserId = row?.owner ?? '';
    roleId = row?.role ?? '';
  });

  afterEach(async () => {
    await harness.rollback();
  });

  const invite = async (
    over: Partial<{ email: string; fullName: string; roleId: string }> = {},
  ) =>
    (
      await service.invite(owner(), partnerId, {
        email: `rec-${crypto.randomUUID()}@safra.test`,
        fullName: 'رنا الاستقبال',
        roleId,
        ...over,
      })
    ).items;

  /** THE test. It asserts the least interesting thing in the file: that the query runs. */
  it('can read an empty list without erroring', async () => {
    await expect(service.list(partnerId)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
  });

  it('invites somebody and lists them back', async () => {
    const employees = await invite();

    expect(employees).toHaveLength(1);
    expect(employees[0]?.fullName).toBe('رنا الاستقبال');
    expect(employees[0]?.roleId).toBe(roleId);
    expect(employees[0]?.status).toBe('active');
  });

  /**
   * Not yet activated, and the screen must be able to SAY so.
   *
   * This is the field that was missing from the onboarding flow this morning: five steps showed
   * «تم» while the person could not sign in, because nothing surfaced "they have not opened their
   * invitation yet". A list that cannot express that state produces the same failure again.
   *
   * `invitationPending` is false here rather than true because the token service is stubbed, so no
   * `auth_tokens` row exists — the assertion is that the field is COMPUTED and false, not that a
   * stub wrote a row. The real pending case is covered where the token service is real.
   */
  it('reports an invited employee as not yet activated', async () => {
    const [employee] = await invite();

    expect(employee?.activated).toBe(false);
    expect(employee?.invitationPending).toBe(false);
  });

  it('emails the address that was invited', async () => {
    await invite({ email: 'rana@safra.test' });

    expect(sent).toHaveLength(1);
    expect(sent[0]?.to).toBe('rana@safra.test');
  });

  /** The role's capabilities are narrowed on read — a stored row is never authoritative. */
  it('reports only permissions the allow-list still contains', async () => {
    await db.execute(sql`
      UPDATE partner_employee_roles
      SET permissions = ARRAY['booking.read_own', 'payout.execute']
      WHERE id = ${roleId}::uuid
    `);

    const [employee] = await invite();

    expect(employee?.permissions).toEqual([P.BOOKING_READ_OWN]);
  });

  /**
   * The list PAGES, and a partner's staff count is not ours to assume.
   *
   * This returned everything unpaged on the reasoning that a partner has tens of employees. That
   * is a guess about a stranger's business, not a fact about ours — a hotel group with three
   * hundred staff is an ordinary customer. Cursor rather than page numbers, because this is a
   * partner-facing list rather than one of the console registries.
   */
  describe('paging', () => {
    const inviteMany = async (count: number) => {
      for (let n = 0; n < count; n += 1) {
        await invite({ fullName: `موظف ${n}` });
      }
    };

    it('stops at the limit and offers a cursor', async () => {
      await inviteMany(3);

      const page = await service.list(partnerId, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).not.toBeNull();
    });

    it('walks the whole list without repeating or skipping anybody', async () => {
      await inviteMany(5);

      const seen: string[] = [];
      let cursor: string | undefined;

      for (let guard = 0; guard < 10; guard += 1) {
        const page: EmployeePage = await service.list(partnerId, { limit: 2, cursor });

        seen.push(...page.items.map((row) => row.id));

        if (!page.nextCursor) break;

        cursor = page.nextCursor;
      }

      expect(seen).toHaveLength(5);
      expect(new Set(seen).size).toBe(5);
    });

    it('says there is no more when the last page is exact', async () => {
      await inviteMany(2);

      const page = await service.list(partnerId, { limit: 2 });

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    /** A forged cursor shifts the window; it can never widen it, because the partner id is not in it. */
    it('refuses a cursor it did not issue', async () => {
      await expect(
        service.list(partnerId, { limit: 2, cursor: 'not-a-real-cursor' }),
      ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_CURSOR_INVALID } });
    });
  });

  describe('who may be invited', () => {
    it('refuses somebody who already works for a partner', async () => {
      const email = `dup-${crypto.randomUUID()}@safra.test`;

      await invite({ email });

      await expect(invite({ email })).rejects.toMatchObject({
        response: { code: ERROR.EMPLOYEE_ALREADY_EMPLOYED },
      });
    });

    it('refuses a staff account', async () => {
      const staff = await db.execute<{ email: string }>(sql`
        INSERT INTO users (email, phone, role, status)
        VALUES ('emp-staff-' || gen_random_uuid() || '@safra.test', '+963900000602',
                'support_agent', 'active')
        RETURNING email
      `);

      await expect(invite({ email: staff.rows[0]?.email ?? '' })).rejects.toMatchObject({
        response: { code: ERROR.EMPLOYEE_EMAIL_IS_STAFF },
      });
    });

    /** An owner is not their own employee — converting them would take the business's access away. */
    it('refuses the partner’s own account', async () => {
      const account = await db.execute<{ email: string }>(sql`
        SELECT email FROM users WHERE id = ${ownerUserId}::uuid
      `);

      await expect(invite({ email: account.rows[0]?.email ?? '' })).rejects.toMatchObject(
        {
          response: { code: ERROR.EMPLOYEE_EMAIL_IS_OWNER },
        },
      );
    });

    it('refuses a role that does not exist', async () => {
      await expect(
        invite({ roleId: '00000000-0000-0000-0000-0000000000cc' }),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_ROLE_NOT_FOUND } });
    });
  });

  describe('changing and ending an employment', () => {
    it('suspends, and revokes every session immediately', async () => {
      const [employee] = await invite();
      const { items } = await service.update(owner(), partnerId, employee?.id ?? '', {
        status: 'suspended',
      });

      expect(items[0]?.status).toBe('suspended');
      /* The docblock promises immediacy; this is whether the code keeps that promise. */
      expect(revoked).toHaveLength(1);
    });

    /** A role change is routine and must NOT sign a shift of receptionists out mid-service. */
    it('does not revoke on an ordinary role change', async () => {
      const [employee] = await invite();
      const other = await db.execute<{ id: string }>(sql`
        INSERT INTO partner_employee_roles (partner_id, name, permissions)
        VALUES (${partnerId}::uuid, 'تدبير-' || gen_random_uuid(),
                ARRAY['calendar.manage_own'])
        RETURNING id
      `);

      await service.update(owner(), partnerId, employee?.id ?? '', {
        roleId: other.rows[0]?.id,
      });

      expect(revoked).toEqual([]);
    });

    it('removes somebody and drops them from the list', async () => {
      const [employee] = await invite();

      await expect(
        service.remove(owner(), partnerId, employee?.id ?? ''),
      ).resolves.toMatchObject({ items: [] });
    });

    /**
     * Another partner's employee answers exactly as one that does not exist.
     *
     * The WHERE carries `partner_id`, so "manage somebody else's staff" is unexpressible rather
     * than merely refused — and a probing caller cannot tell an id that is not theirs from one
     * that was never issued.
     */
    it('cannot touch another partner’s employee', async () => {
      const [employee] = await invite();

      await expect(
        service.update(owner(), otherPartnerId, employee?.id ?? '', {
          status: 'suspended',
        }),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_NOT_FOUND } });

      await expect(
        service.remove(owner(), otherPartnerId, employee?.id ?? ''),
      ).rejects.toMatchObject({ response: { code: ERROR.EMPLOYEE_NOT_FOUND } });
    });

    it('refuses an update that changes nothing', async () => {
      const [employee] = await invite();

      await expect(
        service.update(owner(), partnerId, employee?.id ?? '', {}),
      ).rejects.toMatchObject({ response: { code: ERROR.REQUEST_VALIDATION_FAILED } });
    });
  });

  /** The roles THIS partner has defined — never another partner's. */
  it('offers the partner’s own roles', async () => {
    const roles = await service.assignableRoles(partnerId);

    expect(roles.some((role) => role.id === roleId)).toBe(true);
  });

  /**
   * And nobody else's.
   *
   * Roles were global until 2026-08-23; now they are per-partner, so "whose role is this" is a
   * question with a wrong answer available. Offering another partner's roles in the picker would
   * put a competitor's job titles into this partner's form.
   */
  it('does not offer another partner’s roles', async () => {
    const theirs = await db.execute<{ id: string }>(sql`
      INSERT INTO partner_employee_roles (partner_id, name, permissions)
      VALUES (${otherPartnerId}::uuid, 'سري-' || gen_random_uuid(),
              ARRAY['booking.read_own'])
      RETURNING id
    `);

    const roles = await service.assignableRoles(partnerId);

    expect(roles.some((role) => role.id === theirs.rows[0]?.id)).toBe(false);
  });
});
