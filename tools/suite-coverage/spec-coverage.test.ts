import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every browser spec is collected by exactly one Playwright project.
 *
 * ## The hole this closes
 *
 * `playwright.config.ts` splits the suite in two: `chromium` runs everything, and `signed-in` runs
 * the specs that need a partner session. The split is expressed by ONE list used in OPPOSITE senses
 * — `testIgnore` on the first, `testMatch` on the second.
 *
 * Until 2026-09-07 that list was written out TWICE, and the two ways of getting it wrong are not
 * symmetrical:
 *
 * - in the ignore list but missing from the match → the spec runs **nowhere**. No skip, no failure,
 *   nothing in any summary. It simply never executes, and the file sits in the repository looking
 *   like coverage.
 * - in the match but missing from the ignore → it runs twice, once without the session it needs,
 *   which at least fails loudly.
 *
 * The list is one constant now, so those two cannot drift apart. This is the other half: a NEW spec
 * file is collected by `chromium` only if it is absent from the list, and by `signed-in` only if it
 * is present, so **the arithmetic is only sound while the two projects between them cover every
 * file.** A spec added with a name nobody wired anywhere is what this catches.
 *
 * ## Why it reads the config rather than asking Playwright
 *
 * `playwright test --list` answers this authoritatively and costs a browser-less Playwright boot
 * plus a full collection of 72 spec files — too slow to sit in `pnpm verify`, which is the gate
 * that has to run on every commit. So this parses the one declaration the config makes and checks
 * the file listing against it. If the config grows a third project or a second list, this test's
 * own assumption breaks — which is why it asserts the SHAPE it depends on rather than trusting it.
 */
const ROOT = new URL('../../', import.meta.url).pathname;

const CONFIG = readFileSync(join(ROOT, 'playwright.config.ts'), 'utf8');

/** The spec files, and the setup files that are matched by name rather than by the split. */
const SPECS = readdirSync(join(ROOT, 'e2e'))
  .filter((name) => name.endsWith('.spec.ts'))
  .sort();

/** The names inside `NEEDS_PARTNER_SESSION`, read from the constant rather than re-listed here. */
function partnerSpecs(): string[] {
  const block = /const NEEDS_PARTNER_SESSION = new RegExp\(([\s\S]*?)\n\);/.exec(CONFIG);

  const body = block?.[1];

  if (!body) return [];

  return [...body.matchAll(/'([a-z0-9-]+)'/g)].map((one) => `${one[1]}.spec.ts`);
}

describe('the browser suite leaves no spec uncollected', () => {
  /*
    The assumption everything below rests on. Asserted rather than trusted, because a config that
    grew a third project or a second inline list would make every check here answer a question
    about a suite that no longer exists — the way an exemption whose reason has quietly become
    false keeps reading as true.
  */
  it('still splits the suite with one list used in both senses', () => {
    expect(CONFIG, 'the list is a named constant').toContain(
      'const NEEDS_PARTNER_SESSION = new RegExp(',
    );
    expect(
      CONFIG.match(/NEEDS_PARTNER_SESSION/g)?.length,
      'declared once and used exactly twice',
    ).toBe(3);
    expect(CONFIG).toContain('testIgnore: NEEDS_PARTNER_SESSION');
    expect(CONFIG).toContain('testMatch: NEEDS_PARTNER_SESSION');
    expect(
      /testMatch:\s*\/\(partner\|/.test(CONFIG),
      'no second copy of the list survives inline',
    ).toBe(false);
  });

  it('finds the specs it is meant to be checking', () => {
    expect(SPECS.length).toBeGreaterThan(50);
    expect(partnerSpecs().length).toBeGreaterThan(20);
  });

  /*
    The real check. A name in the list that matches no file is the more dangerous half: it reads as
    a spec being routed to the right project when there is no spec at all — a renamed file leaves
    its old name behind, `chromium` goes on ignoring a spec that no longer exists, and the new name
    is quietly picked up by the wrong project.
  */
  it('names no spec that does not exist', () => {
    const missing = partnerSpecs().filter((name) => !SPECS.includes(name));

    expect(missing, 'every name in the list is a real spec file').toEqual([]);
  });

  it('routes every spec file to exactly one project', () => {
    const listed = new Set(partnerSpecs());

    /*
      Both projects use the SAME expression, so membership decides: in the list means `signed-in`
      and only `signed-in`; absent means `chromium` and only `chromium`. There is no third state
      while that holds — which the first test is what guarantees.
    */
    const routed = SPECS.map((name) => ({
      name,
      project: listed.has(name) ? 'signed-in' : 'chromium',
    }));

    expect(
      routed.filter((one) => !one.project),
      'nothing unrouted',
    ).toEqual([]);
    expect(routed.length, 'every spec file accounted for, once').toBe(SPECS.length);
  });
});
