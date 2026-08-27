import { inArray, sql, type SQL } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import {
  ERROR,
  UNSCOPED,
  canWriteInCity,
  isRestricted,
  type StaffScope,
} from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';
import { forbidden, notFound } from '../common/errors/app-error.js';

/**
 * Turning a staff scope into SQL and into write refusals (design handoff §8.2).
 *
 * ## One helper, used by every scoped query
 *
 * The enforcement rules live in `@safra/contracts/scope` as pure predicates; this module is the
 * single place they become a `WHERE` clause. Duplicating the predicate per service is how a scope
 * ends up enforced on eight resources and forgotten on the ninth — and the ninth is the one
 * somebody finds.
 *
 * ## Read enforcement is a predicate, never a post-filter
 *
 * `scopeFilter` returns SQL that goes into the query. Filtering rows out in TypeScript after they
 * arrive would be wrong in three ways at once: the page size would vary per member, the keyset
 * cursor would skip, and the rows would have crossed a process boundary before being denied.
 *
 * ## Write enforcement is separate and always strict
 *
 * `assertCanWrite` refuses a mutation outside scope in BOTH modes. `read_only` widens READ only.
 */

/** Resolves the scope from claims, defaulting to unrestricted. */
export function scopeOf(actor: AccessTokenClaims | undefined): StaffScope {
  return actor?.scope ?? UNSCOPED;
}

/**
 * A `WHERE`-clause fragment restricting rows to the actor's scope.
 *
 * `cityColumn` is the fully-qualified city column for the query — `b.city_id`, `pt.city_id`. It is
 * interpolated with `sql.raw`, so it must never come from user input; every call site passes a
 * literal.
 *
 * Returns `TRUE` when the scope is unrestricted or when `read_only` is set, both of which Postgres
 * folds away at plan time — so an unscoped member's query is byte-identical to what it was before
 * scope existed.
 *
 * `IS NULL` is always allowed: a row with no city is a platform-level record, and scope narrows by
 * geography rather than by existence.
 */
