import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { sql } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ERROR, PERMISSIONS as P } from '@safra/contracts';
import { createRollbackDatabase, type Database } from '@safra/db';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { AuditService } from '../common/audit/audit.service.js';
import { codeOf } from '../common/errors/app-error.js';
import { findLiveEmployment } from './live-employment.js';
import { PartnerEmployeeRolesService } from './partner-employee-roles.service.js';
import { PartnerEmployeesService } from './partner-employees.service.js';

/**
 * `O-emp-1` — every way an employment can stop being live, and what it leaves behind.
 *
 * ## The state being hunted
 *
 * An activated employee is `users.role = 'partner_employee'`. Authority is resolved through
 * `findLiveEmployment`, which fails CLOSED — no live employment means no partner id and no
 * permissions, and `ROLE_PERMISSIONS.partner_employee` is deliberately empty. So an account marked
 * `partner_employee` with nothing resolvable **can sign in and do nothing at all**, and the
 * customer profile it may also hold is reachable but useless without the permissions to read it.
 *
 * That is not a theoretical shape: `remove()` exists precisely because ending a job used to end the
 * ACCOUNT. The open question this file answers is whether any OTHER path still gets there.
 *
 * ## Why it is not repaired by inferring at read time
 *
 * That was written and reverted within the hour. A fallback keyed on a MISSING row cannot tell a
 * finished job from a suspended one, a withdrawn role, a deleted employer or a suspended employer —
 * five states that must each yield nothing — and granting authority because a row is absent is how
 * deny-by-default inverts. What an account may do is stored, not inferred.
 *
 * ## So the closure is a census, not a mechanism
 *
 * Each path is either REFUSED by the product, REVERSIBLE, or repaired at the write. What is left
 * after that is what genuinely needs a staff action, and naming it exactly is worth more than a
 * reconciliation job built against a guess.
 */
const DATABASE_URL = process.env['DATABASE_URL'];
const describeIfDb = DATABASE_URL ? describe : describe.skip;

