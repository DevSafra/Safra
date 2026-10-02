import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * No page in the three apps is `force-static`, because under a nonce policy a static page runs no
 * script at all (2026-10-02).
 *
 * The middleware gives every response a fresh nonce and Next stamps it onto the scripts it renders.
 * A page built once and served many times carries the nonce of the build, the header carries
 * today's, and the browser refuses every script: forty of them on `/ar/medical-tourism`, the same on
 * `/ar/city` and `/ar/contact`. The pages looked finished, answered 200 and passed every test,
 * while their menu, theme and language switch were dead. `force-static` also blanks `cookies()`, so
 * the theme a reader chose could not reach the server render either.
 *
 * Caching belongs on the DATA (a `fetch` with `revalidate` and a tag), never on the HTML.
 */
const ROOT = new URL('../../../../', import.meta.url).pathname;
const APPS = ['apps/web/src/app', 'apps/admin/src/app', 'apps/partner/src/app'];

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) out.push(...sources(relative));
    else if (/\.(tsx|ts)$/.test(entry) && !entry.includes('.test.')) out.push(relative);
  }
  return out;
}

describe('no page is built once and served with a stale nonce', () => {
  it('declares no route force-static', () => {
    const files = APPS.flatMap(sources);

    /* The sweep has to be able to fail: a corpus it never opened reports a clean bill of health. */
    expect(files.length).toBeGreaterThan(50);

    const offenders = files.filter((file) =>
      /export\s+const\s+dynamic\s*=\s*['"]force-static['"]/.test(
        readFileSync(join(ROOT, file), 'utf8'),
      ),
    );

    expect(
      offenders,
      'force-static serves a nonce from build time, and the browser then blocks every script. ' +
        'Cache the data with fetch revalidate and a tag instead.',
    ).toEqual([]);
  });
});
