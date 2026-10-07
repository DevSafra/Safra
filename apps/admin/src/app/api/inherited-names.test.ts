import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A URL segment checked against an allow-list must not match a name the list INHERITS.
 *
 * ## The defect
 *
 * Seven route handlers here checked a segment with `key in MAP` or a bare `MAP[key]` (go-live audit,
 * 2026-10-06). `constructor`, `toString` and `hasOwnProperty` are on every object literal's
 * prototype, so `/api/catalogue/constructor` passed the check and then called `Object.safeParse`,
 * which does not exist — a 500 for a URL that is not a route. On الطلبات, `ACTIONS.constructor`
 * is truthy and was interpolated into the upstream path as the function's source text.
 *
 * Each handler is driven with each name and must answer 404 without reaching the API. The sweep
 * at the end holds the CLASS: no `in` test anywhere under `app/api`, in either app, because the
 * next handler to write one would be the eighth.
 */
const proxy = vi.fn(() => Promise.resolve(new Response(null, { status: 200 })));

vi.mock('@/lib/proxy', () => ({ proxy }));

const INHERITED = ['constructor', 'toString', 'hasOwnProperty', '__proto__'] as const;

const UUID = '0190a0b0-0000-7000-8000-000000000001';

function post(): Request {
  return new Request('http://console.test/api/x', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
}

function params<T>(value: T): { params: Promise<T> } {
  return { params: Promise.resolve(value) };
}

type Handler = (name: string) => Promise<Response>;

const catalogue = await import('./catalogue/[entity]/route.js');
const catalogueEntry = await import('./catalogue/[entity]/[code]/route.js');
const faq = await import('./faq/[entity]/route.js');
const faqEntry = await import('./faq/[entity]/[id]/route.js');
const applications = await import('./partner-applications/[reference]/[action]/route.js');
const safraPayouts = await import('./safra-payouts/[id]/[action]/route.js');
const safraAccounts = await import('./safra-payouts/accounts/[id]/[action]/route.js');

const HANDLERS: Readonly<Record<string, Handler>> = {
  'POST catalogue/[entity]': (name) => catalogue.POST(post(), params({ entity: name })),
  'PATCH catalogue/[entity]/[code]': (name) =>
    catalogueEntry.PATCH(post(), params({ entity: name, code: 'wifi' })),
  'DELETE catalogue/[entity]/[code]': (name) =>
    catalogueEntry.DELETE(post(), params({ entity: name, code: 'wifi' })),
  'POST faq/[entity]': (name) => faq.POST(post(), params({ entity: name })),
  'PATCH faq/[entity]/[id]': (name) =>
    faqEntry.PATCH(post(), params({ entity: name, id: UUID })),
  'DELETE faq/[entity]/[id]': (name) =>
    faqEntry.DELETE(post(), params({ entity: name, id: UUID })),
  'POST partner-applications/[reference]/[action]': (name) =>
    applications.POST(post(), params({ reference: 'PRQ-000001', action: name })),
  'POST safra-payouts/[id]/[action]': (name) =>
    safraPayouts.POST(post(), params({ id: UUID, action: name })),
  'POST safra-payouts/accounts/[id]/[action]': (name) =>
    safraAccounts.POST(post(), params({ id: UUID, action: name })),
};

describe('allow-listed route segments', () => {
  beforeEach(() => {
    proxy.mockClear();
  });

  for (const [route, handler] of Object.entries(HANDLERS)) {
    it.each(INHERITED)(
      `${route} answers 404 to %s and never reaches the API`,
      async (name) => {
        const response = await handler(name);

        expect(response.status).toBe(404);
        expect(proxy).not.toHaveBeenCalled();
      },
    );
  }

  /* The opposite control: the same handlers DO forward a name the list really has. */
  it('still forwards an entity that is on the list', async () => {
    await catalogueEntry.DELETE(post(), params({ entity: 'amenities', code: 'wifi' }));

    expect(proxy).toHaveBeenCalledTimes(1);
  });
});

describe('route handlers in both apps', () => {
  const APPS = join(import.meta.dirname, '..', '..', '..', '..');

  function handlers(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);

      if (entry.isDirectory()) return handlers(path);

      return entry.name === 'route.ts' ? [path] : [];
    });
  }

  it('never test a variable with `in`, which inherited names pass', () => {
    const files = [
      ...handlers(join(APPS, 'admin', 'src', 'app', 'api')),
      ...handlers(join(APPS, 'partner', 'src', 'app', 'api')),
    ];

    expect(files.length).toBeGreaterThan(20);

    const offenders = files.filter((file) =>
      /*
        A VARIABLE on the left: `(action in ACTIONS)`. A quoted literal tested against a parsed
        body — `('status' in body)` — names a key nobody inherits, and is left alone.
      */
      /\(\s*[a-z_]\w*\s+in\s+[A-Za-z_][\w.]*\s*\)/.test(readFileSync(file, 'utf8')),
    );

    expect(
      offenders.map((file) => relative(APPS, file)),
      'use Object.hasOwn',
    ).toEqual([]);
  });
});
