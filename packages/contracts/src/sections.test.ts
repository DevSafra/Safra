import { describe, expect, it } from 'vitest';

import {
  canOpenSection,
  CONSOLE_SECTION_PERMISSIONS,
  has,
  openableSections,
  PARTNER_SECTION_PERMISSIONS,
} from './sections.js';
import { PARTNER_EMPLOYEE_PERMISSIONS } from './partner-employee.js';
import { PERMISSIONS as P, ROLE_PERMISSIONS } from './permissions.js';

/**
 * Which capability opens which section.
 *
 * Neither app gated its navigation until 2026-08-23: a reader saw every link and was refused on
 * arrival. These hold the map that fixes it, and most of them are about what does NOT open.
 */
describe('opening a section', () => {
  const partner = PARTNER_SECTION_PERMISSIONS;

  it('opens a section the reader holds the capability for', () => {
    expect(canOpenSection([P.BOOKING_CHECK_IN], partner, 'arrivals')).toBe(true);
  });

  it('does not open one they do not', () => {
    expect(canOpenSection([P.BOOKING_CHECK_IN], partner, 'payouts')).toBe(false);
  });

  /**
   * An UNKNOWN section is closed, not open.
   *
   * A screen added without a map entry is then invisible until somebody maps it — a bug people
   * notice. The opposite default is a screen silently open to everyone, which is a bug nobody
   * notices until it matters.
   */
  it('closes a section nobody has mapped', () => {
    expect(canOpenSection([P.BOOKING_READ_OWN], partner, 'not-a-section')).toBe(false);
  });

  it('closes everything for a reader with no permissions at all', () => {
    expect(openableSections([], partner)).toEqual([]);
    expect(openableSections(undefined, partner)).toEqual([]);
  });

  /** A partner holds every capability that opens one of their own sections. */
  it('opens every partner section for the owner', () => {
    const owner = ROLE_PERMISSIONS.partner;

    expect(openableSections(owner, partner)).toEqual(Object.keys(partner));
  });

  /** And a super admin opens every console section. */
  it('opens every console section for a super admin', () => {
    const admin = ROLE_PERMISSIONS.super_admin;

    expect(openableSections(admin, CONSOLE_SECTION_PERMISSIONS)).toEqual(
      Object.keys(CONSOLE_SECTION_PERMISSIONS),
    );
  });

  describe('what an employee can reach', () => {
    /**
     * SIX of the eleven grantable capabilities open a section; the rest are in-page controls.
     *
     * That proportion is the reason gating the nav is only half the job — an employee without
     * `booking.respond_as_partner` still sees the accept button unless something gates it in the
     * page, and by count that is the bigger half.
     */
    it('has six of the eleven capabilities open a door', () => {
      const opening = PARTNER_EMPLOYEE_PERMISSIONS.filter((permission) =>
        (Object.values(partner) as readonly string[]).includes(permission),
      );

      expect(opening).toHaveLength(6);
    });

    it('never opens an owner-only section', () => {
      const everything = [...PARTNER_EMPLOYEE_PERMISSIONS];

      for (const section of ['payouts', 'contracts', 'employees', 'employeeRoles']) {
        expect(canOpenSection(everything, partner, section), section).toBe(false);
      }
    });

    /**
     * THE case that decides the landing screen: a legitimate role can open NOTHING.
     *
     * Both of these are reasonable boxes to tick — respond to bookings, reply to reviews — and
     * neither opens the screen it acts on. Somebody will build this role, and an empty dashboard is
     * indistinguishable from a broken portal.
     */
    it('can open nothing at all, from two reasonable choices', () => {
      const inPageOnly = [P.BOOKING_RESPOND_AS_PARTNER, P.REVIEW_RESPOND_OWN];

      expect(openableSections(inPageOnly, partner)).toEqual([]);
    });
  });

  /** `has` answers the in-page question the section map deliberately cannot. */
  describe('in-page capabilities', () => {
    it('reports a capability the reader holds', () => {
      expect(has([P.BOOKING_RESPOND_AS_PARTNER], P.BOOKING_RESPOND_AS_PARTNER)).toBe(
        true,
      );
    });

    it('reports one they do not, and survives no permissions at all', () => {
      expect(has([P.BOOKING_READ_OWN], P.BOOKING_RESPOND_AS_PARTNER)).toBe(false);
      expect(has(undefined, P.BOOKING_READ_OWN)).toBe(false);
    });
  });

  /** Every mapped capability is a real one, so a typo cannot quietly close a section forever. */
  it('names only capabilities that exist', () => {
    const real = new Set<string>(Object.values(P));

    for (const [section, permission] of [
      ...Object.entries(partner),
      ...Object.entries(CONSOLE_SECTION_PERMISSIONS),
    ]) {
      expect(real.has(permission), section).toBe(true);
    }
  });
});
