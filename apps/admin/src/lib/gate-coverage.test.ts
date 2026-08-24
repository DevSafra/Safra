import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every page in مركز القيادة either gates on the reader's role or is on this list with a reason.
 *
 * ## Why a test that reads the directory
 *
 * `sectionAccess()` is one line at the top of a page, and a page that forgets it does not break:
 * it renders, it looks right, and it shows a section to somebody whose role does not carry it.
 * There is no failing request, no console error and no visual difference — the only way to find it
 * is to know it should be there, which is exactly the shape of thing a person stops checking.
 *
 * The console proved that on 2026-08-24: nineteen pages were built and the helper that gates them
 * was never consumed by any of them. A narrow role still saw all twenty nav links, and the gap was
 * only found because somebody went looking. Nineteen hand-written guards are twenty pages within a
 * month, and the twentieth is the one nobody remembers.
 *
 * ## Why the sidebar is not enough, and why this is not the boundary either
 *
 * Hiding a nav item stops somebody FINDING a section; it does nothing about a bookmark, a pasted
 * link or a typed URL. And neither the nav nor this test is the security boundary — that is
 * `@RequirePermissions` on the API, checked per request against a verified token. What a missing
 * guard costs is a reader meeting «انتهت الجلسة» on a perfectly good session, which sends them to
 * sign in again over a permission that signing in cannot change.
 *
 * ## Its twin
 *
 * `apps/partner/src/lib/gate-coverage.test.ts` does the same for لوحة الشريك, against
 * `requireVerifiedPartner`. Same reasoning, different gate; deliberately the same shape so a reader
 * of one recognises the other.
 */
const APP = join(import.meta.dirname, '..', 'app');

/**
 * Pages that must NOT gate, each for a stated reason.
 *
 * A path here is a decision, not an oversight — which is the entire point of writing the reason
 * beside it. Anything not listed and not gating fails below.
 *
 * `error.tsx`, `not-found.tsx`, `layout.tsx` and everything under `app/api/` are absent because the
 * walker looks for `page.tsx` only: a route handler and an error boundary are not pages, and a BFF
 * route is guarded by the API it forwards to. Listing them would imply this test had considered and
 * excused them, which would be a claim it does not make.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  'login/page.tsx':
    'There is no session yet, so there are no capabilities to read. The gate would refuse ' +
    'everybody, including the person about to sign in.',
  'invitation/[token]/page.tsx':
    'Redeems the invitation that CREATES the staff account. Gating it would require the ' +
    'account it exists to make.',
  'enrol-2fa/page.tsx':
    'Enrolment is the one thing an un-enrolled staff member may reach — the middleware sends ' +
    'them here and nowhere else. Gating it on a section would trap them on a screen they ' +
    'cannot leave.',
};

/** Every `page.tsx` under `app/`, as a path relative to it. */
function pages(dir: string, prefix = ''): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) return pages(join(dir, entry.name), rel);

    return entry.name === 'page.tsx' ? [rel] : [];
  });
}

describe('the console section gate', () => {
  const found = pages(APP).sort();

  /**
   * A guard on the guard.
   *
   * If the walker breaks — a renamed directory, a changed convention — it returns an empty list and
   * every assertion below passes while checking nothing. Naming three pages that must exist makes
   * that failure loud rather than silent.
   */
  it('finds the console pages', () => {
    expect(found.length).toBeGreaterThanOrEqual(30);
    expect(found).toContain('bookings/page.tsx');
    expect(found).toContain('staff/page.tsx');
    expect(found).toContain('settings/page.tsx');
  });

  /**
   * A page satisfies the gate by calling `sectionAccess` itself OR by calling `refuseSection`, the
   * helper that wraps it.
   *
   * The helper is why the 33 guards read as two lines each rather than 33 copies of a shell, a panel
   * and a two-branch conditional — and 33 copies is how one of them ends up saying «انتهت الجلسة» a
   * month from now, which is the failure this whole test exists to prevent. Detecting only the raw
   * call would push every page back to the copied form to satisfy a test that wanted the opposite.
   *
   * ## What this CANNOT see
   *
   * Ordering. The guard must run BEFORE the page's own fetches — `staffFetch` maps 403 to
   * 'unauthenticated', so a guard placed after the `Promise.all` never runs at all and the page has
   * already rendered «انتهت الجلسة». A substring search cannot tell where in the function the call
   * sits. That half is held by the browser spec, not by this file, and this comment is here so nobody
   * reads a green run as proof of it.
   */
  function gated(source: string): boolean {
    return source.includes('sectionAccess') || source.includes('refuseSection');
  }

  it('is called by every page that is not exempt', () => {
    const missing = found.filter((rel) => {
      if (rel in EXEMPT) return false;

      return !gated(readFileSync(join(APP, rel), 'utf8'));
    });

    expect(
      missing,
      'These pages show a console section to a staff member whose role does not carry it — and ' +
        'reached by a typed URL they answer «انتهت الجلسة», which sends somebody to sign in ' +
        'again over a permission. Call `sectionAccess()` before the fetch, or add the page to ' +
        'EXEMPT in this file WITH the reason it may not gate.',
    ).toEqual([]);
  });

  /**
   * A DETAIL page gates too, and it is the one most likely to be forgotten.
   *
   * `/bookings` is what somebody clicks; `/bookings/BKG-000042` is what they bookmark, paste into a
   * message, or reach from an email. A registry that gates while its detail screen does not is a
   * gate with a door beside it, and the detail screen is where the individual record lives.
   */
  it('is called by every detail page under a section', () => {
    const details = found.filter((rel) => rel.includes('[') && !(rel in EXEMPT));

    expect(
      details.length,
      'no detail pages found — has the convention changed?',
    ).toBeGreaterThan(3);

    const ungated = details.filter((rel) => !gated(readFileSync(join(APP, rel), 'utf8')));

    expect(ungated).toEqual([]);
  });

  /**
   * An exemption must not cover a page that gates anyway.
   *
   * `page.tsx` was on the list while the landing decision was still being built, on the reasoning
   * that the dashboard REDIRECTS rather than refusing. It does redirect — but it reaches that
   * decision by calling `sectionAccess` first, so the exemption had stopped describing a page that
   * cannot gate and started hiding one that does. Strip the guard from `/` and the test would have
   * stayed green, which is the one thing this file exists to prevent.
   *
   * An exemption is a claim that a page CANNOT gate. This checks the claim is still true rather
   * than still convenient.
   */
  it('does not exempt a page that gates anyway', () => {
    const redundant = Object.keys(EXEMPT).filter((rel) =>
      readFileSync(join(APP, rel), 'utf8').includes('sectionAccess'),
    );

    expect(
      redundant,
      'These pages are exempt AND call `sectionAccess`, so the exemption hides them: removing ' +
        'their guard would not fail this suite. Drop them from EXEMPT.',
    ).toEqual([]);
  });

  /** An exemption for a page that no longer exists is a reason nobody will re-examine. */
  it('has no exemption for a page that was deleted', () => {
    expect(Object.keys(EXEMPT).filter((rel) => !found.includes(rel))).toEqual([]);
  });

  /**
   * Every exemption carries a REASON, not just a path.
   *
   * A path with an empty string beside it is a list of pages somebody decided to skip, which is the
   * thing this file exists to prevent being possible silently.
   */
  it('gives every exemption a reason', () => {
    const unexplained = Object.entries(EXEMPT)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([rel]) => rel);

    expect(unexplained).toEqual([]);
  });
});
