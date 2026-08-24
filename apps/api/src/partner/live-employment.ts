import { and, eq, isNull } from 'drizzle-orm';

import { schema, type Database } from '@safra/db';

/**
 * The ONE definition of "this account currently works for a partner".
 *
 * ## Why it is a function rather than a condition repeated in two files
 *
 * It had three encodings — the token builder, the invitation redemption, and the list projection —
 * and they drifted by exactly one condition: redemption checked the employer's `deleted_at` and
 * `suspended_at` but not the ROLE's `deleted_at`, while the token builder checked all three.
 *
 * A person fell through that gap. A super admin withdraws a role; somebody holding an invitation
 * against it clicks the link; activation SUCCEEDS — password set, role raised, address verified,
 * «تم تفعيل الحساب» — and then they sign in to an account with no partner and no permissions,
 * because the token builder does check the role. A flow that reports success while the person
 * cannot use the account is the exact failure Bashar hit on the onboarding screen the same morning.
 *
 * Two predicates that agree by luck will drift again. One function cannot.
 *
 * ## What "live" requires, and why each part
 *
 * - the employment row is not soft-deleted — they still work here
 * - its status is `active` — the partner has not suspended them
 * - the ROLE is not withdrawn — there is a permission set to resolve
 * - the employer is not soft-deleted and not suspended — the business is still trading
 *
 * Any one of those failing means there is nothing to resolve, so the caller gets `null` and every
 * caller fails closed on it.
 */
export async function findLiveEmployment(
  db: Database,
  userId: string,
): Promise<{ partnerId: string; permissions: string[] } | null> {
  const rows = await db
    .select({
      partnerId: schema.partnerEmployees.partnerId,
      permissions: schema.partnerEmployeeRoles.permissions,
    })
    .from(schema.partnerEmployees)
    .innerJoin(
      schema.partnerEmployeeRoles,
      eq(schema.partnerEmployeeRoles.id, schema.partnerEmployees.roleId),
    )
    .innerJoin(schema.partners, eq(schema.partners.id, schema.partnerEmployees.partnerId))
    .where(
      and(
        eq(schema.partnerEmployees.userId, userId),
        eq(schema.partnerEmployees.status, 'active'),
        isNull(schema.partnerEmployees.deletedAt),
        isNull(schema.partnerEmployeeRoles.deletedAt),
        isNull(schema.partners.deletedAt),
        /*
          Suspension is NOT filtered here (Bashar, 2026-08-24), matching the owner branch.

          It was, and the consequence was worse for an employee than for the owner: a receptionist
          at a suspended business got a token with no partner and no permissions, so their portal
          rendered empty with nothing anywhere explaining why — not even the suspension notice,
          which needs the partner scope to be read at all.

          Suspension is an enforcement action against a BUSINESS, and the people who work there
          still need to see what has happened to it. What they may not do is enforced per action by
          `SuspendedPartnerGuard`, which reads the column at request time — so an employee is
          refused exactly the same writes as the owner, and told the same reason.
        */
      ),
    )
    .limit(1);

  return rows[0] ?? null;
}
