import { ERROR } from './error-codes.js';

/**
 * What makes a PUBLISHED listing operationally complete, as opposed to merely valid.
 *
 * ## Why this exists
 *
 * Every check below describes a listing the database is perfectly happy with and a guest is not.
 * The platform has always rendered these states honestly — a listing with no bookable unit is
 * excluded from search and its page says «لا توجد وحدات», which was verified against the running
 * system rather than assumed — but nobody was ever TOLD. The partner did not know their live
 * listing was undiscoverable; staff could not see how many were; no screen anywhere could answer
 * «how many of ours actually work».
 *
 * So this is not validation. Validation refuses bad data at the boundary and these are not bad
 * data — they are gaps that accumulate silently after a listing goes live, and the only useful
 * response is to SHOW them to somebody who can close them.
 *
 * ## One definition, three readers
 *
 * The partner portal, the staff console and the API all have to agree about what «incomplete»
 * means, or a partner closes a gap the console still reports. It lives in contracts for the same
 * reason `statusTone` lives in `@safra/ui`: a second answer to the same question is the bug.
 *
 * ## Published listings only
 *
 * A draft is a work in progress and telling somebody it is incomplete is telling them it is
 * unfinished, which they know. `submitForReview` is where a draft is held to a standard — it
 * already refuses a listing with no unit and, since 2026-09-24, one with no coordinates.
 */

/**
 * The checks, in the order a reader should act on them.
 *
 * `unit` first because it is the only one that makes a listing unreachable: SAFRA's search prices
 * every result, so a listing with nothing to price never appears. The rest reduce reach or appeal
 * without hiding it.
 */
/**
 * The statuses a readiness check MEANS anything for.
 *
 * A draft is a work in progress: telling somebody it has no photograph is telling them it is
 * unfinished, which is why they are still in it. A rejected or archived listing is not in front of
 * a guest at all, so nothing it lacks costs anything.
 *
 * Both consoles honour this. It was written in this file's opening comment from the start and the
 * staff registry did not obey it for a day — every draft in العقارات read «لا يظهر في البحث»,
 * which is trivially true and tells an operator nothing.
 */
export const LISTING_READINESS_STATUSES = ['published', 'pending_review'] as const;

export const LISTING_READINESS_CHECKS = [
  'unit',
  'location',
  'photograph',
  'description',
] as const;

export type ListingReadinessCheck = (typeof LISTING_READINESS_CHECKS)[number];

/**
 * What each gap actually costs, which is what decides how loudly to say it.
 *
 * - `invisible` — the listing cannot be found or booked at all. Revenue is zero until it is fixed.
 * - `reach` — the listing is found by ordinary search and missing from the map, proximity search
 *   and every «near the airport» result, which is how this business is searched.
 * - `quality` — the listing is found and bookable, and loses against the one beside it.
 *
 * Three levels rather than a number, because a score invites somebody to chase 100% and these are
 * not equally urgent: a listing with no photograph still earns, and one with no unit does not.
 */
export const LISTING_READINESS_COST: Readonly<
  Record<ListingReadinessCheck, 'invisible' | 'reach' | 'quality'>
> = {
  unit: 'invisible',
  location: 'reach',
  photograph: 'quality',
  description: 'quality',
};

/**
 * What a listing is REFUSED with when a check is unmet at submission.
 *
 * A map rather than four `if`s, for the reason `LISTING_READINESS_CHECKS` is a list: the gate
 * walks the checks in order and names the first, so a fifth check added to the contract is
 * enforced the day it is added rather than the day somebody remembers to extend a chain. A check
 * with no code here fails to compile, which is the point.
 */
export const LISTING_READINESS_ERROR: Readonly<
  Record<ListingReadinessCheck, (typeof ERROR)[keyof typeof ERROR]>
> = {
  unit: ERROR.PROPERTY_UNIT_REQUIRED,
  location: ERROR.PROPERTY_LOCATION_REQUIRED,
  photograph: ERROR.PROPERTY_PHOTOGRAPH_REQUIRED,
  description: ERROR.PROPERTY_DESCRIPTION_REQUIRED,
};

/** What is known about a listing, in the terms the checks are written in. */
export interface ListingReadinessFacts {
  /** Bookable units that are not soft-deleted. Search prices every result, so zero means absent. */
  readonly unitCount: number;
  /** BOTH published coordinates. Half a pair cannot be drawn, so it is not a location. */
  readonly hasLocation: boolean;
  /** At least one photograph that finished processing. A pending render is not yet a picture. */
  readonly hasPhotograph: boolean;
  /** A description in ARABIC, the default locale — the one a reader is guaranteed to meet. */
  readonly hasDescription: boolean;
}

/**
 * The gaps, in check order. Empty means the listing is operationally complete.
 *
 * Returns the CHECKS rather than sentences: every word a person reads comes from `@safra/i18n`,
 * in the language of whichever of the three apps is asking.
 */
export function listingGaps(
  facts: ListingReadinessFacts,
): readonly ListingReadinessCheck[] {
  const gaps: ListingReadinessCheck[] = [];

  if (facts.unitCount <= 0) gaps.push('unit');
  if (!facts.hasLocation) gaps.push('location');
  if (!facts.hasPhotograph) gaps.push('photograph');
  if (!facts.hasDescription) gaps.push('description');

  return gaps;
}

/**
 * The worst thing wrong with a listing, or null when nothing is.
 *
 * A card has room for one tone and one headline. Showing the mildest gap beside a listing nobody
 * can book would be an understatement of exactly the kind this whole model exists to remove.
 */
export function worstCost(
  gaps: readonly ListingReadinessCheck[],
): 'invisible' | 'reach' | 'quality' | null {
  if (gaps.some((gap) => LISTING_READINESS_COST[gap] === 'invisible')) return 'invisible';
  if (gaps.some((gap) => LISTING_READINESS_COST[gap] === 'reach')) return 'reach';
  if (gaps.length > 0) return 'quality';

  return null;
}
