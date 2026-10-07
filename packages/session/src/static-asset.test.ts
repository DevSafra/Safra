import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { MIDDLEWARE_MATCHER, isStaticAsset } from './static-asset.js';

/**
 * The middleware runs on every page, dot or no dot (go-live audit, 2026-10-06).
 *
 * All three apps excluded `.*\..*` from the matcher, so `/bookings/a.b` rendered with no session
 * check and no CSP. These hold both halves: no route shape escapes, and every file the apps really
 * ship still does, so the sign-in page keeps its logo.
 */
const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const APPS = ['admin', 'partner', 'web'] as const;

function files(directory: string): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);

    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

/** Next's reading of a matcher: anchored, the leading slash literal. */
const matcher = new RegExp(`^${MIDDLEWARE_MATCHER}$`);

describe('which requests skip the middleware', () => {
  it.each([
    '/bookings/a.b',
    '/bookings/BKG-2026-000431.json',
    '/partners/PAR-000002/violations.x',
    '/staff/../settings.png',
    '/ar/property/dar.al-yasmin',
    '/brand',
    '/brand/',
    '/brand/logo',
    '/map/../../bookings.js',
    '/icon.png/x',
  ])('runs on %s', (pathname) => {
    expect(isStaticAsset(pathname)).toBe(false);
    expect(matcher.test(pathname)).toBe(true);
  });

  it.each(APPS)('lets every file %s ships through', (app) => {
    const publicDir = join(ROOT, 'apps', app, 'public');
    const shipped = files(publicDir)
      .map((path) => `/${relative(publicDir, path).split('\\').join('/')}`)
      .filter((path) => !path.endsWith('/.gitkeep'));

    for (const path of shipped) expect(isStaticAsset(path), path).toBe(true);

    for (const name of readdirSync(join(ROOT, 'apps', app, 'src', 'app'))) {
      /*
        Any icon file, whatever its extension. The test once named `.png` alone, and when the icon
        became `icon.svg` (2026-10-07) the middleware redirected it to sign-in in all three apps
        while this stayed green, because it had the same blind spot as the list it checks.
      */
      if (/^(icon|apple-icon)\.[a-z0-9]+$|^favicon\.ico$/.test(name)) {
        expect(isStaticAsset(`/${name}`), name).toBe(true);
      }
    }
  });

  it('lets the metadata routes through', () => {
    expect(isStaticAsset('/robots.txt')).toBe(true);
    expect(isStaticAsset('/sitemap.xml')).toBe(true);
  });

  it.each([
    '/api/auth/login',
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/_vercel/x',
  ])('never runs on %s', (pathname) => {
    expect(matcher.test(pathname)).toBe(false);
  });

  it.each(APPS)('%s writes out the shared matcher, not the dotted one', (app) => {
    const source = readFileSync(join(ROOT, 'apps', app, 'src', 'middleware.ts'), 'utf8');

    expect(source).toContain(`matcher: ['${MIDDLEWARE_MATCHER}']`);
    expect(source).toContain('isStaticAsset(request.nextUrl.pathname)');
  });
});
