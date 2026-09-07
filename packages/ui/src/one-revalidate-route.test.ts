import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The two revalidation routes are ONE file, and stay one.
 *
 * `apps/web` and `apps/admin` each expose `POST /api/revalidate-settings` so the API can tell them
 * a setting changed (Bashar, 2026-09-08). Two copies of a security check are two chances for one of
 * them to drift — and the drift that matters here is silent in the worst direction: an app whose
 * copy lost the constant-time comparison, or the fail-closed 404, still purges caches correctly and
 * says nothing about the guard it no longer has.
 *
 * Same reasoning as `violation-default-description.test.ts` for two catalogues describing one set
 * of events, and as `one-dialog.test.ts` for a rule nobody can see being broken.
 */
const ROUTES = [
  'apps/web/src/app/api/revalidate-settings/route.ts',
  'apps/admin/src/app/api/revalidate-settings/route.ts',
];

describe('the settings revalidation route', () => {
  it('is byte-identical in both apps', () => {
    const [web, admin] = ROUTES.map((path) => readFileSync(path, 'utf8'));

    expect(
      admin,
      'One copy has drifted. Change both together, or move it into a shared package.',
    ).toBe(web);
  });

  it.each(ROUTES)('%s fails closed and compares in constant time', (path) => {
    const source = readFileSync(path, 'utf8');

    /*
      Named checks rather than a snapshot. A snapshot fails on a reworded comment and teaches
      everybody to re-record it; these three fail only when a guarantee is gone.
    */
    expect(source, 'a wrong or missing secret must answer 404, never 401').toContain(
      'status: 404',
    );
    /*
      The comparison must USE it, not merely import it.

      This asserted `toContain('timingSafeEqual')` and was watched to PASS against both copies
      rewritten to `offered === expected` — the import line survives that mutation, so the string
      was still there while the guarantee was gone. A check that cannot tell the defect from the
      fix is the failure this repository has a rule about, and it was sitting in the test written
      to hold a security property.
    */
    expect(
      /return\s+timingSafeEqual\(/.test(source),
      'the comparison itself must be constant-time, not merely imported',
    ).toBe(true);
    expect(
      /\b(offered|a)\s*===\s*(expected|b)\b/.test(source),
      '`===` on a secret leaks its prefix to anybody who can time a few thousand requests',
    ).toBe(false);
    expect(
      source,
      'the route must purge the one tag it knows, never a tag from the request',
    ).toContain('OPERATING_SETTINGS_TAG');
    expect(
      /revalidateTag\(\s*OPERATING_SETTINGS_TAG\s*\)/.test(source),
      'the tag purged must be the shared constant, not a caller-supplied value',
    ).toBe(true);
    expect(
      /request\.(json|nextUrl|url)/.test(source),
      'the route must take nothing from the request but the secret header',
    ).toBe(false);
  });
});
