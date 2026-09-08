import { expect, type APIRequestContext } from '@playwright/test';

/** A stay, as the checkout URL wants it. */
export interface Stay {
  readonly checkIn: string;
  readonly checkOut: string;
}

/** Something bookable: which unit, on which property, for which nights. */
export interface Bookable extends Stay {
  readonly slug: string;
  readonly unitId: string;
}

/** `base` days from today, for `length` nights. */
export function stayFrom(base: number, length = 2): Stay {
  const from = new Date();

  from.setUTCDate(from.getUTCDate() + base);

  const to = new Date(from);

  to.setUTCDate(to.getUTCDate() + length);

  return {
    checkIn: from.toISOString().slice(0, 10),
    checkOut: to.toISOString().slice(0, 10),
  };
}

/**
 * A unit the platform says is bookable, and the nights it is bookable for — ASKED, never guessed.
 *
 * ## Two flakes this removes, and they had the same shape
 *
 * `checkout-and-acceptance` pinned a unit by UUID — `const UNIT = '01a07c0e-…'` — and picked its
 * dates with `Date.UTC(2028, 0, 1) + (Date.now() % 250)`. Both are guesses about database state.
 *
 * 1. **The UUID stopped existing.** `pnpm db:testbed` reseeds units, so the id changed and every
 *    window reported «هذه الوحدة غير متاحة لهذه التواريخ» — the product correctly saying «no such
 *    unit», read by the spec as a booked-out calendar and by a reader as a 30-second timeout.
 * 2. **A random day in a 250-day window collides.** A journey that books a unit CONSUMES those
 *    nights, so an earlier run — today's or last week's — takes the window this one wanted. Over
 *    thirty runs that is not unlikely, it is the birthday problem. Its four tests also used offsets
 *    0, 1, 2 and 3 for TWO-night stays, so they overlapped each other before any history was
 *    involved.
 *
 * Widening the window makes a collision rarer without making it impossible, which is the definition
 * of a flake. So this asks `GET /search`, which by construction answers only with units that are
 * FREE for the window it was asked about, and returns the first one it offers together with the
 * slug and id the checkout URL needs. Nothing about the database is assumed.
 */
export async function bookableStay(
  request: APIRequestContext,
  api: string,
  options: {
    /**
     * Constrain to ONE property, by slug.
     *
     * A slug is seeded and survives `db:testbed`; a unit id is generated and does not. So a spec
     * that needs a particular OWNER — anything asserting on the testbed partner's queue — pins the
     * slug and lets the unit and the window be resolved. Without it, the first free unit search
     * offers can belong to another partner and the request lands in a queue the spec is not
     * watching, which is a failure this helper caused before it took this argument.
     */
    readonly slug?: string;
    /**
     * Narrow the search to one city, which a named `slug` needs in practice.
     *
     * Search is RANKED, and this database holds **846** `rev-test-*` properties left behind by
     * review specs. They fill the first sixty results, so a named fixture is not on the page even
     * at `limit=60` — `citySlug=damascus` returns four items and the fixture is one of them. The
     * pollution is a testbed-hygiene problem in its own right; this keeps the helper working while
     * it stands.
     */
    readonly citySlug?: string;
    readonly start?: number;
    readonly stride?: number;
    readonly tries?: number;
  } = {},
): Promise<Bookable> {
  const { slug, citySlug, start = 200, stride = 7, tries = 30 } = options;
  /* One result is enough when anything will do; a named property needs a page to look through. */
  const limit = slug === undefined ? 1 : 60;

  for (let attempt = 0; attempt < tries; attempt += 1) {
    const stay = stayFrom(start + attempt * stride);
    const answer = await request.get(
      `${api}/search?checkIn=${stay.checkIn}&checkOut=${stay.checkOut}` +
        `&adults=2&limit=${String(limit)}` +
        (citySlug === undefined ? '' : `&citySlug=${citySlug}`),
    );

    if (!answer.ok()) continue;

    const items =
      ((await answer.json()) as { items?: { slug?: string; unitId?: string }[] }).items ??
      [];
    const match = slug === undefined ? items[0] : items.find((one) => one.slug === slug);

    if (match?.slug !== undefined && match.unitId !== undefined) {
      return { ...stay, slug: match.slug, unitId: match.unitId };
    }
  }

  /* Thirty windows over seven months and search offered nothing: a testbed problem, not a timing
     one, and said as such rather than returning something the caller will fail on. */
  expect(
    null,
    `search offered no bookable unit${slug === undefined ? '' : ` on ${slug}`} in ` +
      `${String(tries * stride)} days from day ${String(start)} — ` +
      'restore the testbed with `pnpm db:testbed`',
  ).toBeTruthy();

  throw new Error('unreachable');
}
