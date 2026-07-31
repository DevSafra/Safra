import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';

import {
  PERMISSIONS as P,
  type CursorQuery,
  type WalletAdjustInput,
  cursorQuerySchema,
  walletAdjustSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { WalletAdjustmentService } from './wallet-adjustment.service.js';
import { WalletService } from './wallet.service.js';

/**
 * Staff-side wallet access (SRS §2.3, §4.1, §9.3).
 *
 * Split from the customer controller rather than sharing routes with a scope
 * check. Reading any customer's balance and moving it by hand are different
 * privileges from reading your own, and keeping them on separate paths means the
 * permissive route can never accidentally inherit the permissive branch of a
 * shared one.
 *
 * `WALLET_READ` is held by support, finance and super admin — support needs to see
 * that compensation landed to answer a ticket. `WALLET_ADJUST` is finance and super
 * admin only: §4 explicitly denies support agents financial actions.
 */
@Controller('admin/wallets')
export class WalletAdminController {
  constructor(
    private readonly wallet: WalletService,
    private readonly adjustments: WalletAdjustmentService,
  ) {}

  /** A customer's balance and, unlike the customer route, its internal wallet id. */
  @Get(':customerProfileId')
  @RequirePermissions(P.WALLET_READ)
  async balance(@Param('customerProfileId', ParseUUIDPipe) customerProfileId: string) {
    const wallet = await this.wallet.findByCustomer(customerProfileId);

    if (!wallet) throw new NotFoundException('This customer has no wallet.');

    return {
      walletId: wallet.walletId,
      balance: wallet.balance,
      currencyCode: wallet.currencyCode,
      /**
       * The recomputed total alongside the cached one, so a support or finance
       * screen surfaces drift instead of hiding it. They must always agree — both
       * are written under a row lock in one transaction — and if they ever do not,
       * the person looking at a disputed balance is exactly who should find out.
       */
      reconciledBalance: await this.wallet.sumTransactions(wallet.walletId),
    };
  }

  @Get(':customerProfileId/transactions')
  @RequirePermissions(P.WALLET_READ)
  async transactions(
    @Param('customerProfileId', ParseUUIDPipe) customerProfileId: string,
    @Query(new ZodValidationPipe(cursorQuerySchema)) query: CursorQuery,
  ) {
    const wallet = await this.wallet.findByCustomer(customerProfileId);

    if (!wallet) throw new NotFoundException('This customer has no wallet.');

    return this.wallet.listTransactions(wallet.walletId, query);
  }

  /**
   * Moves a balance by hand (§4.1).
   *
   * Throttled hard. This is the one route in the system that transfers money on a
   * staff member's say-so, so a compromised finance session should be able to do it
   * a handful of times before being rate-limited, not thousands.
   */
  @Post(':customerProfileId/adjust')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.WALLET_ADJUST)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt(
    'WalletAdjustmentService records wallet.adjusted inside the movement ' +
      'transaction, with the balance either side of it — the interceptor resolves ' +
      'its subject from a route param and would capture neither.',
  )
  async adjust(
    @Param('customerProfileId', ParseUUIDPipe) customerProfileId: string,
    @Body(new ZodValidationPipe(walletAdjustSchema)) body: WalletAdjustInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    const result = await this.adjustments.adjust(customerProfileId, body, {
      userId: user?.sub,
      role: user?.role,
    });

    return {
      walletId: result.walletId,
      balance: result.balance,
      currencyCode: result.currencyCode,
      appliedAmount: result.appliedAmount,
    };
  }
}
