import { z } from 'zod';

/**
 * Cursor (keyset) pagination, not OFFSET.
 *
 * OFFSET makes the database count and discard every skipped row, so page 5,000 of
 * a booking list costs proportionally more than page 1. At the volumes this
 * platform targets that degrades into timeouts. A cursor turns every page into an
 * indexed seek of constant cost.
 *
 * It also fixes a correctness bug OFFSET has: with rows arriving constantly, an
 * OFFSET page can skip or repeat records as earlier rows shift underneath it.
 */
export const cursorQuerySchema = z
  .object({
    /** Hard ceiling of 100 — an unbounded list endpoint is a DoS vector. */
    limit: z.coerce.number().int().min(1).max(100).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();

export type CursorQuery = z.infer<typeof cursorQuerySchema>;

export interface CursorPage<T> {
  items: T[];
  /** Opaque cursor for the next page; null when the end has been reached. */
  nextCursor: string | null;
}

/**
 * Cursors are opaque to clients by design: encoding the sort key as base64url
 * signals "do not construct these by hand" and lets the sort key change later
 * without breaking callers.
 *
 * Not encrypted, and not sensitive — it carries only a timestamp and an id the
 * caller is already authorised to see. Authorization is re-applied on every
 * request regardless of what the cursor says, so a forged cursor can shift the
 * page window but never widen access.
 */
export function encodeCursor(createdAt: Date | string, id: string): string {
  /**
   * A string sort key is passed through verbatim, and that is the point.
   *
   * A JavaScript Date holds MILLISECONDS; PostgreSQL `timestamptz` holds
   * microseconds. Round-tripping the key through a Date therefore truncates it, and
   * the keyset comparison `(created_at, id) < (cursor_ts, cursor_id)` then matches
   * nothing for any row whose real timestamp has a sub-millisecond component —
   * the page after the boundary comes back empty and the client believes it has
   * reached the end.
   *
   * That is not hypothetical: several rows written in one transaction share a
   * timestamp to the microsecond, which is exactly when the id tiebreaker is
   * supposed to save the page boundary and instead cannot be reached. Callers with
   * sub-millisecond keys pass the raw value; callers already holding a Date (whose
   * driver truncated it long before this function) keep the old behaviour.
   */
  const key = typeof createdAt === 'string' ? createdAt : createdAt.toISOString();

  return Buffer.from(`${key}|${id}`, 'utf8').toString('base64url');
}

/**
 * Returns null for anything unparseable. Callers MUST treat null as a client
 * error (400) rather than falling back to the first page — see the note in
 * BookingsService.list about infinite pagination loops.
 *
 * `sortKey` is the timestamp exactly as it was encoded, for callers comparing in
 * SQL at full precision. `createdAt` is the same instant as a Date, for callers
 * comparing against a driver-supplied Date.
 */
export function decodeCursor(
  cursor: string,
): { createdAt: Date; sortKey: string; id: string } | null {
  try {
    const raw = Buffer.from(cursor, 'base64url').toString('utf8');
    const separator = raw.indexOf('|');

    if (separator === -1) {
      return null;
    }

    const sortKey = raw.slice(0, separator);
    const createdAt = new Date(sortKey);
    const id = raw.slice(separator + 1);

    if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
      return null;
    }

    return { createdAt, sortKey, id };
  } catch {
    // A malformed cursor is treated as "start from the beginning" by the caller,
    // never as a 500.
    return null;
  }
}

/**
 * Page-number pagination, for the staff console's registries.
 *
 * ## Why this exists alongside the cursor
 *
 * The cursor above is the better mechanism and stays the rule for anything customer-facing. It
 * cannot do one thing, and that thing was asked for (Bashar, 2026-08-05): show "الصفحة 4 من 102"
 * with a box to jump to page 40. A cursor addresses a POSITION, not an index — reaching page 40
 * means walking pages 1 to 39 — so a page number requires `OFFSET`, and a total requires
 * `count(*)`. There is no third option; a screen that shows a page count is choosing this cost.
 *
 * ## What it costs, stated plainly
 *
 * - `OFFSET n` makes PostgreSQL produce and discard `n` rows, so deep pages cost more than shallow
 *   ones. `page` is capped below so a hand-edited URL cannot ask for page ten million.
 * - `count(*)` over the filtered set is a second query per page load, and an uncapped one is
 *   unbounded work: counting an ever-growing `audit_log` means reading every matching row before
 *   the first row of the page can be shown. So it is CAPPED — see `COUNT_CAP`. Past the cap the
 *   total is reported as "more than 10,000" rather than counted, which trades an exact number
 *   nobody needs for a constant cost, and keeps rule 2's "nothing that degrades at 1M users".
 * - An OFFSET page can skip or repeat a row when rows arrive underneath the reader. That is real,
 *   and it is the honest trade for addressable pages: an operator who can say "page 40" is asking
 *   for a window on a moving list.
 *
 * The customer-facing lists — booking history, wallet statement — stay on the cursor. They are
 * "load more" surfaces where nobody asks for page 40, so they pay none of this.
 */
/**
 * The highest page number the API will accept, and the value the console clamps to.
 *
 * Exported rather than written twice. The console clamps BEFORE calling so a hand-edited `?page=`
 * shows a table rather than an error page — which only works while the clamp and the schema agree.
 * Two constants named "the ceiling" in two packages is one more than can stay in step, and the
 * failure is silent in the direction that matters: a console clamping to a number the API refuses
 * turns every over-range URL into the 400 the clamp exists to prevent.
 *
 * Lowered from 100,000 to 1,000 on 2026-08-20 — the reasoning, and the measurement it came from,
 * are on `page` below.
 */
export const MAX_PAGE_NUMBER = 1_000;

export const pageQuerySchema = z
  .object({
    /**
     * 1-based, because a person reads it.
     *
     * A refusal rather than a clamp, so a wrong URL is visible instead of quietly showing page 1.
     *
     * ## Capped at 1,000 since 2026-08-20, down from 100,000 (Bashar, `O-page-1`)
     *
     * The original 100,000 was a guess at "nobody reaches this by intent". Scenario 3 of the load
     * test measured what it actually costs, over 5,000,061 bookings — buffers the database had to
     * read, which is a property of the plan rather than of the hardware:
     *
     * | Page    | Rows read | Returned | Buffers                 |
     * | ------- | --------- | -------- | ----------------------- |
     * | 1       | 27        | 25       | 144                     |
     * | 100     | 2,500     | 25       | 9,914                   |
     * | 1,000   | 25,000    | 25       | 87,069 + 5,254 written  |
     * | 100,000 | 2,500,000 | 25       | 2,663,104               |
     *
     * The plan is the right plan at every depth — an index scan feeding an incremental sort, no
     * sequential scan and no missing index — so there is nothing to optimise: the cost is inherent
     * to `OFFSET` and linear in `page × limit`. The only dial is the ceiling, and at 100,000 a
     * single request read 2.5 million rows to return 25, roughly 20 GB of page accesses, which any
     * authenticated staff account could ask for repeatedly.
     *
     * 1,000 is where the sort begins spilling to disk, and it is 40× past anything a person
     * reaches by hand. It bounds the worst case at ~87,000 buffers, a 30× reduction in the cap.
     *
     * **What it breaks, deliberately:** a script walking pages to enumerate a registry now gets a
     * 400 at page 1,001. That was always the wrong instrument — such a caller should use the
     * keyset endpoints or narrow with a date filter, which is what `O-page-1` says the real fix
     * for depth is.
     */
    page: z.coerce.number().int().min(1).max(MAX_PAGE_NUMBER).default(1),
    /** Same ceiling as the cursor query — an unbounded list endpoint is a DoS vector. */
    limit: z.coerce.number().int().min(1).max(100).default(25),
  })
  .strict();

export type PageQuery = z.infer<typeof pageQuerySchema>;

/**
 * How far a total is counted before it is reported as "more than this".
 *
 * The number is a product judgement, not a technical limit: nobody reading a console table needs
 * to know whether the audit log holds 40,000 rows or 41,000, and the difference between those two
 * answers is a full scan. Ten thousand is past every set an operator will actually page through
 * and small enough that the count is a bounded amount of work on every table, forever.
 *
 * Services implement it as `count(*)` over a `LIMIT COUNT_CAP + 1` subquery — so the database
 * stops reading at 10,001 rows, and a total of exactly 10,001 means "at least".
 */
export const COUNT_CAP = 10_000;

export interface OffsetPage<T> {
  items: T[];
  /**
   * Rows matching the filter, across all pages — exact up to `COUNT_CAP`.
   *
   * When `capped` is true this is `COUNT_CAP` and the real total is higher. Clients must print it
   * as "more than", never as a figure: a capped total shown as an exact one is a lie the reader
   * has no way to detect.
   */
  total: number;
  /** True when the count stopped at `COUNT_CAP` instead of finishing. */
  capped: boolean;
  /** Echoed back so a client never has to trust its own arithmetic. */
  page: number;
  /**
   * Total pages, never below 1.
   *
   * An empty table reads "صفحة 1 من 1" rather than "من 0", which looks like a bug.
   */
  pages: number;
}

/**
 * Shapes rows and a counted total into a page.
 *
 * Takes the count separately because only the caller's query knows the filter. The arithmetic lives
 * here, once, so no service invents its own off-by-one.
 *
 * `counted` is the raw result of the capped count, so `COUNT_CAP + 1` is what "there are more"
 * looks like arriving here — this is the one place that reads it and the only place that decides
 * what a capped total means.
 */
export function offsetPage<T>(
  items: T[],
  counted: number,
  query: PageQuery,
): OffsetPage<T> {
  const capped = counted > COUNT_CAP;
  const total = capped ? COUNT_CAP : counted;

  return {
    items,
    total,
    capped,
    page: query.page,
    /*
      Derived from the CAPPED total, so the page count is bounded too. It understates when the
      total is capped, which is why the bar prints "أكثر من" beside it — an operator who has paged
      to the end of a capped set gets more pages, because by then `page × limit` exceeds the cap
      and the arithmetic below catches up with where they are.
    */
    pages: Math.max(1, Math.ceil(total / query.limit), capped ? query.page + 1 : 1),
  };
}
