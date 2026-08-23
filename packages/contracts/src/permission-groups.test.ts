import { describe, expect, it } from 'vitest';

import { PERMISSIONS } from './permissions.js';
import {
  groupPermissions,
  permissionGroup,
  permissionPrefixes,
} from './permission-groups.js';

/**
 * The grouping has to stay honest, and the way it goes wrong is silent.
 *
 * A permission filed under the wrong heading still works — the checkbox grants what it says — so
 * nothing fails and nobody notices. These are the two assertions that can actually catch it.
 */
describe('permission grouping', () => {
  /**
   * The one that matters: every resource in the platform has a home.
   *
   * Not "every permission is grouped" — that is true by construction, since unmapped ones fall
   * into «أخرى». This asserts the stronger thing: that nothing is CURRENTLY falling through. It
   * fails the day somebody adds a resource, which is the day to decide where it belongs, rather
   * than the day a super admin scrolls past it under «أخرى» and wonders what it is.
   */
  it('files every permission the platform defines under a real domain', () => {
    const unmapped = Object.values(PERMISSIONS).filter(
      (permission) => permissionGroup(permission) === 'other',
    );

    expect(
      unmapped,
      `These permissions have no domain, so the role form shows them under «أخرى». Add their ` +
        `resource prefix to GROUP_OF_PREFIX in permission-groups.ts — the prefixes currently ` +
        `known are: ${permissionPrefixes().join(', ')}`,
    ).toStrictEqual([]);
  });

  /**
   * And nothing is lost on the way through.
   *
   * The grouping is a display concern, so the one thing it must never do is DROP a permission —
   * an absent checkbox looks like a shorter list rather than a bug, and the capability becomes
   * ungrantable from the only screen that grants it.
   */
  it('loses nothing when it splits a list', () => {
    const all = Object.values(PERMISSIONS);
    const regrouped = groupPermissions(all).flatMap((entry) => entry.permissions);

    expect(regrouped.slice().sort()).toStrictEqual(all.slice().sort());
  });

  /** Empty domains are omitted, so a short list does not render blank headings. */
  it('omits domains with nothing in them', () => {
    const grouped = groupPermissions([PERMISSIONS.BOOKING_READ_OWN]);

    expect(grouped).toHaveLength(1);
    expect(grouped[0]?.group).toBe('bookings');
  });

  /** An unrecognised resource is offered under «أخرى» rather than disappearing. */
  it('keeps an unknown resource visible', () => {
    expect(permissionGroup('quantum_widget.read')).toBe('other');
    expect(groupPermissions(['quantum_widget.read'])[0]?.group).toBe('other');
  });
});
