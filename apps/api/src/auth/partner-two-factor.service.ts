import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { ERROR, type PartnerTwoFactorResetResponse } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { forbidden, notFound, unauthorized } from '../common/errors/app-error.js';
import { assertCanWrite, scopeCondition } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from './token.service.js';

/**
 * Clearing a partner's second factor, so they can enrol a new authenticator.
 *
 * ## Why this exists
 *
 * Partner 2FA is mandatory (Bashar, 2026-08-07). A mandatory second factor without a reset path is
 * not a security control, it is a way to lose a partner: the phone breaks, the recovery codes are
 * in the drawer of an office they no longer rent, and the account holding their listings and their
 * money is gone. Every mandatory-2FA system needs an operator-driven way back in, and the only
 * question is what that path is allowed to do.
 *
 * ## What it deliberately cannot do
 *
 * **It only CLEARS.** It never sets a secret, never returns one, never accepts one. A staff member
 * therefore never holds — even momentarily — a credential that authenticates as the partner. The
 * partner enrols again from their own session, and the recovery codes that come out of that
 * enrolment are generated for them and shown only to them.
 *
 * **It refuses any target that is not a partner.** This is the escalation guard and it is the
 * reason the check is here rather than left to the permission alone. Without it,
 * `PARTNER_TWO_FACTOR_RESET` would be a way for an operations manager to strip a factor from a
 * super admin's account and then need only a password — turning a partner-support tool into a
 * privilege-escalation primitive. The permission says who may act; this says on whom.
 *
 * **It ends every session the partner holds.** Not politeness: the account's authentication has
 * just been weakened, so any token issued under the old, stronger arrangement must not survive it.
 * It also makes the outcome unambiguous for the partner — they are signed out, they sign in, they
 * are required to enrol, exactly as a brand-new partner is.
 *
 * ## Idempotent on purpose
 *
 * Resetting a partner who has not enrolled succeeds and does nothing but revoke and audit. The
 * alternative — refusing — would fail in precisely the situation an operator most often faces: a
 * partner stuck halfway through enrolment, with a pending secret and no `totp_enabled_at`, asking
 * for help. That state should be clearable, and asking the operator to first determine which of
 * two indistinguishable states the account is in is a way to make support harder for no gain.
 */
@Injectable()
export class PartnerTwoFactorService {
  private readonly logger = new Logger(PartnerTwoFactorService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  async reset(
    actor: AccessTokenClaims | undefined,
    reference: string,
    reason: string,
  ): Promise<PartnerTwoFactorResetResponse> {
    if (!actor) throw unauthorized(ERROR.AUTH_REQUIRED);

    /*
      Scoped by the partner's city (`O-sec-13`, 2026-08-27).

      A reset clears the second factor on somebody else's account and issues them a new enrolment —
      the strongest single action in the console short of a suspension — and it was reachable for
      any partner in the country by reference. `assertCanWrite` refuses the `read_only` member that
      the predicate deliberately lets through.
    */
    const partner = await this.db.query.partners.findFirst({
      where: and(
        eq(schema.partners.reference, reference),
        isNull(schema.partners.deletedAt),
        scopeCondition(actor, schema.partners.cityId),
      ),
      columns: {
        id: true,
        reference: true,
        displayName: true,
        userId: true,
        cityId: true,
      },
    });

    if (!partner) throw notFound(ERROR.PARTNER_NOT_FOUND);

    assertCanWrite(actor, partner.cityId);
    if (!partner.userId) throw notFound(ERROR.PARTNER_TWO_FACTOR_NO_ACCOUNT);

    const target = await this.db.query.users.findFirst({
      where: eq(schema.users.id, partner.userId),
      columns: { id: true, role: true, totpEnabledAt: true },
    });

    if (!target) throw notFound(ERROR.PARTNER_TWO_FACTOR_NO_ACCOUNT);

    /*
      The escalation guard. A partner record whose user row is somehow not a partner is either
      corrupt data or an attempt, and neither is a case to proceed through.
    */
    if (target.role !== 'partner') {
      this.logger.warn(
        `Refused a partner 2FA reset for ${partner.reference}: the account behind it has role ` +
          `${target.role}, not partner. Actor ${actor.sub}.`,
      );
      throw forbidden(ERROR.PARTNER_TWO_FACTOR_TARGET_NOT_PARTNER);
    }

    const wasEnrolled = target.totpEnabledAt !== null;

    return this.db.transaction(async (tx) => {
      await tx
        .update(schema.users)
        .set({
          totpEnabledAt: null,
          /*
            The pending secret goes too, not only the enabled flag. Leaving it would let whoever
            still has the old authenticator complete enrolment against the SAME secret — the reset
            would have removed the requirement without removing the credential.
          */
          totpSecretEncrypted: null,
          totpRecoveryCodeHashes: [],
        })
        .where(eq(schema.users.id, target.id));

      const revoked = await tx
        .update(schema.refreshTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.refreshTokens.userId, target.id),
            isNull(schema.refreshTokens.revokedAt),
          ),
        )
        .returning({ id: schema.refreshTokens.id });

      await this.audit.record(
        {
          actorUserId: actor.sub,
          actorRole: actor.role,
          action: 'partner.two_factor_reset',
          subjectType: 'user',
          subjectId: target.id,
          /*
            The reason and the prior state, never a secret or a code. `wasEnrolled` is what makes
            the row answerable later: a reset of an account that had nothing enrolled is a
            different event from one that removed a working factor, and the audit log is the only
            place that distinction survives.
          */
          after: {
            reason,
            partnerReference: partner.reference,
            wasEnrolled,
            sessionsRevoked: revoked.length,
          },
        },
        tx as unknown as Database,
      );

      return { twoFactorEnabled: false, sessionsRevoked: revoked.length };
    });
  }
}
