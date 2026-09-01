import { fill, t } from '@/lib/strings';
import { count } from '@/lib/format';

/**
 * How many partners are in one group, as a person reads it.
 *
 * Its own module because a capped figure printed as an exact one is invisible on screen — the
 * number looks like every other number — so the choice is made once here and asserted beside it,
 * rather than being retyped inside a `map` where nothing holds it to account.
 *
 * The capped branch cannot be reached against the development fixtures: it needs more than ten
 * thousand partners on ONE coupon, and there are 2,672 eligible partners in total. That is exactly
 * why it is a unit test — the uncapped branch runs in a browser on every `pnpm e2e`.
 */
export function groupCount(tally: { total: number; capped: boolean }): string {
  return tally.capped
    ? fill(t.sections.coupons.countCapped, { n: count(tally.total) })
    : count(tally.total);
}
