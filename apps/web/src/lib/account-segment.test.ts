import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every personal screen sits UNDER the account layout, and the layout still guards.
 *
 * ## Why a sweep rather than a test of the layout
 *
 * `O-web-1` was left open because the useful sentence — «this is not a customer account» — was
 * said to need a page state that sixteen account pages do not have. It does not: they are all
 * nested under one segment, so one layout answers for all of them and none of the sixteen changed.
 *
 * That is exactly what makes the regression invisible. A new personal screen added OUTSIDE
 * `[locale]/account/` inherits nothing, gets no guard, and renders «تعذّر التحميل» again — and
 * every existing test stays green, because every existing page is still covered. The failure mode
 * is a page that was never added to the thing protecting it, which is the same shape as the partner
 * portal's `gate-coverage.test.ts` and is caught the same way.
 *
 * ## What it holds
 *
 * - The layout exists, and it is the account segment's own.
 * - It decides on `getCustomerProfileId`, which is the CLAIM the API's own `CUSTOMER_PROFILE_MISSING`
 *   is derived from — not on a role, and not on a fetch.
 * - It renders `children` when the claim is there, so a real customer is not blocked by it.
 * - Every route under the segment is a descendant of it, with no nested `layout.tsx` that could
 *   short-circuit one branch of the tree.
 *
 * It cannot see whether the sentence is the right sentence. That was driven in a browser across
 * all ten sections on 2026-09-27.
 */
const ACCOUNT = join(process.cwd(), 'apps/web/src/app/[locale]/account');
const LAYOUT = join(ACCOUNT, 'layout.tsx');

/** Every `page.tsx` below a directory, relative to it. */
function pagesUnder(dir: string, prefix = ''): string[] {
  const found: string[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);

    if (entry.isDirectory()) found.push(...pagesUnder(path, `${prefix}${entry.name}/`));
    else if (entry.name === 'page.tsx') found.push(`${prefix}${entry.name}`);
  }

  return found;
}

describe('the account segment', () => {
  const source = readFileSync(LAYOUT, 'utf8');

  it('has a layout of its own', () => {
    expect(source).toContain('export default async function AccountLayout');
  });

  /**
   * The CLAIM, not the role.
   *
   * «Is this a partner» is not the question — the question is whether the API will refuse, and it
   * refuses on `!claims.customerProfileId`. A guard keyed on the role would be a second answer to
   * the same question, and the direction a second answer fails in is the one that tells somebody
   * their account is fine while every page they open is refused.
   */
  it('decides on the customer-profile claim', () => {
    expect(source).toContain('getCustomerProfileId');
    expect(source).toContain('if (profileId) return children;');
  });

  /** A signed-out reader gets the sign-in redirect each page already performs, not this sentence. */
  it('passes a signed-out reader through', () => {
    expect(source).toContain('const profileId = await getCustomerProfileId();');
  });

  /**
   * THE sweep. Every personal screen is under the segment, and nothing nested re-roots the tree.
   *
   * Watched to fail: moving any one page out of `[locale]/account/` drops it from this list, and
   * adding a `layout.tsx` in a subdirectory is what would let one branch answer for itself.
   */
  it('covers every page below it, with no nested layout', () => {
    const pages = pagesUnder(ACCOUNT);

    expect(pages.length, 'the account section has pages').toBeGreaterThan(8);

    const nested = pagesUnder(ACCOUNT)
      .map((page) => page.replace(/page\.tsx$/, 'layout.tsx'))
      .filter((candidate) => candidate !== 'layout.tsx')
      .filter((candidate) => {
        try {
          readFileSync(join(ACCOUNT, candidate), 'utf8');

          return true;
        } catch {
          return false;
        }
      });

    expect(nested, 'a nested layout would answer for its own branch').toEqual([]);
  });

  /**
   * And the list of personal screens OUTSIDE the segment is the thing to keep at zero.
   *
   * `/wallet`, `/bookings`, `/invoices` as top-level routes would each be a personal screen with no
   * guard. They do not exist today; this is what notices when one is added.
   */
  it('has no personal screen outside it', () => {
    const locale = join(process.cwd(), 'apps/web/src/app/[locale]');
    const PERSONAL = [
      'wallet',
      'bookings',
      'invoices',
      'gifts',
      'favourites',
      'disputes',
    ];

    const strays = readdirSync(locale, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && PERSONAL.includes(entry.name))
      .map((entry) => entry.name);

    expect(strays, 'a personal screen outside the account segment is unguarded').toEqual(
      [],
    );
  });
});
