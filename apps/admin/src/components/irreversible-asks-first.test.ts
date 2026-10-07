import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The contract panel's two irreversible presses ask first (go-live audit, 2026-10-06).
 *
 * «إنشاء نسخة جديدة» supersedes the current contract, and «السماح للشريك برفع نسخة جديدة» takes a
 * signed contract out of force, voids the partner's signature and emails them. Both ran on one
 * click. There is no DOM test harness in this app, so this reads the source the way
 * `one-dialog.test.ts` does: every request to either route must sit after an `ask()` that is
 * `tone: 'danger'`, and no click handler may reach the route around it.
 */
const source = readFileSync(
  fileURLToPath(new URL('./partner-contract-panel.tsx', import.meta.url)),
  'utf8',
);

/** The body of `async function <name>(…) { … }`, up to the next top-level function. */
function body(name: string): string {
  const start = source.indexOf(`async function ${name}(`);

  expect(start, `${name} is defined`).toBeGreaterThan(-1);

  const end = source.indexOf('\n  async function ', start + 1);

  return source.slice(start, end === -1 ? undefined : end);
}

describe('the contract panel', () => {
  it.each([
    ['generate', "post('/api/contracts/generate'"],
    ['reopen', 'post(`/api/contracts/${contractId}/reopen`'],
  ])('asks a danger-toned question before %s posts', (name, request) => {
    const text = body(name);
    const asked = text.indexOf('await ask(');

    expect(asked, `${name} asks`).toBeGreaterThan(-1);
    expect(text.slice(asked, text.indexOf(request))).toContain("tone: 'danger'");
    expect(text.indexOf(request), `${name} posts after asking`).toBeGreaterThan(asked);
  });

  it('reaches neither route from a click handler directly', () => {
    const clicks = [...source.matchAll(/onClick=\{[^}]*\}/g)].map((match) => match[0]);

    for (const handler of clicks) {
      expect(handler).not.toMatch(/contracts\/generate|\/reopen/);
    }
  });

  it('renders the dialog it asks with', () => {
    expect(source).toMatch(/\{dialog\}/);
  });
});
