import {
  Inject,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { forbidden } from '../common/errors/app-error.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

export const SUSPENDED_REFUSES_KEY = 'safra:refused-while-suspended';

/**
 * Marks a route that a SUSPENDED partner may not use.
 *
 * ## Opt-in, and that is the policy rather than caution
 *
 * Bashar, 2026-08-24: a suspended partner *"may still sign in and view their account"* and *"may
 * view the suspension reason and relevant notices."* So the default is ALLOWED, and each route that
 * a suspension actually blocks says so. A guard applied by default would have to be exempted on
 * every read, and the exemption list would become the thing nobody maintains — the failure this
 * project has already had twice with exemptions that outlived their reasons.
 *
 * ## What suspension blocks, from the policy
 *
 * New properties. Publishing, modifying or activating an existing one. Prices and calendars, since
 * both are how a listing is offered. What it does NOT block is reading anything, support, or the
 * account itself — and it does not touch a confirmed booking or a guest, which is enforced by this
 * guard being absent from those routes rather than by anything it does.
 */
export const RefusedWhileSuspended = () => SetMetadata(SUSPENDED_REFUSES_KEY, true);

/**
 * Refuses a marked route while the partner is suspended.
 *
 * ## Read at request time, not from the token
 *
 * The claim would be cheaper and it would be wrong in the direction that matters: a partner
 * suspended a minute ago holds a token minted before it, and ADR 0003's fifteen minutes of
 * permission staleness is a trade made for permissions that GRANT. Suspension takes away, and the
 * same reasoning that makes `SettingsService` revoke sessions when a grant is switched off applies
 * here — taking authority away has to be immediate.
 *
 * One indexed primary-key lookup, on routes that are already writing.
 *
 * ## Why the token no longer strips `partnerId` for a suspended partner
 *
 * It used to: `attachOwningIds` filtered `suspendedAt`, so a suspended owner got a token with no
 * partner and no permissions, and their portal rendered as though the business did not exist. That
 * was a deliberate hardening and the policy overrules it — they sign in, they read their account,
 * they read why. So enforcement moved from one filter at token-build time to per-action checks, of
 * which this guard is the main one.
 */
@Injectable()
export class SuspendedPartnerGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const refuses = this.reflector.getAllAndOverride<boolean>(SUSPENDED_REFUSES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!refuses) return true;

    const request = context.switchToHttp().getRequest<{ user?: AccessTokenClaims }>();
    const partnerId = request.user?.partnerId;

    if (!partnerId) return true;

    const rows = await this.db.execute<{ suspended: boolean }>(sql`
      SELECT (suspended_at IS NOT NULL) AS suspended
      FROM partners WHERE id = ${partnerId}::uuid AND deleted_at IS NULL
      LIMIT 1
    `);

    /*
      Its own code, not `PERMISSION_DENIED`. `partnerFetch` collapses 401 and 403 into
      `'unauthenticated'`, so without something the portal can recognise, a suspended partner is
      told their session expired and sent to sign in again — over a state that signing in cannot
      change. The portal reads this code and shows the suspension instead.
    */
    if (rows.rows[0]?.suspended) throw forbidden(ERROR.PARTNER_SUSPENDED);

    return true;
  }
}
