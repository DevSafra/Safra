import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * No route a BROWSER navigates to may answer with a body.
 *
 * ## The defect this generalises
 *
 * Bashar, 2026-08-25: choosing 25 rows on a small table produced a bare document reading
 * «Unknown table or size.» — no shell, no sidebar, the back button the only way out. SEVEN routes
 * across the three apps had the same shape, and `route.test.ts` beside the pagination bar proves
 * that ONE of them is fixed. A test naming one route protects one route; the next `<form action>`
 * or `<a href>` pointed at a handler that answers `NextResponse.json` on its failure path brings
 * the JSON screen straight back, and no existing assertion would notice.
 *
 * So this asks the general question instead, the way `no-english-copy.test.ts` does for copy: it
 * finds every route handler the three apps' own markup NAVIGATES to, and fails if one of them can
 * produce a body at all.
 *
 * ## Why "navigates to" is decided by reading the markup
 *
 * A route reached by `fetch()` SHOULD answer JSON — the caller is JavaScript and the component
 * renders the message. A route named by `<form action="…">` or `href="…"` is a document load, and
 * whatever it returns is what the person sees. The difference is not visible in the handler, only
 * in the call site, so the call sites are what this reads. Both discriminators are needed: a route
 * with both kinds of caller keeps the strict rule, because the navigation is the one that can hurt.
 *
 * ## Watched to fail
 *
 * Against the routes as they stood at `d45a61c` this reported all seven by name, and a body put
 * back into any one of them reports that one. See the report.
 */
const APPS = ['admin', 'partner', 'web'] as const;

/** `apps/<app>/src`, from this file's own location. */
function appSource(app: string): string {
  return join(import.meta.dirname, '..', '..', '..', app, 'src');
}

function walk(dir: string, match: (name: string) => boolean): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) found.push(...walk(path, match));
    else if (match(entry.name)) found.push(path);
  }

  return found;
}

/**
 * The URL path a route handler serves, as its own markup would spell it.
 *
 * Dynamic segments become a `*` so `href={`/api/documents/${id}/file`}` matches
 * `app/api/documents/[documentId]/file/route.ts`. `[locale]` is dropped rather than starred: the
 * customer app's links write the locale as an interpolation, so keeping it would never match.
 */
function routePattern(app: string, file: string): string {
  return file
    .slice(appSource(app).length)
    .replace(/^[/\\]app/, '')
    .replace(/[/\\]route\.tsx?$/, '')
    .replace(/\[locale\][/\\]?/g, '')
    .replace(/\\/g, '/')
    .replace(/\[[^\]]+\]/g, '*')
    .replace(/\/{2,}/g, '/');
}

/** Every `<form action>` / `href` / `action={…}` string in an app's components and pages. */
function navigationTargets(app: string): string {
  const source = appSource(app);
  const files = walk(source, (name) => name.endsWith('.tsx'));

  return files
    .filter((file) => !file.includes('.test.'))
    .map((file) => readFileSync(file, 'utf8'))
    .join('\n');
}

/**
 * Whether the markup navigates to this route.
 *
 * The pattern is matched segment by segment against what an `href`/`action` writes, so a starred
 * segment accepts an interpolation (`${id}`, `${encodeURIComponent(x)}`) but not a slash — a `*`
 * that swallowed `/` would make `/api/contracts/*` match `/api/contracts/x/file/y` and mask a
 * route this test is supposed to see.
 */
function isNavigatedTo(pattern: string, markup: string): boolean {
  const escaped = pattern
    .split('/')
    .map((segment) =>
      segment === '*' ? '[^/`"\'\\s]+' : segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
    )
    .join('/');

  /*
    A trailing `/` is NOT a terminator, and that correction is worth stating.

    It was, and `/api/bookings/${x}/voucher` then matched the route `/api/bookings` — so adding the
    voucher link made booking CREATION look like a navigation, which it is not: it is a `fetch`
    from the checkout form and answers JSON correctly. A pattern must match the whole path, not a
    prefix of a longer one; anything else reports a route as navigated-to because a different route
    beneath it is.
  */
  return new RegExp(`(?:href|action)=(?:"|\\{\`)[^"\`]*${escaped}(?:["\`?#]|$)`).test(
    markup,
  );
}

/** Anything that puts a body on the wire. A redirect carries none, which is the whole point. */
const BODY = /NextResponse\.json\(|Response\.json\(|new Response\(\s*['"`]/;

describe('routes a browser navigates to', () => {
  const offenders: string[] = [];

  for (const app of APPS) {
    const markup = navigationTargets(app);

    for (const file of walk(
      appSource(app),
      (name) => name === 'route.ts' || name === 'route.tsx',
    )) {
      const pattern = routePattern(app, file);

      if (!isNavigatedTo(pattern, markup)) continue;

      const source = readFileSync(file, 'utf8');

      if (BODY.test(source)) offenders.push(`${app}${pattern}`);
    }
  }

  it('never answer with a body, because the person sees whatever comes back', () => {
    expect(offenders).toStrictEqual([]);
  });

  /**
   * The opposite control, and this test is worthless without it.
   *
   * Every assertion above passes if `isNavigatedTo` matches nothing — a broken pattern builder, a
   * renamed directory, an `href` written some way this does not recognise, and the suite reports
   * coverage of zero routes as success. So: the routes that ARE known to be navigations must be
   * found — and the WHOLE list rather than a few `toContain`s, because a shrinking list is the real
   * failure mode: an `href` rewritten in a way the matcher no longer recognises drops a route out of
   * scope silently, and `toContain` on five of nine would not notice the other four leaving. A route
   * added here is a route somebody had to think about, which is a good reason to edit this line.
   */
  it('finds the navigations it is supposed to be checking', () => {
    const found = APPS.flatMap((app) => {
      const markup = navigationTargets(app);

      return walk(appSource(app), (name) => name === 'route.ts')
        .map((file) => routePattern(app, file))
        .filter((pattern) => isNavigatedTo(pattern, markup))
        .map((pattern) => `${app}${pattern}`);
    });

    expect(found).toStrictEqual([
      'admin/api/contracts/*/file/*',
      'admin/api/table-page-size',
      'admin/bookings/exports/download/*',
      'admin/bookings/exports/request',
      'partner/api/auth/logout',
      'partner/api/contracts/*/file',
      'web/account/invoices/*/pdf',
      /* §9.3's ad click — a plain `<a href>`, so what it answers is what a customer LOOKS at. */
      'web/api/ads/*/click',
      /* §6.5's voucher — an `<a href>`, so every failure path redirects rather than answering. */
      'web/api/bookings/*/voucher',
      'web/currency',
    ]);
  });
});
