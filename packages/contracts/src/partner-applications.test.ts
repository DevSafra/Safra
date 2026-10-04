import { describe, expect, it } from 'vitest';

import {
  PARTNER_APPLICATIONS_OPEN_SETTING,
  partnerApplicationsOpen,
} from './partner-applications.js';

describe('partnerApplicationsOpen', () => {
  it('is closed only when the setting says so, in either form a row can arrive', () => {
    expect(partnerApplicationsOpen({ [PARTNER_APPLICATIONS_OPEN_SETTING]: false })).toBe(
      false,
    );
    expect(
      partnerApplicationsOpen({ [PARTNER_APPLICATIONS_OPEN_SETTING]: 'false' }),
    ).toBe(false);
  });

  it('is open when the setting says so', () => {
    expect(partnerApplicationsOpen({ [PARTNER_APPLICATIONS_OPEN_SETTING]: true })).toBe(
      true,
    );
    expect(partnerApplicationsOpen({ [PARTNER_APPLICATIONS_OPEN_SETTING]: 'true' })).toBe(
      true,
    );
  });

  /* The behaviour before the setting existed, and the API's own fallback. */
  it('stays open when the row is missing or the settings read failed', () => {
    expect(partnerApplicationsOpen({})).toBe(true);
  });
});
