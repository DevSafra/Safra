import { z } from 'zod';

import { CATALOGUE_TAG } from '@safra/contracts';

const API_URL = process.env['API_URL'] ?? 'http://localhost:4000';

const translated = z.object({
  ar: z.string().nullable(),
  en: z.string().nullable(),
  de: z.string().nullable(),
});

/**
 * جروبات — a trip SAFRA announces.
 *
 * ## `priceFrom` and `currencyCode` are `.nullable()`, never defaulted
 *
 * A trip may honestly carry no price. A `.default('0')` would invent one, and a zero is an AMOUNT —
 * «من ٠» is a claim SAFRA is not making. The pair travels together because the money rule forbids a
 * figure without its currency, and the database holds that as a CHECK constraint rather than a
 * convention: there is no row where one is set and the other is not.
 */
const groupTripSchema = z.object({
  slug: z.string(),
  title: translated,
  summary: translated,
  /* Null on the LIST, which does not select it — a card shows a summary, not an essay. */
  description: translated,
  city: z.object({ slug: z.string(), countryCode: z.string(), name: translated }),
  startsOn: z.string(),
  endsOn: z.string(),
  priceFrom: z.string().nullable(),
  currencyCode: z.string().nullable(),
  seats: z.number().nullable(),
  /**
   * The cover photograph, or null for a trip nobody has illustrated yet.
   *
   * `.nullable()` and NOT `.default(null)`, for the reason recorded across this codebase: a
   * default invents a plausible value for a field the API stopped sending, and «no photograph» is
   * a state this page draws deliberately rather than a gap to paper over.
   *
   * `variantWidths` is the set that was actually RENDERED. `imageUrl` picks the nearest from it,
   * so a width invented here is a 404 in an `<img>` — which is why the API sends what the encoder
   * produced rather than a constant both sides would have to keep in step.
   */
  cover: z
    .object({
      fileKey: z.string(),
      variantWidths: z.array(z.number()),
      width: z.number().nullable(),
      height: z.number().nullable(),
      alt: translated,
    })
    .nullable(),
});

export type GroupTrip = z.infer<typeof groupTripSchema>;

const listSchema = z.object({ items: z.array(groupTripSchema) });

/**
 * Every announced trip, soonest first.
 *
 * Returns `[]` rather than throwing when the API is unreachable: جروبات is a section of a site that
 * still works without it, and a page that 500s because one list blipped is worse than a page that
 * says there is nothing announced. The distinction matters less here than on a booking path.
 */
export async function getGroupTrips(): Promise<GroupTrip[]> {
  try {
    const response = await fetch(`${API_URL}/api/v1/group-trips`, {
      headers: { Accept: 'application/json' },
      /*
        Both tags. `group-trips` names this list for anything that ever wants to purge only it;
        `CATALOGUE_TAG` is what the console's existing revalidation fans out, so publishing a trip
        or uploading its cover reaches the site at once instead of five minutes later — the exact
        complaint Bashar made about a city photograph on 2026-09-13.
      */
      next: { revalidate: 300, tags: ['group-trips', CATALOGUE_TAG] },
    });

    if (!response.ok) return [];

    return listSchema.parse(await response.json()).items;
  } catch {
    return [];
  }
}

/** One trip, or `null` when it is not published — which is the same answer as «no such trip». */
export async function getGroupTrip(slug: string): Promise<GroupTrip | null> {
  try {
    const response = await fetch(
      `${API_URL}/api/v1/group-trips/${encodeURIComponent(slug)}`,
      {
        headers: { Accept: 'application/json' },
        /*
        Both tags. `group-trips` names this list for anything that ever wants to purge only it;
        `CATALOGUE_TAG` is what the console's existing revalidation fans out, so publishing a trip
        or uploading its cover reaches the site at once instead of five minutes later — the exact
        complaint Bashar made about a city photograph on 2026-09-13.
      */
        next: { revalidate: 300, tags: ['group-trips', CATALOGUE_TAG] },
      },
    );

    if (!response.ok) return null;

    return groupTripSchema.parse(await response.json());
  } catch {
    return null;
  }
}

/**
 * Nights between two `YYYY-MM-DD` days.
 *
 * Plain date arithmetic on UTC midnights, so a daylight-saving boundary cannot turn seven nights
 * into six — the trap a `new Date(a) - new Date(b)` in local time walks into once a year.
 */
export function nightsBetween(startsOn: string, endsOn: string): number {
  const start = Date.parse(`${startsOn}T00:00:00Z`);
  const end = Date.parse(`${endsOn}T00:00:00Z`);

  if (Number.isNaN(start) || Number.isNaN(end)) return 0;

  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/** Whether the trip has already finished, which decides the badge rather than hiding the row. */
export function hasFinished(endsOn: string, today = new Date()): boolean {
  return endsOn < today.toISOString().slice(0, 10);
}

/**
 * The trips a reader can still join, in the order given: what the home page's «جروبات» row offers
 * (Bashar, 2026-10-02). A trip ending TODAY is still on, so it stays; one that ended yesterday is
 * history and belongs to the groups page, where it carries its «انتهت» badge.
 */
export function upcomingTrips<T extends { endsOn: string }>(
  trips: readonly T[],
  today = new Date(),
): T[] {
  return trips.filter((trip) => !hasFinished(trip.endsOn, today));
}