describeIfDb('an employment that stops being live', () => {
  const harness = createRollbackDatabase(DATABASE_URL ?? '');
  let db: Database;
  let employees: PartnerEmployeesService;
  /** Whose sessions were revoked, so «ends the job» can be checked to end the SESSION too. */
  let revoked: string[];
  let roles: PartnerEmployeeRolesService;

  beforeEach(async () => {
    await harness.begin();
    db = harness.db;
    /*
      A recording stub for SESSION REVOCATION, and nothing else.

      `remove` and `update` revoke the account's sessions — «an ended job must not leave a live
      token» — and that is the one collaborator these paths reach. It is stubbed rather than real
      because a real `TokenService` would make this file boot the auth stack to assert a stored
      role, and it RECORDS rather than being a no-op, so the assertion below can hold the revocation
      to account instead of merely tolerating it. Everything else is `undefined`: a path that
      reached it would throw, which is the right failure for a test claiming those paths are not
      taken.
    */
    revoked = [];
    employees = new PartnerEmployeesService(
      db,
      new AuditService(db),
      undefined as never,
      {
        /* Returns a resolved promise rather than being `async`: it awaits nothing. */
        revokeAllForUser: (userId: string) => {
          revoked.push(userId);

          return Promise.resolve();
        },
      } as never,
      undefined as never,
      undefined as never,
    );
    roles = new PartnerEmployeeRolesService(db, new AuditService(db));
  });

  afterEach(async () => {
    await harness.rollback();
  });

  /** A real, active employment from the testbed, with its partner and its role. */
  async function anEmployment() {
    const rows = await db.execute<{
      id: string;
      partner_id: string;
      user_id: string;
      role_id: string;
    }>(sql`
      SELECT pe.id, pe.partner_id, pe.user_id, pe.role_id
        FROM partner_employees pe
        JOIN users u ON u.id = pe.user_id
       WHERE pe.status = 'active' AND pe.deleted_at IS NULL
         AND u.role = 'partner_employee' AND u.deleted_at IS NULL
       ORDER BY pe.id
       LIMIT 1
    `);

    const row = rows.rows[0];

    if (!row) throw new Error('the testbed seeds no active partner employee');

    return row;
  }

  const owner = (row: { partner_id: string; user_id: string }): AccessTokenClaims =>
    ({
      sub: row.user_id,
      role: 'partner',
      permissions: [P.PARTNER_EMPLOYEE_MANAGE],
      locale: 'ar',
      partnerId: row.partner_id,
    }) as unknown as AccessTokenClaims;

  /** The account's stored role — the thing that strands when it disagrees with reality. */
  const storedRole = async (userId: string): Promise<string> => {
    const rows = await db.execute<{ role: string }>(
      sql`SELECT role::text AS role FROM users WHERE id = ${userId}::uuid`,
    );

    return rows.rows[0]?.role ?? '';
  };

  /**
   * The control. Without it, every «yields nothing» below could be a fixture that reaches nothing.
   */
  it('resolves to a partner and permissions while it is live', async () => {
    const row = await anEmployment();
    const live = await findLiveEmployment(db, row.user_id);

    expect(live?.partnerId, 'the fixture employment resolves').toBe(row.partner_id);
    expect(
      live?.permissions.length,
      'and carries its role’s permissions',
    ).toBeGreaterThan(0);
  });

  /* ── Path 1: the job ends. Repaired at the write. ────────────────────────── */

  it('puts the account back to customer when the employment is removed', async () => {
    const row = await anEmployment();

    await employees.remove(owner(row), row.partner_id, row.id);

    expect(await findLiveEmployment(db, row.user_id)).toBeFalsy();
    expect(await storedRole(row.user_id), 'ending a job must not end the account').toBe(
      'customer',
    );
    /*
      And the SESSION ends with the job. A role that went back to `customer` while a token carrying
      the old permissions stayed live would be the reverse defect: an ex-employee holding partner
      authority until their access token expired.
    */
    expect(revoked, 'the account’s sessions are revoked').toContain(row.user_id);
  });

  /* ── Path 2: the employment is suspended. Reversible, and deliberately so. ── */

  it('suspends and restores without the account ever being stranded', async () => {
    const row = await anEmployment();

    await employees.update(owner(row), row.partner_id, row.id, { status: 'suspended' });

    expect(
      await findLiveEmployment(db, row.user_id),
      'suspended yields nothing',
    ).toBeFalsy();
    /*
      The stored role STAYS `partner_employee`, and that is correct rather than a gap: the job still
      exists and the suspension is meant to be reversible. «Stranded» means unreachable, and this is
      one call from live.
    */
    expect(await storedRole(row.user_id)).toBe('partner_employee');

    await employees.update(owner(row), row.partner_id, row.id, { status: 'active' });

    expect(
      (await findLiveEmployment(db, row.user_id))?.partnerId,
      'restoring brings the whole authority back',
    ).toBe(row.partner_id);
  });

  /* ── Path 3: the role is withdrawn. REFUSED while anybody holds it. ──────── */

  /**
   * The path the register listed as open, and the product already closes it.
   *
   * «Refused rather than cascaded. An employee whose role vanished resolves to NO permissions — an
   * account that still signs in and can do nothing, for a reason no screen explains. Moving those
   * people to another role is a decision, and it belongs to whoever is deleting.»
   */
  it('refuses to withdraw a role that anybody still holds', async () => {
    const row = await anEmployment();

    expect(
      codeOf(
        await roles
          .remove(owner(row), row.partner_id, row.role_id)
          .catch((error: unknown) => error),
      ),
    ).toBe(ERROR.EMPLOYEE_ROLE_IN_USE);

    expect(
      (await findLiveEmployment(db, row.user_id))?.partnerId,
      'and the employment is untouched by the attempt',
    ).toBe(row.partner_id);
  });

  /* ── Path 4: the employer is soft-deleted. NO ENDPOINT DOES THIS. ────────── */

  /**
   * The residual, and it is outside the product.
   *
   * A soft-deleted partner strands every one of its employees — `findLiveEmployment` requires the
   * employer to be neither deleted nor withdrawn, and nothing puts `users.role` back. This asserts
   * BOTH halves: that the damage is real, so nobody dismisses it, and that reaching it needs SQL,
   * because no route in the API soft-deletes a partner.
   *
   * That is what turns `O-emp-1` from «a way a person loses their account as a side effect of
   * something done to somebody else» into «a data fix needs a staff action afterwards» — a real
   * operational note, and not an engineering gap with a mechanism missing.
   */
  it('strands an employee when the partner is soft-deleted by hand, which no route does', async () => {
    const row = await anEmployment();

    await db.execute(
      sql`UPDATE partners SET deleted_at = now() WHERE id = ${row.partner_id}::uuid`,
    );

    expect(await findLiveEmployment(db, row.user_id), 'the damage is real').toBeFalsy();
    expect(
      await storedRole(row.user_id),
      'and nothing puts the account back — this is the residual',
    ).toBe('partner_employee');
  });

  /**
   * And there is no route that could do it.
   *
   * A source assertion rather than a behavioural one, because the claim is about ABSENCE: it is
   * the day somebody adds `DELETE /admin/partners/:reference` that this becomes an engineering gap
   * again, and this is where they are told.
   */
  it('has no endpoint that soft-deletes a partner', () => {
    const dir = join(process.cwd(), 'apps/api/src');
    const offenders: string[] = [];

    const walk = (at: string): void => {
      for (const entry of readdirSync(at, { withFileTypes: true })) {
        const path = join(at, entry.name);

        if (entry.isDirectory()) {
          walk(path);
          continue;
        }

        /*
          `scripts/` is excluded on purpose: `seed-testbed.ts` clears fixtures on a developer's
          machine and is not reachable by any request. The claim being held is about ROUTES.
        */
        if (path.includes('/scripts/')) continue;
        if (!entry.name.endsWith('.ts') || entry.name.includes('.test.')) continue;

        const source = readFileSync(path, 'utf8');

        if (/UPDATE\s+partners\s+SET[^;]*deleted_at\s*=/is.test(source)) {
          offenders.push(path.replace(`${process.cwd()}/`, ''));
        }
      }
    };

    walk(dir);

    expect(
      offenders,
      'a route that soft-deletes a partner strands every one of its employees — see O-emp-1',
    ).toEqual([]);
  });
});
