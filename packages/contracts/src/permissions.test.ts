import { describe, expect, it } from 'vitest';

import {
  PERMISSIONS as P,
  ROLES,
  ROLE_PERMISSIONS,
  isStaffRole,
  resolvePermissions,
} from './permissions.js';

/**
 * These tests encode SRS §4's NEGATIVE requirements — the things each role must
 * NOT be able to do. They are the reason the file exists.
 *
 * A permission accidentally added to the wrong role is a silent privilege
 * escalation that no type checker catches, so each restriction the spec states in
 * prose is asserted here in code.
 */
describe('role permission separation (SRS §4)', () => {
  it('denies support agents the ability to edit prices', () => {
    // §4: "does not edit prices or financial settings"
    expect(ROLE_PERMISSIONS.support_agent).not.toContain(P.PRICE_UPDATE);
  });

  it('denies support agents financial settings and money movement', () => {
    const denied = [
      P.SETTINGS_UPDATE,
      P.REFUND_CREATE,
      P.WALLET_ADJUST,
      P.PAYOUT_EXECUTE,
      P.PAYMENT_READ,
    ];

    for (const permission of denied) {
      expect(ROLE_PERMISSIONS.support_agent).not.toContain(permission);
    }
  });

  it('denies finance officers access to customer conversations', () => {
    // §4: "does not see unnecessary conversation details"
    expect(ROLE_PERMISSIONS.finance_officer).not.toContain(P.MESSAGE_READ);
    expect(ROLE_PERMISSIONS.finance_officer).not.toContain(P.MESSAGE_SEND);
  });

  it('denies partners any access to customer payment data', () => {
    // §7.2: "no payment card data belonging to the customer is shown to a partner"
    expect(ROLE_PERMISSIONS.partner).not.toContain(P.PAYMENT_READ);
    expect(ROLE_PERMISSIONS.partner).not.toContain(P.LEDGER_READ);
    expect(ROLE_PERMISSIONS.partner).not.toContain(P.PAYOUT_ACCOUNT_READ);
  });

  it('denies partners visibility of other partners or all bookings', () => {
    expect(ROLE_PERMISSIONS.partner).not.toContain(P.BOOKING_READ_ALL);
    expect(ROLE_PERMISSIONS.partner).not.toContain(P.PARTNER_READ);
  });

  it('restricts payout account reading to finance and super admin only', () => {
    const allowed = ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].includes(P.PAYOUT_ACCOUNT_READ),
    );
    expect(allowed.sort()).toEqual(['finance_officer', 'super_admin']);
  });

  it('restricts Emergency Mode to super admin only', () => {
    // §16 EC-009: halting bookings platform-wide is the highest-impact action.
    const allowed = ROLES.filter((role) =>
      ROLE_PERMISSIONS[role].includes(P.EMERGENCY_MODE_ACTIVATE),
    );
    expect(allowed).toEqual(['super_admin']);
  });

  it('grants customers nothing beyond their own records', () => {
    for (const permission of ROLE_PERMISSIONS.customer) {
      expect(permission.endsWith('_all')).toBe(false);
    }
    expect(ROLE_PERMISSIONS.customer).not.toContain(P.BOOKING_READ_ALL);
  });

  it('exposes no delete permission for any role', () => {
    // §4.1 / P-003: no user may permanently delete data. Enforced by absence.
    for (const role of ROLES) {
      for (const permission of ROLE_PERMISSIONS[role]) {
        expect(permission).not.toMatch(/\.delete$/);
      }
    }
  });

  it('classifies exactly the four back-office roles as staff', () => {
    expect(ROLES.filter(isStaffRole).sort()).toEqual([
      'finance_officer',
      'operations_manager',
      'super_admin',
      'support_agent',
    ]);
  });
});

describe('resolvePermissions', () => {
  it('returns the role baseline when no overrides are given', () => {
    expect(resolvePermissions('customer')).toEqual([...ROLE_PERMISSIONS.customer]);
  });

  it('adds a valid override on top of the role', () => {
    const resolved = resolvePermissions('support_agent', [P.PRICE_UPDATE]);
    expect(resolved).toContain(P.PRICE_UPDATE);
  });

  it('ignores unknown override strings instead of trusting them', () => {
    // A stale or hand-edited override must never become an implicit grant.
    const resolved = resolvePermissions('customer', [
      'booking.delete_everything',
      'not.a.permission',
      '*',
    ]);
    expect(resolved).toEqual([...ROLE_PERMISSIONS.customer]);
  });

  it('never removes a baseline permission via overrides', () => {
    const resolved = resolvePermissions('partner', []);
    for (const permission of ROLE_PERMISSIONS.partner) {
      expect(resolved).toContain(permission);
    }
  });

  it('does not produce duplicates when an override repeats the baseline', () => {
    const resolved = resolvePermissions('customer', [P.BOOKING_CREATE, P.BOOKING_CREATE]);
    expect(new Set(resolved).size).toBe(resolved.length);
  });
});
