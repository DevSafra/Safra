import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every `NEXT_PUBLIC_*` the apps read is declared to Turborepo.
 *
 * ## The failure this exists to stop, which has happened twice
 *
 * Next INLINES `process.env.NEXT_PUBLIC_*` into the client bundle at BUILD time, and Turborepo
 * runs tasks with a FILTERED environment — only what `globalEnv` and `tasks.*.env` declare reaches
 * the build. An undeclared variable is therefore not "missing in production"; it is `undefined`
 * baked into a chunk, on a machine where the shell that started the build had it set.
 *
 * Nothing fails. The build succeeds, the tests pass, and:
 *
 * - **the map disappeared** (2026-09-28) — `PropertyMap` ends `if (!BASEMAP) return null`, so a
 *   property page shipped with the address card and no map, exactly as it would on a deployment
 *   with no basemap configured. Two builds went out that way before anyone noticed;
 * - **the sitemap would publish `http://localhost:3000`** — `sitemap.ts` falls back to it, and
 *   §5.4 makes city pages an explicit SEO target, so a turbo build hands Google localhost
 *   canonicals for the pages the business is trying to rank;
 * - **the console's CSP is built from these too** (`admin/middleware.ts`), so a stripped media URL
 *   produces a policy that blocks the images it was supposed to allow.
 *
 * ## Why a sweep rather than three names
 *
 * Declaring the three that are read today fixes today. The next `NEXT_PUBLIC_` variable somebody
 * adds is the next silent build, and it will present as something unrelated — a blank section, a
 * wrong link, an asset that 404s — a long way from the line that added it. This reads the SOURCE,
 * so a variable is covered the day it is first read rather than the day somebody remembers.
 *
 * Reading `git grep` rather than walking the tree keeps it to tracked files: a stray `.next`
 * artefact or a node_modules copy is not source and must not fail the suite.
 */
const ROOT = join(import.meta.dirname, '..', '..');

/** Every `NEXT_PUBLIC_*` name read anywhere in tracked application or package source. */
function readInSource(): string[] {
  const out = execFileSync(
    'git',
    /*
      Doubled globs, not single ones: a git pathspec glob does not cross a directory separator,
      so the single-star form matches the src DIRECTORY and nothing beneath it. The sweep found
      zero names and would have passed for ever, and the control below is what caught it.
    */
    [
      'grep',
      '-hoE',
      'NEXT_PUBLIC_[A-Z0-9_]+',
      '--',
      'apps/**/src/**',
      'packages/**/src/**',
    ],
    { cwd: ROOT, encoding: 'utf8' },
  );

  return [...new Set(out.split('\n').filter(Boolean))].sort();
}

function declaredToTurbo(): string[] {
  const config = JSON.parse(readFileSync(join(ROOT, 'turbo.json'), 'utf8')) as {
    globalEnv?: string[];
    tasks?: Record<string, { env?: string[] }>;
  };

  return [
    ...new Set([
      ...(config.globalEnv ?? []),
      ...Object.values(config.tasks ?? {}).flatMap((task) => task.env ?? []),
    ]),
  ];
}

describe('the build environment', () => {
  it('declares every NEXT_PUBLIC_ variable the source reads', () => {
    const declared = new Set(declaredToTurbo());
    const undeclared = readInSource().filter((name) => !declared.has(name));

    expect(
      undeclared,
      'Next inlines these at BUILD time and Turborepo filters the task environment, so an ' +
        'undeclared one is baked in as `undefined` and nothing fails. Add each to `globalEnv` ' +
        'in turbo.json.',
    ).toEqual([]);
  });

  /*
    The control. Without it, the assertion above would pass just as happily if `readInSource`
    returned nothing at all — which is precisely what a mistyped path or a `git grep` that found
    no matches would produce, and it would report coverage it does not have.
  */
  it('actually finds the variables it is checking', () => {
    const found = readInSource();

    expect(found.length).toBeGreaterThan(0);
    expect(found).toContain('NEXT_PUBLIC_MEDIA_URL');
  });
});
