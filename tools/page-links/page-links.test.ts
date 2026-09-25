import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every internal link a person can press goes to a page that exists.
 *
 * ## The defect this holds shut
 *
 * الإعلانات told a partner «لا تظهر على الخريطة» and linked to `/properties/{reference}` to fix
 * it. **There is no such route** — the partner portal has `/properties/[reference]/edit`,
 * `/images` and `/calendar`, and nothing at the parent. Pressing the one control that existed to
 * close the gap produced «هذه الصفحة غير موجودة».
 *
 * It shipped twice, a day apart: once with the location warning and again when that warning grew
 * into four checks, because the second was written by generalising the first. Nothing could see
 * it. TypeScript does not know which paths Next serves; `pnpm verify` never renders a page; and
 * the browser suite clicked the card, not the link inside it.
 *
 * It is the house failure — **built, green, and connected to nothing** — and it is the same shape
 * `tools/client-routes` already holds shut for `/api/…` calls. This is that sweep for the links a
 * PERSON follows rather than the ones a script fetches.
 *
 * ## How it decides
 *
 * Every `href` literal beginning `/` in the three apps' sources is collected, its interpolated
 * segments are replaced by a wildcard, and a `page.tsx` or `route.ts` is looked for at the
 * matching path. The app comes from the FILE the link was written in, because `/properties` names
 * a different screen in each one.
 *
 * ## What it cannot see
 *
 * A destination built by a HELPER rather than written at the call site. `fixHref(gap, reference)`
 * is exactly that, and it is the helper the original defect lived in — so it carries its own test,
 * `apps/partner/src/lib/fix-href.test.ts`, which resolves every destination it can produce against
 * the real route tree. **Any new link-building helper needs the same**, and that is the honest
 * standing of this file: it holds the literals, not the functions.
 *
 * This was found the hard way. The first version matched `href=` only, and reinstating the dead
 * link left it GREEN — a sweep blind to the case it was written for, which reports coverage rather
 * than providing it. Broadening it to every path literal was then tried and swept up two hundred
 * API paths, so the split above is deliberate: precise here, and a test beside each helper.
 */
const REPO = join(import.meta.dirname, '..', '..');
const APPS = ['admin', 'partner', 'web'] as const;

/** A link: which app it lives in, where it points, and where to point a reader. */
interface PageLink {
  readonly app: string;
  readonly path: string;
  readonly file: string;
}

describe('every internal link has a page behind it', () => {
  const links = collect();

  it('finds the links it is meant to check', () => {
    /*
      The opposite control, and the reason the assertion below means anything. If the regex stopped
      matching — a changed attribute shape, a moved directory — the sweep would report perfect
      health over an empty list.
    */
    expect(links.length, 'the sweep read real source').toBeGreaterThan(20);
    expect(
      links.some((link) => link.path.includes('[…]')),
      'and found a link with an interpolated segment',
    ).toBe(true);
  });

  it('never links to a path that no page answers', () => {
    const missing = links
      .filter((link) => !pageExists(link))
      .map((link) => `${link.app}: ${link.path} (linked from ${link.file})`);

    expect(
      [...new Set(missing)].sort(),
      'These paths are linked from a screen and no page.tsx answers them. Next.js replies 404, ' +
        'the reader meets «هذه الصفحة غير موجودة», and no other test can see it. Add the page, ' +
        'or fix the link.',
    ).toStrictEqual([]);
  });
});

/** Every `href="/…"` literal in the three apps' sources, normalised. */
function collect(): PageLink[] {
  const files = execFileSync(
    'git',
    [
      /* Tracked AND untracked-but-not-ignored — see the note in `client-routes.test.ts`. */
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      ...APPS.map((app) => `apps/${app}/src/**/*.tsx`),
      ...APPS.map((app) => `apps/${app}/src/**/*.ts`),
    ],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((path) => path !== '' && !path.includes('.test.'));

  const found: PageLink[] = [];

  for (const file of files) {
    const source = withoutComments(readFileSync(join(REPO, file), 'utf8'));
    const app = file.split('/')[1] ?? '';

    /*
      The three ways a person is NAVIGATED: an `href`, a `router.push`, and a server `redirect`.

      Deliberately not «every path literal in the file». That was tried and it swept up 200+ API
      paths — `staffFetch('/admin/bookings')` is a backend route, not a screen — and the only way
      to tell them apart is a prefix list per app, which is the kind of heuristic that decays into
      an exemption list nobody maintains. Precise here, with the gap named below.
    */
    const patterns = [
      /href=(?:"([^"]*)"|\{`([^`]*)`\})/g,
      /router\.push\(\s*(?:'([^']*)'|`([^`]*)`)/g,
      /redirect\(\s*(?:'([^']*)'|`([^`]*)`)/g,
    ];

    for (const match of patterns.flatMap((pattern) => [...source.matchAll(pattern)])) {
      const raw = match[1] ?? match[2] ?? '';

      if (!raw.startsWith('/')) continue;

      /* `/api/…` is `client-routes.test.ts`'s job, and a fragment or query is not a route. */
      const path = raw.split('#')[0]?.split('?')[0] ?? '';

      if (path === '' || path.startsWith('/api/')) continue;
      /* A static file — `/map/…`, `/fonts/…` — is served from `public`, not by a route. */
      if (/\.[a-z0-9]+$/i.test(path)) continue;

      found.push({
        app,
        path: path.replace(/\$\{[^}]*\}/g, '[…]').replace(/\/+$/, '') || '/',
        file,
      });
    }
  }

  return found;
}

