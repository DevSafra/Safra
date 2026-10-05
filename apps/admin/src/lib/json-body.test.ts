import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { MALFORMED_BODY, jsonBody } from './json-body';

/*
  A malformed request body is the caller's fault, answered with a coded 400, never a 500
  (audit 2026-10-04). Thirty console routes passed `await request.json()` straight to the proxy.
*/
describe('jsonBody', () => {
  it('marks a body that is not JSON rather than throwing', async () => {
    const empty = new Request('http://x/', { method: 'POST' });
    const broken = new Request('http://x/', { method: 'POST', body: '{"a":' });

    await expect(jsonBody(empty)).resolves.toBe(MALFORMED_BODY);
    await expect(jsonBody(broken)).resolves.toBe(MALFORMED_BODY);
  });

  it('returns a JSON body as parsed', async () => {
    const good = new Request('http://x/', { method: 'POST', body: '{"a":1}' });

    await expect(jsonBody(good)).resolves.toEqual({ a: 1 });
  });
});

/*
  The class, in all three apps: a route that reads its body must survive a malformed one, either
  through `jsonBody` or inside its own try/catch. A bare `await request.json()` throws a 500.
*/
const ROOT = new URL('../../../../', import.meta.url).pathname;
const APPS = ['apps/admin/src/app', 'apps/partner/src/app', 'apps/web/src/app'];

function routes(dir: string): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((entry) => {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) return routes(relative);
    return entry === 'route.ts' ? [relative] : [];
  });
}

describe('every route that reads a body', () => {
  it('survives a malformed one', () => {
    const offenders = APPS.flatMap(routes).filter((file) => {
      const text = readFileSync(join(ROOT, file), 'utf8');

      return [...text.matchAll(/await request\.json\(\)/g)].some((match) => {
        const after = text.slice(
          match.index + match[0].length,
          match.index + match[0].length + 12,
        );
        const before = text.slice(Math.max(0, match.index - 160), match.index);

        return !/^\s*\.catch\(/.test(after) && !/try\s*\{/.test(before);
      });
    });

    expect(
      offenders,
      'A bare `await request.json()` answers a malformed body with a 500. Use `jsonBody` (console) ' +
        'or read it inside try/catch and answer request.malformed_body.',
    ).toEqual([]);
  });

  it('actually reads the three apps', () => {
    const files = APPS.flatMap(routes);

    expect(files.length).toBeGreaterThan(50);
    expect(files.some((file) => file.startsWith('apps/partner/'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/web/'))).toBe(true);
  });
});
