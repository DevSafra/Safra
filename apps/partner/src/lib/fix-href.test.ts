import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LISTING_READINESS_CHECKS } from '@safra/contracts';

import { FIX_HREF, fixHref } from './fix-href.js';

/**
 * Every gap leads somewhere that exists.
 *
 * ## The defect this holds shut
 *
 * الإعلانات told a partner «لا تظهر على الخريطة» and linked to `/properties/{reference}` — a route
 * the portal does not have. The one control that existed to close the gap answered
 * «هذه الصفحة غير موجودة». It shipped twice, because the second version was written by
 * generalising the first, and nothing could see it: TypeScript does not know which paths Next
 * serves, and the browser suite clicked the card rather than the link inside it.
 *
 * ## Why here and not only in the source sweep
 *
 * `tools/page-links` reads `href=`, `router.push` and `redirect` LITERALS. These destinations are
 * built by a helper, so no literal ever reaches an attribute — the sweep was blind to exactly the
 * case it was written for until this file existed beside it. A link-building helper carries its
 * own test; that is the arrangement, and it is written down in the sweep too.
 *
 * ## It resolves against the real route tree
 *
 * Not against a list of paths copied into the test, which would agree with a deleted route for
 * ever. `apps/partner/src/app` is walked, so moving a screen fails this.
 */
const APP = join(import.meta.dirname, '..', 'app');

/** Whether Next serves this path, resolved against the directories that actually exist. */
function routeExists(path: string): boolean {
  const segments = path
    .split('#')[0]!
    .split('/')
    .filter((one) => one !== '');

  let directory = APP;

  for (const segment of segments) {
    const literal = join(directory, decodeURIComponent(segment));

    if (existsSync(literal)) {
      directory = literal;
      continue;
    }

    /*
      A dynamic directory — `[reference]`. Found by READING the directory rather than by guessing
      its parameter name, because the segment here is a value (`PRO-000123`) and the directory is
      a name, and the two never match by string.
    */
    const dynamic = dynamicChild(directory);

    if (!dynamic) return false;

    directory = join(directory, dynamic);
  }

  return existsSync(join(directory, 'page.tsx'));
}

function dynamicChild(directory: string): string | null {
  try {
    return (
      readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .find((name) => name.startsWith('[') && name.endsWith(']')) ?? null
    );
  } catch {
    return null;
  }
}

describe('where a gap sends a partner', () => {
  const reference = 'PRO-000123';

  it('has a destination for every check the contract defines', () => {
    /*
      Driven from the CONTRACT. A fifth check would otherwise ship with no destination and fall to
      the default, which is a real page but the wrong one — a silent downgrade rather than a
      failure, which is the shape that survives review.
    */
    for (const check of LISTING_READINESS_CHECKS) {
      expect(FIX_HREF[check], `${check} has no destination`).toBeDefined();
    }
  });

  it.each(LISTING_READINESS_CHECKS)('sends %s to a page that exists', (check) => {
    const href = fixHref(check, reference);

    expect(routeExists(href), `${check} → ${href}`).toBe(true);
  });

  it('sends an unknown check to a page that exists too', () => {
    const href = fixHref('something-new', reference);

    expect(routeExists(href), `fallback → ${href}`).toBe(true);
  });

  /**
   * The control, and the reason the assertions above mean anything.
   *
   * `routeExists` walking to `true` for everything would pass every case here while proving
   * nothing. This is the path the defect actually used, and it must resolve to FALSE.
   */
  it('would have failed against the link that shipped', () => {
    expect(routeExists(`/properties/${reference}`)).toBe(false);
  });

  it('escapes a reference that would otherwise change the path', () => {
    /* A reference is `BKG-2026-000123`-shaped, but a path segment is never trusted to be safe. */
    expect(fixHref('photograph', 'a/b')).not.toContain('a/b');
  });

  it('keeps the fragment that puts the reader on the right part of a long form', () => {
    expect(fixHref('unit', reference)).toContain('#units');
    expect(fixHref('location', reference)).toContain('#location');
    expect(fixHref('description', reference)).toContain('#description');
  });
});
