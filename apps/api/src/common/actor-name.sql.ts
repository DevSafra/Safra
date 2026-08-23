import { sql, type SQL } from 'drizzle-orm';

import { ADMIN_DISPLAY_NAME } from '@safra/contracts';

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
export function actorName(email: SQL, role: SQL): SQL {
  return sql`CASE WHEN ${role}::text = 'super_admin' THEN ${ADMIN_DISPLAY_NAME} ELSE ${email} END`;
}