/**
 * Whether some page answers this path.
 *
 * An interpolated segment matches ANY dynamic segment at that position, because
 * `/properties/${'${reference}'}/edit` names a different URL on every card and they all resolve to the
 * same `[reference]` directory. The customer app's routes sit under `[locale]`, so a first segment
 * that is a locale is tried as that directory too.
 */
function pageExists(link: PageLink): boolean {
  const root = join(REPO, 'apps', link.app, 'src', 'app');
  const all = link.path.split('/').filter((one) => one !== '');

  /*
    An interpolation GLUED to a literal — `` `/${'${locale}'}/account${'${section.path}'}` `` — carries an
    unknown number of further segments, and `section.path` is `/bookings`. Everything after it is
    unknowable from the source, so the check stops there and asks only that the literal prefix is a
    real DIRECTORY. That still catches a typo in the part somebody wrote by hand, which is the part
    that gets typos, and it is the same concession `client-routes.test.ts` makes for the same
    reason: both flagged exactly two links of this shape before it was made, and a sweep that cries
    wolf gets switched off.
  */
  const glued = all.findIndex((one) => one.includes('[…]') && one !== '[…]');
  const segments = glued === -1 ? all : all.slice(0, glued);
  const literal = glued === -1 ? null : (all[glued]!.split('[…]')[0] ?? '');
  const mode: Mode = glued === -1 ? 'page' : 'directory';
  const tail = literal ? [...segments, literal] : segments;

  return (
    resolves(root, tail, mode) ||
    (link.app === 'web' && resolves(join(root, '[locale]'), tail.slice(1), mode))
  );
}

/** Whether the walk must end on a page, or merely on a directory that exists. */
type Mode = 'page' | 'directory';

/** Walks the app directory, letting a literal segment match itself, a group, or a dynamic one. */
function resolves(directory: string, segments: readonly string[], mode: Mode): boolean {
  if (!existsSync(directory)) return false;

  if (segments.length === 0) {
    return mode === 'directory'
      ? true
      : existsSync(join(directory, 'page.tsx')) ||
          existsSync(join(directory, 'route.ts'));
  }

  const [head, ...rest] = segments;
  const candidates = [head ?? '', `[${head ?? ''}]`];

  for (const candidate of candidates) {
    if (resolves(join(directory, candidate), rest, mode)) return true;
  }

  /*
    A DYNAMIC directory — `[reference]`, `[slug]`. Tried by reading the directory rather than by
    guessing its name, because the segment in the link is a value and the directory is a parameter
    name, and the two never match by string.
  */
  for (const entry of dynamicChildren(directory)) {
    if (resolves(join(directory, entry), rest, mode)) return true;
  }

  /* A route GROUP — `(dashboard)` — is not part of the URL, so it is stepped through. */
  for (const entry of groupChildren(directory)) {
    if (resolves(join(directory, entry), segments, mode)) return true;
  }

  return false;
}

function dynamicChildren(directory: string): string[] {
  return children(directory).filter((one) => one.startsWith('[') && one.endsWith(']'));
}

function groupChildren(directory: string): string[] {
  return children(directory).filter((one) => one.startsWith('(') && one.endsWith(')'));
}

function children(directory: string): string[] {
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Comments stripped before scanning.
 *
 * A doc comment naming a path is not a link, and `client-routes.test.ts` records what happens
 * without this: «under `/api/contracts` attach it server-side» was reported as a missing route,
 * and a sweep that cries wolf gets switched off.
 */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}
