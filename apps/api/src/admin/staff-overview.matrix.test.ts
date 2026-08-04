import { describe, expect, it } from 'vitest';

import { PERMISSIONS, ROLE_PERMISSIONS, STAFF_ROLES } from '@safra/contracts';

import { StaffOverviewService } from './staff-overview.service.js';

/**
 * The permission matrix the staff screen renders.
 *
 * ## Why this is worth a test
 *
 * Handoff §14 requires the matrix to be "enforced server-side, not just rendered". The way to
 * satisfy that is to derive it from `ROLE_PERMISSIONS` — the exact constant `PermissionsGuard`
 * checks on every request — rather than transcribe it into the UI. These tests pin the derivation,
 * because the failure mode is silent: a transcribed matrix keeps rendering happily while the
 * server's real answer moves underneath it, and the screen becomes a confident diagram of a
 * policy that is no longer in force.
 *
 * The service needs no database for this, so it is constructed with a null one. That is honest
 * rather than lazy: `matrix()` is pure, and a test that spun up Postgres to check a pure function
 * would only be slower.
 */
describe('the staff permission matrix', () => {
  /** `matrix()` touches no database; the other methods are covered by the integration suite. */
  const service = new StaffOverviewService(
    null as unknown as ConstructorParameters<typeof StaffOverviewService>[0],
  );

  const matrix = service.matrix();

  it('lists the staff roles and only the staff roles', () => {
    expect(matrix.roles).toStrictEqual(STAFF_ROLES);

    /*
      `customer` and `partner` are roles in the same enum and are NOT staff. Showing them in a
      console matrix invites somebody to grant a customer `payout.execute`.
    */
    expect(matrix.roles).not.toContain('customer');
    expect(matrix.roles).not.toContain('partner');
  });

  it('gives every row one cell per role', () => {
    expect(matrix.rows.length).toBeGreaterThan(0);

    for (const row of matrix.rows) {
      expect(row.granted).toHaveLength(matrix.roles.length);
    }
  });

  it('agrees with ROLE_PERMISSIONS for every cell', () => {
    for (const row of matrix.rows) {
      for (const [index, granted] of row.granted.entries()) {
        const role = matrix.roles[index];

        expect(role).toBeDefined();

        const expected = (
          ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS] as readonly string[]
        ).includes(row.permission);

        expect(granted, `${row.permission} × ${String(role)}`).toBe(expected);
      }
    }
  });

  /**
   * super_admin holds everything, so its column is solid.
   *
   * This is the cheapest possible canary for the derivation being inverted or misaligned: any
   * off-by-one in the role indexing shows up here immediately.
   */
  it('grants super_admin every listed permission', () => {
    const column = matrix.roles.indexOf('super_admin');

    expect(column).toBeGreaterThanOrEqual(0);

    for (const row of matrix.rows) {
      expect(row.granted[column], row.permission).toBe(true);
    }
  });

  /**
   * Emergency Mode is super_admin ONLY.
   *
   * EC-009 halts commerce in a region. If this ever shows two ticks, either the role map widened
   * or the matrix stopped reflecting it — and both are things somebody must be told about
   * deliberately rather than discover in a screenshot.
   */
  it('shows emergency mode as super_admin only', () => {
    const row = matrix.rows.find(
      (entry) => entry.permission === PERMISSIONS.EMERGENCY_MODE_ACTIVATE,
    );

    expect(row).toBeDefined();
    expect(row?.granted.filter(Boolean)).toHaveLength(1);
    expect(row?.granted[matrix.roles.indexOf('super_admin')]).toBe(true);
  });

  /**
   * The whole permission catalogue is listed.
   *
   * This test was written the other way round — asserting that permissions "no staff role holds"
   * were dropped — and it FAILED, which is how a piece of dead code was found: `SUPER_ADMIN` is
   * `Object.values(PERMISSIONS)`, so super_admin holds everything and the filter could never fire.
   * Listing everything is also the more useful answer: the rows that matter most on this screen
   * are the ones only super_admin holds.
   */
  it('lists every permission in the catalogue', () => {
    const listed = new Set(matrix.rows.map((row) => row.permission));

    expect(listed.size).toBe(Object.values(PERMISSIONS).length);

    // Including the customer/partner ones, which super_admin does in fact hold.
    expect(listed.has(PERMISSIONS.BOOKING_READ_OWN)).toBe(true);
    expect(listed.has(PERMISSIONS.PROPERTY_MANAGE_OWN)).toBe(true);

    // And every row has at least one grant, because super_admin's column is solid.
    for (const row of matrix.rows) {
      expect(row.granted.some(Boolean), row.permission).toBe(true);
    }
  });

  /** Broadly-granted rows first, so the shape of the grid shows where privilege concentrates. */
  it('orders rows from most widely granted to narrowest', () => {
    const spreads = matrix.rows.map((row) => row.granted.filter(Boolean).length);

    for (let index = 1; index < spreads.length; index += 1) {
      expect(spreads[index - 1] ?? 0).toBeGreaterThanOrEqual(spreads[index] ?? 0);
    }
  });
});
