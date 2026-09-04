import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

import {
  PERMISSIONS as P,
  safraPayoutAccountInputSchema,
  safraPayoutAccountRejectSchema,
  safraPayoutAccountUpdateSchema,
  safraPayoutOpenSchema,
  safraPayoutPaidSchema,
  safraPayoutReasonSchema,
  type SafraPayoutAccountInput,
  type SafraPayoutAccountUpdateInput,
  type SafraPayoutOpenInput,
  type SafraPayoutPaidInput,
  type SafraPayoutReasonInput,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { SafraPayoutService } from './safra-payout.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * SAFRA's own treasury — destinations and revenue transfers (Bashar, 2026-09-05).
 *
 * ## Two authorities, and the split is the control
 *
 * `SAFRA_PAYOUT_MANAGE` enters and verifies a destination. `SAFRA_PAYOUT_EXECUTE` moves the money.
 * Reading is `LEDGER_READ`, which finance already holds — the summary is a question about the books
 * and anybody who may read them may ask it.
 *
 * The split exists so that "who may name the account SAFRA's revenue goes to" and "who may send it
 * there" can be different people. Collapsing them into one permission would make four-eyes on this
 * flow inexpressible, which on the platform's own money is the wrong thing to make impossible.
 *
 * ## Its own path, deliberately far from the partner one
 *
 * `/admin/safra-payouts`, not a branch of `/admin/payouts`. A route that took «whose payout» as a
 * parameter would put the two flows one typo apart, and paying SAFRA's revenue into a partner's
 * account is the worst outcome this feature has.
 */
@Controller('admin/safra-payouts')
export class SafraPayoutController {
  constructor(private readonly safra: SafraPayoutService) {}

  // ── Revenue ───────────────────────────────────────────────────────────────

  /** Accrued, transferred and outstanding — derived from the ledger, never stored. */
  @Get('revenue')
  @RequirePermissions(P.LEDGER_READ)
  async revenue() {
    return this.safra.revenueSummary();
  }

  // ── Destinations ──────────────────────────────────────────────────────────

  @Get('accounts')
  @RequirePermissions(P.LEDGER_READ)
  async accounts() {
    return { accounts: await this.safra.accounts() };
  }

  @Post('accounts')
  @RequirePermissions(P.SAFRA_PAYOUT_MANAGE)
  @AuditExempt(
    'SafraPayoutService records safra_payout_account.created in the transaction.',
  )
  async createAccount(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(safraPayoutAccountInputSchema))
    body: SafraPayoutAccountInput,
  ) {
    return this.safra.createAccount(user, body);
  }

  @Patch('accounts/:id')
  @RequirePermissions(P.SAFRA_PAYOUT_MANAGE)
  @AuditExempt(
    'SafraPayoutService records safra_payout_account.updated in the transaction.',
  )
  async updateAccount(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(safraPayoutAccountUpdateSchema))
    body: SafraPayoutAccountUpdateInput,
  ) {
    await this.safra.updateAccount(user, id, body);

    return { updated: true };
  }

  @Post('accounts/:id/verify')
  @RequirePermissions(P.SAFRA_PAYOUT_MANAGE)
  @AuditExempt(
    'SafraPayoutService records safra_payout_account.verified in the transaction.',
  )
  async verifyAccount(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ) {
    await this.safra.verifyAccount(user, id);

    return { verified: true };
  }

  @Post('accounts/:id/reject')
  @RequirePermissions(P.SAFRA_PAYOUT_MANAGE)
  @AuditExempt(
    'SafraPayoutService records safra_payout_account.rejected in the transaction.',
  )
  async rejectAccount(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(safraPayoutAccountRejectSchema))
    body: SafraPayoutReasonInput,
  ) {
    await this.safra.rejectAccount(user, id, body);

    return { rejected: true };
  }

  @Delete('accounts/:id')
  @RequirePermissions(P.SAFRA_PAYOUT_MANAGE)
  @AuditExempt(
    'SafraPayoutService records safra_payout_account.deleted in the transaction.',
  )
  async removeAccount(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ) {
    await this.safra.removeAccount(user, id);

    return { deleted: true };
  }

  // ── Transfers ─────────────────────────────────────────────────────────────

  @Get()
  @RequirePermissions(P.LEDGER_READ)
  async list() {
    return { payouts: await this.safra.payouts() };
  }

  /**
   * Opening one is `EXECUTE`, not `MANAGE`.
   *
   * It computes what a transfer will settle and claims a period nothing else may claim — the first
   * step of moving money rather than a piece of configuration.
   */
  @Post()
  @RequirePermissions(P.SAFRA_PAYOUT_EXECUTE)
  @AuditExempt('SafraPayoutService records safra_payout.opened in the transaction.')
  async open(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(safraPayoutOpenSchema)) body: SafraPayoutOpenInput,
  ) {
    return this.safra.open(user, body);
  }

  @Post(':id/release')
  @RequirePermissions(P.SAFRA_PAYOUT_EXECUTE)
  @AuditExempt('SafraPayoutService records safra_payout.released in the transaction.')
  async release(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ) {
    await this.safra.release(user, id);

    return { released: true };
  }

  @Post(':id/paid')
  @RequirePermissions(P.SAFRA_PAYOUT_EXECUTE)
  @AuditExempt('SafraPayoutService records safra_payout.paid in the transaction.')
  async markPaid(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(safraPayoutPaidSchema)) body: SafraPayoutPaidInput,
  ) {
    await this.safra.markPaid(user, id, body);

    return { paid: true };
  }

  @Post(':id/hold')
  @RequirePermissions(P.SAFRA_PAYOUT_EXECUTE)
  @AuditExempt('SafraPayoutService records safra_payout.held in the transaction.')
  async hold(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(safraPayoutReasonSchema)) body: SafraPayoutReasonInput,
  ) {
    await this.safra.hold(user, id, body);

    return { held: true };
  }

  @Post(':id/cancel')
  @RequirePermissions(P.SAFRA_PAYOUT_EXECUTE)
  @AuditExempt('SafraPayoutService records safra_payout.cancelled in the transaction.')
  async cancel(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(safraPayoutReasonSchema)) body: SafraPayoutReasonInput,
  ) {
    await this.safra.cancel(user, id, body);

    return { cancelled: true };
  }
}
