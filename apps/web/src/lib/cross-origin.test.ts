import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { refuseCrossOrigin } from './cross-origin';

/**
 * Login CSRF and its relatives: a state-changing route handler on the customer site must refuse a
 * POST another site's page made.
 *
 * The session is a cookie, and a browser attaches it to a cross-site form post as readily as to our
 * own. Without an `Origin` check, a page anywhere could sign a visitor into the ATTACKER's account
 * (so what they then book or save lands there), or act on the visitor's own session.
 */
function request(headers: Record<string, string>): Request {
  return new Request('http://0.0.0.0:3000/ar/api/auth/login', {
    method: 'POST',
    headers,
  });
}

describe('refuseCrossOrigin', () => {
  it('lets a same-origin browser request through', () => {
    expect(
      refuseCrossOrigin(
        request({ origin: 'https://safra.example', host: 'safra.example' }),
      ),
    ).toBeNull();
  });

  /* The bound address is not the host the browser used — see `isSameOrigin`. */
  it('compares against the Host header, not the address the server is bound to', () => {
    expect(
      refuseCrossOrigin(
        request({ origin: 'http://localhost:3000', host: 'localhost:3000' }),
      ),
    ).toBeNull();
  });

  it('refuses another origin with a coded 403', async () => {
    const refusal = refuseCrossOrigin(
      request({ origin: 'https://evil.example', host: 'safra.example' }),
    );

    expect(refusal?.status).toBe(403);
    expect(await refusal?.json()).toEqual({ code: 'request.cross_origin' });
  });

  it('refuses the same host on another port', () => {
    expect(
      refuseCrossOrigin(
        request({ origin: 'http://localhost:4000', host: 'localhost:3000' }),
      )?.status,
    ).toBe(403);
  });

  it('refuses an opaque origin, which is what a sandboxed frame sends', () => {
    expect(
      refuseCrossOrigin(request({ origin: 'null', host: 'safra.example' }))?.status,
    ).toBe(403);
  });
});

/**
 * Every state-changing route handler under `app/[locale]/api` calls the guard.
 *
 * A sweep rather than a list, so a route added tomorrow is covered by this file today. It reads
 * source, so it is a floor: it proves the call is there, and the route tests prove it works.
 */
describe('every state-changing customer route handler', () => {
  const root = fileURLToPath(new URL('../app/[locale]/api/', import.meta.url));

  function routes(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);

      if (statSync(path).isDirectory()) return routes(path);

      return name === 'route.ts' ? [path] : [];
    });
  }

  const mutating = routes(root).filter((path) =>
    /export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/.test(
      readFileSync(path, 'utf8'),
    ),
  );

  it('finds the handlers it is meant to sweep', () => {
    expect(mutating.length).toBeGreaterThan(10);
  });

  it.each(mutating.map((path) => [relative(root, path), path]))(
    '%s refuses a cross-origin request',
    (_name, path) => {
      const source = readFileSync(path, 'utf8');
      const handlers =
        source.match(/export\s+(async\s+)?function\s+(POST|PUT|PATCH|DELETE)\b/g) ?? [];
      const guarded = source.match(/refuseCrossOrigin\(/g) ?? [];

      expect(
        guarded.length,
        'one guard per state-changing handler',
      ).toBeGreaterThanOrEqual(handlers.length);
    },
  );
});
