import { sql } from 'drizzle-orm';

/**
 * The two questions asked of a `property_images` row, written once.
 *
 * ## Why these are constants and not four hand-written predicates
 *
 * Encoding moved off the request (BullMQ phase 3), so a row can now exist whose `file_key` names an
 * object that has not been written yet. Four separate places read these rows, and before this file
 * every one of them filtered on `deleted_at IS NULL` alone:
 *
 *   - the customer gallery (`property-detail.service.ts`)
 *   - the search/listing card's cover (`properties.service.ts`)
 *   - the ranking's photo count (`recommendation.service.ts`) — §5.5 REWARDS photo count
 *   - the partner's own manager (`property-images.service.ts`)
 *
 * Left alone, each would have served a picture that does not exist. The ranking one is the worst of
 * the four and the least visible: a partner could raise their own recommendation score by uploading
 * files that never finish processing, and nothing on any screen would show it.
 *
 * This is the same discipline the paginated registries use for `fromWhere` — a predicate that
 * describes the same set in four places is one predicate, or it is four that drift.
 *
 * ## The two are deliberately different
 *
 * A `processing` row is REAL — it counts against the thirty-image cap, it holds its sort position,
 * and it is shown to the partner who just uploaded it, because a photograph that vanishes for ten
 * seconds and then reappears reads as a bug. It is simply not something a customer may be shown
 * yet. A `failed` row is neither: it is kept so the partner can be told why, and it is otherwise
 * invisible to everything.
 */

/**
 * Rows that belong to the gallery at all — what the OWNER sees and what the cap counts.
 *
 * Includes `processing`. Excludes `failed`, so a photograph that could not be decoded stops
 * consuming one of the partner's thirty slots the moment it is known to be dead.
 */
export const IMAGE_IS_LIVE = sql`deleted_at IS NULL AND status <> 'failed'`;

/**
 * Rows a CUSTOMER may be shown, and the only ones the ranking may count.
 *
 * `status = 'ready'` means the six variants have been written and the URLs resolve. Anything else
 * is a promise, and a gallery cannot render a promise.
 */
export const IMAGE_IS_PUBLISHED = sql`deleted_at IS NULL AND status = 'ready'`;

/**
 * A table alias, checked before it is concatenated into SQL.
 *
 * These two helpers are the only way to get an alias into a query fragment, and they use `sql.raw`
 * — which does not parameterise. Every caller passes a literal, so nothing here is reachable by a
 * request today; the guard exists because "no caller passes user input" is a property of the
 * current callers, and the security review's claim is about `sql.raw` itself: two calls, both on
 * compile-time constants. This keeps that claim true by construction rather than by inspection.
 */
function checkedAlias(alias: string): string {
  if (!/^[a-z][a-z0-9_]{0,15}$/.test(alias)) {
    throw new Error(
      `Refusing to build SQL from the table alias ${JSON.stringify(alias)}.`,
    );
  }

  return alias;
}

/**
 * The same predicate against an aliased table, for the queries that join.
 *
 * `sql` fragments carry no table context, so a query that aliases `property_images pi` needs
 * `pi.deleted_at`, not `deleted_at`. Passing the alias in keeps the CONDITION in one place while
 * letting each caller name its own table — the alternative was every joining query writing the
 * predicate out again, which is exactly what this file exists to stop.
 */
export function imageIsPublished(alias: string) {
  const a = checkedAlias(alias);

  return sql.raw(`${a}.deleted_at IS NULL AND ${a}.status = 'ready'`);
}

/** As `imageIsPublished`, for the owner-facing set. */
export function imageIsLive(alias: string) {
  const a = checkedAlias(alias);

  return sql.raw(`${a}.deleted_at IS NULL AND ${a}.status <> 'failed'`);
}
