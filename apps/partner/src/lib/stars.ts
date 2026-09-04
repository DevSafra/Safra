/**
 * The five values a star classification can take.
 *
 * A written list rather than a range built at each call site: three screens offer this choice —
 * creating a listing, editing one, and the console's correction — and a `[1,2,3,4,5]` typed out
 * three times is three places to be inconsistent the day the scale changes.
 */
export const STAR_VALUES = [1, 2, 3, 4, 5] as const;
