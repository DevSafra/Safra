import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every `/api/…` a browser calls has a route handler behind it.
 *
 * ## The defect this holds shut
 *
 * The console's «شارِك مع الشريك» control was written, the API endpoint was written, the service
 * was tested three ways and mutation-tested — and pressing the button produced «حدث خطأ ما»,
 * because nothing had created
 * `apps/admin/src/app/api/disputes/evidence/[evidenceId]/share/route.ts`. Next.js answers 404 for
 * a path with no handler, the component reports its generic failure, and every unit and
 * integration test in the repository stays green. Found by driving the screen in a browser on
 * 2026-09-08; found in three seconds by this, from then on.
 *
 * It is the house pattern: **built, green, and connected to nothing.** These apps do not have a
 * catch-all proxy — each write is its own handler on purpose, so that what the browser may ask the
 * API for is a written list — which means a forgotten file is invisible to the type checker.
 *
 * ## How it decides
 *
 * Every `fetch('/api/…')` literal in the three apps' `src` trees is collected, its dynamic
 * segments are replaced by `[…]`, and a `route.ts` is looked for at the matching path. The app is
 * taken from the FILE the call was written in, because `/api/x` means a different route in each
 * app.
 *
 * ## What it cannot see
 *
 * A path assembled by concatenation (`fetch(base + path)`), and a handler that exists but exports
 * the wrong method. And where a segment is INTERPOLATED it can only check that some handler exists
 * under the parent, because `/api/bookings/${'${reference}'}/${'${action}'}` names a different route on every
 * press. Both are worse problems than the one this prevents; this is a floor, not a ceiling — the
 * same standing this codebase's other source sweeps have.
 */
const REPO = join(import.meta.dirname, '..', '..');
const APPS = ['admin', 'partner', 'web'] as const;

/** A call site: which app it lives in, which path it asks for, and where to point a reader. */
interface Call {
  readonly app: string;
  readonly path: string;
  readonly file: string;
}

describe('every browser call has a route handler', () => {
  const calls = collect();

  it('finds the calls it is meant to check', () => {
    /*
      The opposite control, and the reason the assertion below means anything.

      If the regex stopped matching — a changed call shape, a moved directory, a bad `git ls-files`
      — the sweep would report perfect health over an empty list. So it must find a real number of
      calls AND find one by name: the dispute-evidence removal has been proxied since 2026-08-30
      and is exactly the shape this exists to check.
    */
    expect(calls.length, 'the sweep read real source').toBeGreaterThan(20);
    expect(
      calls.some((call) => call.path === '/api/disputes/evidence/[…]'),
      'and found a known dynamic call',
    ).toBe(true);
  });

  it('never calls a path that no route.ts answers', () => {
    const missing = calls
      .filter((call) => !handlerExists(call))
      .map((call) => `${call.path} (called from ${call.file})`);

    expect(
      [...new Set(missing)].sort(),
      'These paths are fetched by a browser and no route handler answers them. Next.js replies ' +
        '404, the component shows its generic failure, and no other test can see it. Add the ' +
        'route.ts, or fix the path.',
    ).toStrictEqual([]);
  });
});