export function scopeFilter(
  actor: AccessTokenClaims | undefined,
  cityColumn: string,
): SQL {
  const scope = scopeOf(actor);

  if (!isRestricted(scope)) return sql`TRUE`;

  /*
    `read_only` means every row is READABLE. The filter is what governs reads, so it opens up
    entirely and `assertCanWrite` carries the whole restriction. Two mechanisms, one for each verb,
    rather than one mechanism trying to express both.
  */
  if (scope.outside === 'read_only') return sql`TRUE`;

  const column = sql.raw(cityColumn);

  /*
    Each id is its OWN bound parameter, joined into an `IN (…)` list.

    The obvious form is `= ANY(${scope.cityIds}::uuid[])`, and it was written that way first. It
    fails at runtime: Drizzle serialises a JavaScript array as JSON, so Postgres receives
    `["019f…","019f…"]` and answers `malformed array literal: "[" must introduce
    explicitly-specified array dimensions`. Every scoped query 500'd — and no unit test could see
    it, because the predicate is only serialised when it reaches a real driver. A live probe found
    it.

    Binding each id separately also keeps them parameters rather than interpolated text, which is
    what rule 1 requires of anything reaching SQL.
  */
  const ids = sql.join(
    scope.cityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  return sql`(${column} IS NULL OR ${column} IN (${ids}))`;
}

/**
 * The scope as a predicate for a WRITE — the counterpart of `scopeFilter`.
 *
 * ## Why `scopeFilter` cannot be used in an `UPDATE`
 *
 * Because it returns `TRUE` for `read_only`, deliberately: that mode means «you may look at the
 * rest of the country», and the write restriction is carried by `assertCanWrite` instead. Put the
 * READ filter in an `UPDATE … WHERE` and a `read_only` member writes wherever they can see, which
 * is everywhere — the one configuration the scope model says must not exist.
 *
 * ## When to reach for this rather than the load-then-assert pair
 *
 * Almost never. The house shape is: narrow the LOOKUP with `scopeFilter`, then `assertCanWrite` on
 * the row's city — it gives a `none` member a 404 indistinguishable from absence and a `read_only`
 * member a 403 that says the action is not permitted, which are the two different answers those
 * modes are owed.
 *
 * This exists for the case where there is no load: a statement that finds and writes in one go, and
 * where adding a separate read would introduce a window rather than remove one. `setLocation` is
 * that case. The cost is that both modes get the same 404, which is acceptable where the row is
 * named by a reference the caller already had.
 */
export function writeFilter(
  actor: AccessTokenClaims | undefined,
  cityColumn: string,
): SQL {
  const scope = scopeOf(actor);

  if (!isRestricted(scope)) return sql`TRUE`;

  const column = sql.raw(cityColumn);

  /* Each id its own bound parameter — see the note in `scopeFilter` on why `= ANY` fails here. */
  const ids = sql.join(
    scope.cityIds.map((id) => sql`${id}::uuid`),
    sql`, `,
  );

  return sql`(${column} IS NULL OR ${column} IN (${ids}))`;
}

/**
 * Whether the actor's scope restricts reads at all.
 *
 * Exposed so a caller can label a list as scoped in the response — an operator who cannot see a
 * Damascus booking should be told the list is filtered, not left to conclude there are none.
 */
export function readsAreScoped(actor: AccessTokenClaims | undefined): boolean {
  const scope = scopeOf(actor);

  return isRestricted(scope) && scope.outside === 'none';
}

/**
 * Refuses a mutation on a row outside the actor's scope.
 *
 * ## Why the shape of the refusal differs by mode
 *
 * With `none` the row is not supposed to exist for this member, so a 404 is the honest answer — a
 * 403 would confirm it exists, which is information they are not scoped to have. With `read_only`
 * they can already see the row, so hiding it now would be absurd; they get a 403 that says the
 * action is not permitted.
 *
 * Both messages are generic (rule 1): neither names a city or a scope.
 */
export function assertCanWrite(
  actor: AccessTokenClaims | undefined,
  cityId: string | null,
): void {
  const scope = scopeOf(actor);

  if (canWriteInCity(scope, cityId)) return;

  if (scope.outside === 'read_only') {
    throw forbidden(ERROR.SCOPE_OUTSIDE);
  }

  throw notFound(ERROR.REQUEST_NOT_FOUND);
}

/**
 * Refuses a READ of a row outside the actor's scope.
 *
 * ## Why it is not `assertCanWrite`
 *
 * `read_only` is the whole difference. That mode means "you may look at the rest of the country, you
 * may not change it", so a read outside scope is exactly what it permits and a write outside scope
 * is exactly what it forbids. Reusing the write guard for reads would break the mode it exists for.
 *
 * With `none` the row is not supposed to exist for this member, so the answer is 404 — the register's
 * rule that "not yours" answers the same as "not there". There is no `read_only` branch because
 * `read_only` never reaches the throw.
 *
 * ## Why a row-level check and not only a predicate
 *
 * `scopeFilter` handles LISTS: the row never leaves the database. A DETAIL screen is fetched by
 * reference, so there is no list to filter — the row arrives and then has to be refused. Both are
 * needed, and the reason the detail screens went unscoped for so long is that the predicate looked
 * like it covered everything.
 */
export function assertCanRead(
  actor: AccessTokenClaims | undefined,
  cityId: string | null,
): void {
  const scope = scopeOf(actor);

  if (!isRestricted(scope)) return;
  /* `read_only` widens READS to everything; that is what the mode means. */
  if (scope.outside === 'read_only') return;
  if (cityId !== null && scope.cityIds.includes(cityId)) return;

  throw notFound(ERROR.REQUEST_NOT_FOUND);
}

/**
 * The scope as a DRIZZLE condition, for a query built with the relational builder.
 *
 * `scopeFilter` returns a `sql` fragment, which `db.query.x.findMany({ where })` cannot take. The two
 * P-002 verification queues are built that way, and that mismatch is why they were the queries that
 * never got scoped: adding the predicate looked like it needed the query rewritten.
 *
 * Returns `undefined` when the scope is unrestricted, so a caller can spread it into an `and(...)`
 * without branching and an unscoped member's query is unchanged.
 */
export function scopeCondition(
  actor: AccessTokenClaims | undefined,
  cityColumn: PgColumn,
): SQL | undefined {
  const scope = scopeOf(actor);

  if (!isRestricted(scope)) return undefined;
  if (scope.outside === 'read_only') return undefined;

  /*
    An empty scope matches NOTHING, and says so explicitly.

    `inArray(column, [])` is an error in some drivers and `IN ()` is invalid SQL, so a member scoped
    to no cities has to be answered with a false predicate rather than an empty list. It is a real
    state: the console can save a scope before any city is chosen.
  */
  if (scope.cityIds.length === 0) return sql`FALSE`;

  return inArray(cityColumn, scope.cityIds);
}
