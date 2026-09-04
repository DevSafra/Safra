import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every page in لوحة الشريك either gates on verification or is on this list with a reason.
 *
 * ## Why a test that reads the directory
 *
 * `requireVerifiedPartner()` is one line at the top of a page, and a page that forgets it does not
 * break: it renders, it looks right, and it shows the portal to somebody SAFRA has not verified.
 * There is no failing request, no console error and no visual difference — the only way to find it
 * is to know it should be there. That is precisely the shape of thing a person stops checking.
 *
 * Adding a page to `app/` is how this project grows, so the check has to be about the DIRECTORY
 * rather than about the pages that existed when the gate was written. The same reasoning the
 * geography screens' `geo-bounds` test records: an exemption is worth having only if something
 * holds it to account.
 */
const APP = join(import.meta.dirname, '..', 'app');

/**
 * Pages that must NOT gate, each for a stated reason.
 *
 * A path here is a decision, not an oversight — which is the point of writing the reason next to
 * it. Anything not listed and not gating fails the test below.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  'login/page.tsx':
    'There is no session yet, so there is no partner whose verification could be read.',
  'invitation/[token]/page.tsx':
    'Redeems the invitation that CREATES the partner account. Gating it would require the ' +
    'account it exists to make.',
  'employee-invitation/[token]/page.tsx':
    'Redeems an employee invitation. The account is still a customer until this form is ' +
    'submitted, and the gate reads a PARTNER verification the reader does not have one of — ' +
    'the employer is the verified party, not them.',
  'enrol-2fa/page.tsx':
    'An authenticator is an upgrade any partner may set up, verified or not. Holding it back ' +
    'would make the account less protected while it waits.',
  'contracts/page.tsx':
    'The onboarding screen itself — the destination the gate redirects TO. Gating it would be ' +
    'a loop.',
  'support/page.tsx':
    'The rejected banner tells the partner to come here, so it must stay reachable. It locks ' +
    'the sidebar instead, via isLocked().',
  'support/[reference]/page.tsx': 'One thread of the above.',
  'payouts/accounts/page.tsx':
    'A permanent redirect and nothing else — حسابات التحويل moved into الإعدادات on 2026-09-04. ' +
    'It renders no partner data, so there is nothing for a gate to withhold; /settings, where it ' +
    'lands, calls requireVerifiedPartner() itself.',
};

/** Every `page.tsx` under `app/`, as a path relative to it. */
function pages(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) return pages(join(dir, entry.name), rel);

    return entry.name === 'page.tsx' ? [rel] : [];
  });
}

describe('the verification gate', () => {
  const found = pages(APP).sort();

  /* A guard on the guard: if the walker breaks, every assertion below passes vacuously. */
  it('finds the portal pages', () => {
    expect(found.length).toBeGreaterThanOrEqual(12);
    expect(found).toContain('page.tsx');
    expect(found).toContain('contracts/page.tsx');
  });

  it('is called by every page that is not exempt', () => {
    const missing = found.filter((rel) => {
      if (rel in EXEMPT) return false;

      return !readFileSync(join(APP, rel), 'utf8').includes('requireVerifiedPartner');
    });

    expect(
      missing,
      'These pages show لوحة الشريك to a partner SAFRA has not verified. Call ' +
        '`requireVerifiedPartner()` instead of `getMyProfile()`, or add the page to EXEMPT in ' +
        'this file WITH the reason it may not gate.',
    ).toEqual([]);
  });

  /** An exemption for a page that no longer exists is a reason nobody will re-examine. */
  it('has no exemption for a page that was deleted', () => {
    expect(Object.keys(EXEMPT).filter((rel) => !found.includes(rel))).toEqual([]);
  });

  /**
   * And an exempt page must not gate either — a `contracts/page.tsx` that redirected to itself
   * would be an infinite loop, and the reason it is listed says so.
   */
  it('does not gate the pages it exempts', () => {
    const contradictory = Object.keys(EXEMPT).filter((rel) =>
      readFileSync(join(APP, rel), 'utf8').includes('requireVerifiedPartner('),
    );

    expect(contradictory).toEqual([]);
  });
});
