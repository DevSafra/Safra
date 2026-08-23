import { describe, expect, it } from 'vitest';

import {
  employeePermissions,
  employeeRoleCreateSchema,
  isEmployeePermission,
  PARTNER_EMPLOYEE_PERMISSIONS,
} from './partner-employee.js';
import { PERMISSIONS as P, ROLE_PERMISSIONS } from './permissions.js';

/**
 * The boundary that makes "let the super admin name a role" safe (Bashar, 2026-08-23).
 *
 * A super admin holds every permission on the platform and is about to get a form that grants
 * permissions to employees of third-party businesses. Everything below exists so that form cannot
 * become a privilege-escalation route with a friendly label on it.
 */
describe('what a partner-employee role may carry', () => {
  /**
   * THE test. An employee must never out-rank their employer.
   *
   * If this fails, somebody has added a permission to the employee list that a partner does not
   * itself hold — which would let a hotel receptionist do something the hotel cannot.
   */
  it('is a subset of what a partner itself can do', () => {
    const partner = new Set<string>(ROLE_PERMISSIONS.partner);
    const excess = PARTNER_EMPLOYEE_PERMISSIONS.filter((value) => !partner.has(value));

    expect(excess).toEqual([]);
  });

  /** Named individually, so adding one of these to the list has to be a deliberate act. */
  it.each([
    ['a partner’s money', P.PAYOUT_READ_OWN],
    ['the partnership agreement', P.PARTNER_CONTRACT_READ],
    ['platform settings', P.SETTINGS_UPDATE],
    ['moving money', P.PAYOUT_EXECUTE],
    ['adjusting a wallet', P.WALLET_ADJUST],
    ['approving a partner', P.PARTNER_APPROVE],
    ['reading every booking', P.BOOKING_READ_ALL],
  ])('never grants %s', (_what, permission) => {
    expect(isEmployeePermission(permission)).toBe(false);
  });

  /**
   * A stored role is narrowed on READ, not only on write.
   *
   * Data outlives the rule that admitted it. Shrinking the list has to REVOKE from roles already
   * in the database, not merely stop new ones being created — otherwise a permission withdrawn
   * from the platform keeps working for every role that captured it first.
   */
  it('drops a permission that has since left the list', () => {
    const stored = [P.BOOKING_READ_OWN, P.PAYOUT_EXECUTE, 'invented.permission'];

    expect(employeePermissions(stored)).toEqual([P.BOOKING_READ_OWN]);
  });

  it('keeps the order and the whole of a role that is still valid', () => {
    expect(employeePermissions([...PARTNER_EMPLOYEE_PERMISSIONS])).toEqual([
      ...PARTNER_EMPLOYEE_PERMISSIONS,
    ]);
  });
});

describe('creating a role', () => {
  const valid = { name: 'استقبال', permissions: [P.BOOKING_READ_OWN] };

  it('accepts a named role with at least one capability', () => {
    expect(employeeRoleCreateSchema.parse(valid)).toEqual(valid);
  });

  /* Rejected, not filtered: a super admin must not believe they granted something we dropped. */
  it('rejects a permission outside the list rather than ignoring it', () => {
    const result = employeeRoleCreateSchema.safeParse({
      ...valid,
      permissions: [P.BOOKING_READ_OWN, P.PAYOUT_EXECUTE],
    });

    expect(result.success).toBe(false);
  });

  it('rejects a role with no capabilities at all', () => {
    expect(
      employeeRoleCreateSchema.safeParse({ ...valid, permissions: [] }).success,
    ).toBe(false);
  });

  it('rejects a blank name, and trims a padded one', () => {
    expect(employeeRoleCreateSchema.safeParse({ ...valid, name: '   ' }).success).toBe(
      false,
    );
    expect(employeeRoleCreateSchema.parse({ ...valid, name: '  استقبال  ' }).name).toBe(
      'استقبال',
    );
  });

  /** Unknown fields are refused, so a caller cannot smuggle `partnerId` or `isSystem` in. */
  it('refuses unknown fields', () => {
    const result = employeeRoleCreateSchema
      .strict()
      .safeParse({ ...valid, partnerId: '00000000-0000-0000-0000-000000000001' });

    expect(result.success).toBe(false);
  });
});
