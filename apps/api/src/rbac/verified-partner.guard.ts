import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { forbidden } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export const VERIFIED_PARTNER_KEY = 'requiresVerifiedPartner';

/**
 * Marks a route that only a VERIFIED partner may call (step 7, Bashar 2026-08-19).
 *
 * «بعد التحقق يمكن للشريك إضافة/تعديل الأسعار والتواريخ والصور» — so a price, an available date
 * and an image are the three things this covers, and nothing else. A partner waiting on
 * verification can still write their listing's descriptive data, which is what makes the wait
 * useful rather than merely long.
 */
export const RequireVerifiedPartner = () => SetMetadata(VERIFIED_PARTNER_KEY, true);

/**
 * Refuses a price, a date or an image from a partner SAFRA has not verified yet.
 *
 * ## Why this reads the database on every gated request
 *
 * `PermissionsGuard` deliberately reads permissions from the token and accepts a 15-minute lag.
 * That trade is right for a permission and wrong here: verification is the moment a partner has
 * been waiting for, sometimes for days, and a partner who is told «تم التحقق من حسابك» and then
 * cannot set a price for a quarter of an hour will conclude the platform is broken and open a
 * support ticket. It is one indexed primary-key lookup on a path that is already writing.
 *
 * The reverse direction matters more: a partner whose verification is WITHDRAWN keeps a valid
 * token for up to fifteen minutes, and this closes that window.
 *
 * ## Deny by default, including when there is no partner at all
 *
 * No claims, no partner id, no row: refused. A guard that fell open on a missing row would make
 * every one of these routes reachable by any account whose partner record had been soft-deleted.
 *
 * ## Not a substitute for scoping
 *
 * This answers "may this partner set prices at all", never "on whose unit". The services still
 * derive the partner id from the token and carry it in their WHERE clauses; both are necessary and
 * neither is redundant.
 */
@Injectable()
export class VerifiedPartnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(VERIFIED_PARTNER_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!required) return true;

    const request = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    const partnerId = request.user?.partnerId;

    if (!partnerId) throw forbidden(ERROR.PARTNER_NOT_VERIFIED);

    const rows = await this.db.execute<{ verification: string }>(sql`
      SELECT verification::text AS verification
      FROM partners
      WHERE id = ${partnerId}::uuid AND deleted_at IS NULL
    `);

    /*
      `approved` and nothing else. `in_review` is not "nearly verified" — it means a human is
      looking — and a partner who could publish prices while under review would make the review
      pointless. Suspension is handled upstream by the session being revoked.
    */
    if (rows.rows[0]?.verification !== 'approved') {
      throw forbidden(ERROR.PARTNER_NOT_VERIFIED);
    }

    return true;
  }
}
