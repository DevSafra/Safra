import { sql, type SQL } from 'drizzle-orm';

import { ADMIN_DISPLAY_NAME, ANONYMOUS_STAFF_ROLES } from '@safra/contracts';

/**
 * The SQL that substitutes «Admin» for a super admin's address, at the point of SELECT.
 *
 * ## Why in the query rather than in the console
 *
 * Because the point is that the address is never selected. Fetching an email and declining to
 * paint it looks identical on screen and protects nothing — it still travels to the browser, sits
 * in the response, and appears in anything that logs one. Substituting here means a super admin's
 * address does not leave the database on these paths at all.
 *
 * See `ADMIN_DISPLAY_NAME` in `@safra/contracts` for what this is for and what it deliberately
 * does not change: `actor_user_id` is untouched, so the record still says who acted.
 *
 * ## Why the columns are passed in rather than named here
 *
 * Every call site has a different alias — `u`, `us`, `db` — and the alternative is `sql.raw` over
 * a caller-supplied string, which is a habit worth not forming even where every caller is a
 * literal in our own code. Passing `sql` fragments keeps the identifiers where they are written
 * and keeps this file free of anything that could be handed a request value.
 *
 * Usage: `${actorName(sql`u.email`, sql`u.role`)} AS actor_email`
 */
/**
 * The roles that act under a pseudonym, as a SQL list.
 *
 * From `ANONYMOUS_STAFF_ROLES` rather than a `'super_admin'` literal. This file carried the literal
 * and the constant existed a package away for exactly this reason — the third site is where a copy
 * stops being a copy and becomes a disagreement.
 */
const anonymous = sql`(${sql.join(
  ANONYMOUS_STAFF_ROLES.map((role) => sql`${role}`),
  sql`, `,
)})`;

export function actorName(email: SQL, role: SQL): SQL {
  return sql`CASE WHEN ${role}::text IN ${anonymous} THEN ${ADMIN_DISPLAY_NAME} ELSE ${email} END`;
}

/**
 * A staff member's REAL NAME, withheld from the roles that act under a pseudonym.
 *
 * ## Why this exists, and it is not symmetry
 *
 * `users.full_name` arrived on 2026-08-23 and every audit read began selecting it raw, two lines
 * below `actorName`. So a super admin's address was substituted and their NAME was shipped beside
 * it — which defeats the pseudonym entirely, because a full name is no less an identity than an
 * address. Found by project-e9 on 2026-08-24, by changing a screen to prefer the name, rebuilding,
 * and LOOKING at it: three rows that had read «Admin» now read a person's name.
 *
 * **Every test stayed green.** The specs assert that the ADDRESS is absent — `not.toContain(email)`
 * — and a name is not an address. The assertion was written against the leak that existed, and the
 * new field walked around it. That is worth more than the bug: a privacy assertion phrased as "this
 * particular string is absent" only ever protects the string it names.
 *
 * ## NULL, not the pseudonym
 *
 * So every consumer falls through to `actorEmail`, which already reads «Admin». One place decides
 * and no screen has to remember. Returning the pseudonym here would put «Admin» in a NAME field,
 * and the next screen to show both would render «Admin (Admin)».
 */
export function actorRealName(fullName: SQL, role: SQL): SQL {
  return sql`CASE WHEN ${role}::text IN ${anonymous} THEN NULL ELSE ${fullName} END`;
}
