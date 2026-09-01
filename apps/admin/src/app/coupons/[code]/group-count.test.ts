import { describe, expect, it } from 'vitest';

import { COUNT_CAP } from '@safra/contracts';

import { count } from '@/lib/format';

import { groupCount } from './group-count';

/**
 * A coupon's three group figures, and the one that must not be printed as a fact.
 *
 * ## Why this is a unit test
 *
 * Past `COUNT_CAP` the count stops reading and the figure becomes a FLOOR. On screen «١٠٠٠٠» and
 * «أكثر من ١٠٠٠٠» are the same width and the same colour, so a regression here is invisible to a
 * screenshot and to the browser sweep — and unreachable against the development fixtures, which
 * hold 2,672 eligible partners against a cap of ten thousand.
 *
 * The uncapped branch runs in a browser on every `pnpm e2e`; this covers the half that cannot.
 */
describe('a coupon group’s figure', () => {
  it('says «أكثر من» when the group hit the cap', () => {
    const rendered = groupCount({ total: COUNT_CAP, capped: true });

    expect(rendered).toContain('أكثر من');
    expect(rendered).toContain(count(COUNT_CAP));
  });

  it('states a plain figure when it did not', () => {
    const rendered = groupCount({ total: 2_672, capped: false });

    expect(rendered).not.toContain('أكثر من');
    expect(rendered).toBe(count(2_672));
  });

  /* Zero is a real answer — «nobody has refused it» — and must read as one, not as an absence. */
  it('prints an empty group as zero', () => {
    expect(groupCount({ total: 0, capped: false })).toBe(count(0));
  });
});
