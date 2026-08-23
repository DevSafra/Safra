/**
 * What a super admin is CALLED wherever the platform shows who did something
 * (Bashar, 2026-08-23).
 *
 * ## Why "Admin" and not a person's address
 *
 * "When the super admin does something, it should be under the 'Admin' name." Two things follow
 * from that, and the second is the one worth writing down.
 *
 * The first is presentational: a partner reading «رفع العقد: bashar@…» learns a staff member's
 * address, which tells them nothing they need and gives them something to write to. «Admin» is the
 * platform speaking, which is what a super admin acting in that role IS.
 *
 * The second is a security property. Staff identities stop leaking onto surfaces that do not need
 * them — the same class as the staff email found in a log line on 2026-08-14. That property only
 * holds because the substitution happens in the QUERY: the address is never selected, so it never
 * reaches the browser to be hidden by rendering. A console that fetched the email and declined to
 * paint it would look identical and protect nothing.
 *
 * ## What it deliberately does NOT change
 *
 * `audit_log.actor_user_id` still holds the real account, and every one of these queries still
 * joins on it. A trail that cannot say who acted is not a trail — this changes the LABEL a reader
 * sees, never the record. Answering "which human did this" remains possible for anyone with
 * database access, which is the correct place for that question to be answerable and the correct
 * amount of friction.
 *
 * ## Why it is not in the i18n catalogue
 *
 * Every word a person reads comes from `@safra/i18n` — except the documented exceptions, which
 * include the brand wordmark and enum values. This is a NAME, not a label: Bashar chose the
 * literal string, it is the same in Arabic, English and German, and it is resolved in SQL where no
 * reader's locale is known. Translating it would make «Admin» read differently to a partner and to
 * the staff member who acted, which is the one thing a pseudonym must not do.
 *
 * That exception is RECORDED in `docs/i18n.md` §4 rather than argued here, because the rule is
 * that a new exception goes in the reference rather than being invented locally — otherwise the
 * next person finds a hard-coded Latin string in a SQL file and correctly tries to remove it.
 */
export const ADMIN_DISPLAY_NAME = 'Admin';

/**
 * The roles that are shown as `ADMIN_DISPLAY_NAME` rather than by address.
 *
 * Only `super_admin`. An operations manager or a finance officer acting on a partner IS a named
 * colleague, and a partner querying a decision should be able to say who made it — the anonymity
 * here is specific to the account that speaks for the platform, not a general policy of hiding
 * staff.
 */
export const ANONYMOUS_STAFF_ROLES = ['super_admin'] as const;

/**
 * Whether a role is shown by its platform name instead of the account's address.
 *
 * Reads `ANONYMOUS_STAFF_ROLES` rather than repeating `=== 'super_admin'`. The two were written
 * separately and could have disagreed, which on this particular pair means a role that the list
 * says is anonymous and the predicate says is not — a privacy rule that is true in the constant
 * and false in the code that enforces it.
 */
export function isAnonymousStaffRole(role: string | null | undefined): boolean {
  if (role === null || role === undefined) return false;

  return (ANONYMOUS_STAFF_ROLES as readonly string[]).includes(role);
}

/**
 * Resolves a stored actor into what a reader should see.
 *
 * The console-side companion to the SQL expression, for the two payloads that already carry a
 * role and cannot cheaply be changed to carry a resolved name instead. Same rule, one definition.
 */
export function actorDisplayName(
  email: string | null | undefined,
  role: string | null | undefined,
): string | null {
  if (isAnonymousStaffRole(role)) return ADMIN_DISPLAY_NAME;

  return email ?? null;
}
