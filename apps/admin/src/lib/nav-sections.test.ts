import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { CONSOLE_SECTION_PERMISSIONS } from '@safra/contracts';

/**
 * The sidebar's keys and the section map's keys are the same set.
 *
 * ## Why this test exists, twice over
 *
 * `CONSOLE_SECTION_PERMISSIONS` decides which sections a reader may open; `admin-sidebar.tsx`
 * decides which links exist. The nav is about to be filtered by the map, which makes a name that
 * appears in one and not the other a silent defect in BOTH directions:
 *
 * - **A nav key missing from the map** disappears from the console for every reader, super admins
 *   included, because `canOpenSection` answers false for anything unmapped. Nothing throws. The
 *   symptom is a link that is not there, which reads as a rendering bug.
 * - **A mapped section missing from the nav** is a page a reader can be entitled to and cannot
 *   find. It stays reachable by URL, so it is not broken — it is invisible.
 *
 * Both happened. `partnerApplications` was the first: the sidebar's name all along, and the map
 * called it `applications`. `payouts`, `reviews` and `emergency` were the second: pages with real
 * guards and no key at all, found by project-cc asking which page a loop over the map would leave
 * behind. Neither was findable by reading the two lists side by side and judging them the same —
 * that is not a diff, and this is.
 *
 * ## Why it parses the file rather than importing it
 *
 * `admin-sidebar.tsx` is a client component: it imports `next/navigation` and does not load under
 * a plain vitest environment. The keys are a literal list in the source, and reading them from the
 * source is honest about what is being asserted — the SHAPE of the nav, not its behaviour.
 */
const SIDEBAR = 'src/components/admin-sidebar.tsx';

function navKeys(): string[] {
  const source = readFileSync(new URL(`../../${SIDEBAR}`, import.meta.url), 'utf8');
  const keys = [...source.matchAll(/key: '(\w+)'/g)].map((match) => match[1] ?? '');

  return keys;
}

/**
 * Sections that exist and are deliberately NOT in the sidebar.
 *
 * Each needs a reason, because "not in the nav" and "forgotten" look identical from here. A bare
 * list would let the next missing section hide inside it.
 */
const OFF_NAV: Record<string, string> = {
  /*
    Both reasons below were VERIFIED against the actual link by project-e9, not inferred — the
    third reason I wrote here was wrong, and `emergency` is in the nav now because of it.
  */
  payouts:
    'Reached from الدفع — apps/admin/src/app/payments/page.tsx renders href="/payouts" — rather than as a top-level section.',
  reviews:
    'Reached from النزاعات — apps/admin/src/app/disputes/page.tsx renders href="/reviews" — rather than as a top-level section.',
};

describe('the sidebar and the section map', () => {
  const keys = navKeys();

  /** A guard on the guard: a regex that stopped matching would make every assertion below vacuous. */
  it('finds the sidebar keys at all', () => {
    expect(keys.length).toBeGreaterThan(15);
  });

  it('has every sidebar key in the section map', () => {
    const mapped = new Set(Object.keys(CONSOLE_SECTION_PERMISSIONS));

    expect(keys.filter((key) => !mapped.has(key))).toEqual([]);
  });

  it('has every mapped section in the sidebar, or excused with a reason', () => {
    const inNav = new Set(keys);
    const missing = Object.keys(CONSOLE_SECTION_PERMISSIONS).filter(
      (section) => !inNav.has(section) && !(section in OFF_NAV),
    );

    expect(missing).toEqual([]);
  });

  /** An excuse pointing at a section that no longer exists is an excuse nobody re-read. */
  it('excuses only sections that exist', () => {
    const mapped = new Set(Object.keys(CONSOLE_SECTION_PERMISSIONS));

    expect(Object.keys(OFF_NAV).filter((section) => !mapped.has(section))).toEqual([]);
  });

  it('gives every excused section a real reason', () => {
    for (const [section, reason] of Object.entries(OFF_NAV)) {
      expect(reason.length, section).toBeGreaterThan(30);
    }
  });
});
