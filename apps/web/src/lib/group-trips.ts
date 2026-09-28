import { z } from 'zod';

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
  city: z.object({ slug: z.string(), name: translated }),
  startsOn: z.string(),
  endsOn: z.string(),
  priceFrom: z.string().nullable(),
  currencyCode: z.string().nullable(),
  seats: z.number().nullable(),
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
      next: { revalidate: 300, tags: ['group-trips'] },
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
        next: { revalidate: 300, tags: ['group-trips'] },
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
