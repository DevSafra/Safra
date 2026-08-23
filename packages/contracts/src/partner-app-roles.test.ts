import { describe, expect, it } from 'vitest';

import {
  isPartnerAppRole,
  PARTNER_APP_ROLES,
  ROLE_PERMISSIONS,
  STAFF_ROLES,
} from './permissions.js';

/**
 * Who may reach the partner portal at all (2026-08-23).
 *
 * ## The failure this pins
 *
 * Admission was three separate `role === 'partner'` checks — the sign-in route, the middleware and
 * the server-side session reader. Employees were added to the platform and all three still said
 * `'partner'`, so an employee could be invited, activated, and told «تم تفعيل الحساب. سجّل الدخول
 * للمتابعة» — and then refused at the door with a 403. The whole feature was unreachable, and every
 * layer was individually defensible.
 *
 * Nothing failed. Every test passed. It took somebody walking the journey end to end.
 */
describe('who may sign in to the partner portal', () => {
  /** THE test. If this is ever false again, the employees feature is dead on arrival. */
  it('admits a partner’s employee', () => {
    expect(isPartnerAppRole('partner_employee')).toBe(true);
  });

  it('admits the partner themselves', () => {
    expect(isPartnerAppRole('partner')).toBe(true);
  });

  it.each([
    'customer',
    'support_agent',
    'finance_officer',
    'operations_manager',
    'super_admin',
  ])('refuses %s', (role) => {
    expect(isPartnerAppRole(role)).toBe(false);
  });

  /**
   * The two doors never overlap.
   *
   * A staff account in the partner portal, or a partner in the console, would be a person seeing a
   * business's private data through a door built for somebody else.
   */
  it('shares nobody with the console', () => {
    const staff = new Set<string>(STAFF_ROLES);

    expect(PARTNER_APP_ROLES.filter((role) => staff.has(role))).toEqual([]);
  });

  /** Every admitted role is a real role, so a typo cannot quietly admit nobody. */
  it('names only roles that exist', () => {
    for (const role of PARTNER_APP_ROLES) {
      expect(Object.keys(ROLE_PERMISSIONS)).toContain(role);
    }
  });
});
