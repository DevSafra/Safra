import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';

import {
  UNSCOPED,
  canWriteInCity,
  isRestricted,
  type StaffScope,
} from '@safra/contracts';

import type { AccessTokenClaims } from '../auth/token.service.js';

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
    throw new ForbiddenException('This record is outside your assigned scope.');
  }

  throw new NotFoundException('Not found.');
}
