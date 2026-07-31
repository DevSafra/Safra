import { Controller, ForbiddenException, Get, Query } from '@nestjs/common';

import { PERMISSIONS as P, type CursorQuery, cursorQuerySchema } from '@safra/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { WalletService } from './wallet.service.js';

/**
 * The customer's own wallet (SRS §2.3).
 *
 * This endpoint is why the wallet module exists. §6.4 has been crediting
 * compensation into wallets since the SLA sweep shipped — a customer whose partner
 * missed the confirmation window is owed real money, and until now there was no way
 * for them to see that it had arrived.
 *
 * Scoped to the caller's OWN profile with no id parameter anywhere. Staff read a
 * wallet through the admin route, which is separately permissioned and audited;
 * there is deliberately no `?customerProfileId=` on this one to get wrong.
 */
@Controller('wallet')
export class WalletController {
  constructor(private readonly wallet: WalletService) {}

  /**
   * Balance, or an explicit "no wallet yet".
   *
   * Returns 200 with `wallet: null` rather than 404. A customer who has never been
   * compensated is not an error, and a 404 here would have the web app render a
   * failure state for the overwhelmingly common case.
   */
  @Get()
  async balance(@CurrentUser() user: AccessTokenClaims | undefined) {
    const wallet = await this.wallet.findByCustomer(requireCustomerProfileId(user));

    return {
      wallet: wallet
        ? {
            balance: wallet.balance,
            currencyCode: wallet.currencyCode,
          }
        : null,
    };
  }

  /** The statement (§2.3): every movement, newest first, cursor-paginated. */
  @Get('transactions')
  async transactions(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const wallet = await this.wallet.findByCustomer(requireCustomerProfileId(user));

    // No wallet means no movements. An empty page is the honest answer and keeps
    // the client from special-casing a 404 it would only ever render as "empty".
    if (!wallet) return { items: [], nextCursor: null };

    return this.wallet.listTransactions(wallet.walletId, query);
  }
}

/**
 * The caller's own profile id, or a refusal.
 *
 * Not `resolveScope`: there is no `all` variant of "my wallet" — a staff member
 * holding WALLET_READ reads a customer's balance through the admin route, where it
 * is audited. Widening this route for them would create an unaudited read path to
 * every customer's money.
 *
 * Fails closed the same way `resolveScope` does: a token carrying the permission
 * but no owning id resolves to a refusal, never to an unscoped query.
 */
function requireCustomerProfileId(claims: AccessTokenClaims | undefined): string {
  if (!claims) {
    throw new ForbiddenException('Authentication required.');
  }

  if (!(claims.permissions ?? []).includes(P.WALLET_READ)) {
    throw new ForbiddenException(`Missing required permission: ${P.WALLET_READ}.`);
  }

  if (!claims.customerProfileId) {
    throw new ForbiddenException('This account has no customer profile.');
  }

  return claims.customerProfileId;
}
