import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * GHSA-vfj7-8cjw-p6xm is ignored by the dependency audit, and this is why that stays true.
 *
 * ## The accepted risk
 *
 * `braces` (≤3.0.3) can be driven into stack exhaustion by a deeply nested brace pattern. No
 * patched version exists (the advisory lists `<0.0.0`), so the audit would block every commit with
 * nothing anyone can upgrade. Ignored by Bashar's decision on 2026-10-04, on these grounds: the only
 * path to it is `@next/eslint-plugin-next › fast-glob › micromatch › braces`, a DEV dependency of
 * the repository root, run by lint on patterns written in our own config. Nothing a visitor sends
 * reaches it, because nothing that ships contains it.
 *
 * ## Why a test, not a sentence
 *
 * An exemption's reason is written once and the dependency tree moves underneath it. The day a
 * shipped package starts depending on `braces` — a glob in a build step that runs in production, a
 * library that matches user input — the reason above becomes false while the ignore stays. So this
 * walks every package a workspace ships, from the lockfile, and fails if `braces` is among them.
 * It also fails if `braces` leaves the lockfile, because then the ignore is stale and comes out of
 * `package.json` the same day.
 */
const ADVISORY = 'GHSA-vfj7-8cjw-p6xm';
const ROOT = new URL('../../', import.meta.url).pathname;
const lockfile = readFileSync(join(ROOT, 'pnpm-lock.yaml'), 'utf8');

const unquote = (text: string) => text.trim().replace(/^'(.*)'$/, '$1');

/** The lockfile's two sections that matter, read by indentation: lockfile v9 is regular. */
function parse(text: string) {
  const roots: { name: string; version: string }[] = [];
  const graph = new Map<string, { name: string; version: string }[]>();

  let section = '';
  let key = '';
  let group = '';
  let dependency = '';

  for (const line of text.split('\n')) {
    if (/^\S/.test(line)) {
      section = line.replace(/:.*$/, '');
      continue;
    }
    const indent = line.search(/\S/);
    if (indent < 0) continue;
    const body = line.trim();

    if (indent === 2) {
      key = unquote(body.replace(/:( \{\})?$/, ''));
      if (section === 'snapshots') graph.set(key, []);
    } else if (indent === 4) {
      group = body.replace(/:$/, '');
    } else if (section === 'importers' && indent === 6) {
      dependency = unquote(body.replace(/:$/, ''));
    } else if (section === 'importers' && indent === 8 && body.startsWith('version:')) {
      const version = body.slice('version:'.length).trim();
      /* Shipped: what a workspace package needs at run time. A `link:` is another workspace package. */
      if (group !== 'devDependencies' && !version.startsWith('link:'))
        roots.push({ name: dependency, version });
    } else if (
      section === 'snapshots' &&
      indent === 6 &&
      group !== 'transitivePeerDependencies'
    ) {
      const at = body.indexOf(': ');
      graph.get(key)?.push({
        name: unquote(body.slice(0, at)),
        version: unquote(body.slice(at + 2)),
      });
    }
  }

  return { roots, graph };
}

describe(`the ignored advisory ${ADVISORY}`, () => {
  const { roots, graph } = parse(lockfile);

  it('is ignored in package.json, and only while braces is in the lockfile', () => {
    const manifest = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
      pnpm?: { auditConfig?: { ignoreGhsas?: string[] } };
    };
    expect(manifest.pnpm?.auditConfig?.ignoreGhsas).toContain(ADVISORY);
    expect(
      [...graph.keys()].some((key) => key.startsWith('braces@')),
      `braces is no longer installed: take ${ADVISORY} out of package.json`,
    ).toBe(true);
  });

  it('describes a package nothing that ships depends on', () => {
    const shipped = new Set<string>();
    const queue = roots.map(({ name, version }) => `${name}@${version}`);
    while (queue.length > 0) {
      const next = queue.pop()!;
      if (shipped.has(next)) continue;
      shipped.add(next);
      for (const { name, version } of graph.get(next) ?? [])
        queue.push(`${name}@${version}`);
    }

    /* A walk that read nothing would pass: the shipped set is hundreds of packages. */
    expect(
      roots.length,
      'the walk found the workspaces’ shipped dependencies',
    ).toBeGreaterThan(20);
    expect(shipped.size, 'the walk followed the snapshot graph').toBeGreaterThan(200);
    expect(
      [...shipped].filter((key) => key.startsWith('braces@')),
      `braces is reachable from a shipped package, so the reason for ignoring ${ADVISORY} is false`,
    ).toEqual([]);
  });
});