/** Every `/api/…` literal fetched from the three apps' sources, normalised. */
function collect(): Call[] {
  const files = execFileSync(
    'git',
    [
      /*
        Tracked AND untracked-but-not-ignored, which is the difference between this sweep working
        and not working on the change that introduces a screen.

        A plain `ls-files` lists only what git already knows about, so a brand-new component and
        its brand-new route handler are BOTH invisible and the sweep reports health over the one
        case it exists for. `--others --exclude-standard` adds new files without pulling in
        `node_modules` or a build output.
      */
      'ls-files',
      '--cached',
      '--others',
      '--exclude-standard',
      ...APPS.map((app) => `apps/${app}/src/**/*.ts`),
      ...APPS.map((app) => `apps/${app}/src/**/*.tsx`),
    ],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((path) => path !== '' && !path.includes('.test.'));

  const found: Call[] = [];

  for (const file of files) {
    /*
      A route handler's own `fetch` goes to the API, not to itself. Matched on the FILENAME rather
      than on `/app/api/` in the path: the customer app has handlers under `app/[locale]/api/`, and
      the first version of this missed them and reported the API's own `/api/v1/…` as unanswered.
    */
    if (/\/route\.tsx?$/.test(file)) continue;

    /*
      Comments stripped first. A doc comment mentioning a path in backticks is not a call, and one
      of them — «under `/api/contracts` attach it server-side» — was reported as a missing route by
      the first version of this sweep. A sweep that cries wolf gets switched off.
    */
    const source = withoutComments(readFileSync(join(REPO, file), 'utf8'));
    const app = file.split('/')[1] ?? '';

    /*
      A template literal or a plain string starting `/api/`, up to the closing quote. Only the
      literal head matters: `${…}` is a dynamic segment and is normalised below.
    */
    for (const match of source.matchAll(/['"`](\/api\/[^'"`]*)['"`]/g)) {
      const raw = match[1];

      if (raw === undefined) continue;

      found.push({ app, path: normalise(raw), file });
    }
  }

  return found;
}

/**
 * `/api/disputes/${encodeURIComponent(id)}/evidence` → `/api/disputes/[…]/evidence`.
 *
 * Query strings and trailing slashes go too: neither reaches the filesystem.
 */
function normalise(path: string): string {
  return (
    (path.split('?')[0] ?? '')
      .replace(/\/+$/, '')
      .split('/')
      /*
      A segment holding an interpolation ANYWHERE is dynamic in whole — `verification${'${suffix}'}`
      is not a directory called «verification[…]», it is a name this sweep cannot know.
    */
      .map((segment) => (segment.includes('${') ? '[…]' : segment))
      .join('/')
  );
}

/** Line and block comments removed, so a path mentioned in prose is not read as a call. */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/^\s*\/\/.*$/gm, ' ');
}

/** Is there a `route.ts` for this path, with a dynamic directory wherever the path is dynamic? */
function handlerExists(call: Call): boolean {
  const segments = call.path
    .replace(/^\/api\//, '')
    .split('/')
    .filter(Boolean);
  const base = join(REPO, 'apps', call.app, 'src', 'app', 'api');

  return walk(base, segments);
}

/**
 * Walks the route tree, taking a literal directory where the segment is literal and ANY
 * `[param]` directory where it is dynamic.
 *
 * Recursive rather than a single `join`, because a dynamic segment can match several directory
 * names and only one of them may carry the handler.
 */
function walk(directory: string, segments: readonly string[]): boolean {
  if (segments.length === 0) return exists(join(directory, 'route.ts'));

  const [head, ...rest] = segments;

  if (head === undefined) return false;

  if (head === '[…]') {
    /*
      ANY child, not only a `[param]` one.

      `/api/bookings/${'${reference}'}/${'${action}'}` interpolates the action — «confirm», «reject» — so the
      second segment is a literal DIRECTORY behind a dynamic call. Requiring a bracketed name here
      reported four such calls as unanswered. What survives is still a real check: the parent has
      to exist and something under it has to be a handler.
    */
    for (const child of children(directory)) {
      if (walk(join(directory, child), rest)) return true;
    }

    return false;
  }

  /*
    A literal segment can also be served by a dynamic directory — `/api/settings/currency` is
    answered by `settings/[key]/route.ts`. Tried second, so a literal directory wins.
  */
  if (walk(join(directory, head), rest)) return true;

  for (const child of children(directory)) {
    if (child.startsWith('[') && walk(join(directory, child), rest)) return true;
  }

  return false;
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

function exists(path: string): boolean {
  try {
    statSync(path);

    return true;
  } catch {
    return false;
  }
}
