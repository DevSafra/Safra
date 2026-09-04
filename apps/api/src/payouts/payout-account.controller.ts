import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';

import {
  PERMISSIONS as P,
  type PayoutAccountInput,
  type PayoutAccountReject,
  payoutAccountInputSchema,
  payoutAccountRejectSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { RefusedWhileSuspended } from '../rbac/suspended-partner.guard.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PayoutAccountService } from './payout-account.service.js';

/**
 * A partner maintaining their own transfer details (Bashar, 2026-09-04).
 *
 * No route here names a partner. The service reads `partnerId` from the VERIFIED token, so "can
 * this partner edit that partner's bank details" is a question this controller cannot be asked —
 * the same shape as `PartnerPayoutController` above it, and the only shape that cannot be got
 * wrong by a caller.
 *
 * `PAYOUT_ACCOUNT_MANAGE_OWN` is held by the OWNER and not by partner employees, so a receptionist
 * reaching this by a typed URL is refused by the permission rather than by a hidden nav item.
 *
 * Nothing here can verify anything. A partner approving their own destination would make the
 * control meaningless, and there is no route to it on this controller at all — not a permission
 * check that could be misconfigured, an absence.
 */
@Controller('partner/payout-accounts')
export class PartnerPayoutAccountController {
  constructor(private readonly accounts: PayoutAccountService) {}

  @Get()
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE_OWN)
  @AuditExempt('A partner reading their own transfer details; changes nothing.')
  async list(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.accounts.listOwn(user);
  }

  /*
    Refused while the partner is suspended, like every other partner write. A suspended partner is
    one SAFRA has stopped paying, and letting them redirect the destination in the meantime is the
    precise combination this guard exists for.
  */
  @Post()
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE_OWN)
  @RefusedWhileSuspended()
  @AuditExempt('Audited by PayoutAccountService as payout_account.added.')
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(payoutAccountInputSchema)) body: PayoutAccountInput,
  ) {
    return this.accounts.createOwn(body, user);
  }

  /* PUT, not PATCH: every field is re-sent, so a partial body cannot leave half an account. */
  @Put(':id')
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE_OWN)
  @RefusedWhileSuspended()
  @AuditExempt('Audited by PayoutAccountService as payout_account.updated.')
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutAccountInputSchema)) body: PayoutAccountInput,
  ) {
    return this.accounts.updateOwn(id, body, user);
  }

  @Delete(':id')
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE_OWN)
  @RefusedWhileSuspended()
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutAccountService as payout_account.removed.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.accounts.removeOwn(id, user);
  }
}

/**
 * Staff entering, correcting and approving a partner's transfer details.
 *
 * ## Three permissions, not one
 *
 * `PAYOUT_ACCOUNT_READ` to look, `PAYOUT_ACCOUNT_MANAGE` to type, `PAYOUT_ACCOUNT_VERIFY` to
 * approve. Splitting the last two is what lets an organisation require that the person who enters
 * a bank account and the person who approves it are two different people; the service enforces
 * that on the actor, and these decorators are what make it configurable per role.
 *
 * ## Writes are addressed by the partner, reads and edits by the account
 *
 * Creating names the partner's public reference, because that is the thing staff have in front of
 * them. Everything afterwards names the account id, which already carries its partner — passing
 * both would invite a caller to send an id belonging to one partner under another's reference, and
 * then something has to decide which of the two wins.
 */
@Controller('admin')
export class AdminPayoutAccountController {
  constructor(private readonly accounts: PayoutAccountService) {}

  @Get('partners/:reference/payout-accounts')
  @RequirePermissions(P.PAYOUT_ACCOUNT_READ)
  @AuditExempt('A masked read of transfer details; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.accounts.listForPartner(reference, user);
  }

  @Post('partners/:reference/payout-accounts')
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE)
  @AuditExempt('Audited by PayoutAccountService as payout_account.added.')
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(payoutAccountInputSchema)) body: PayoutAccountInput,
  ) {
    return this.accounts.createForPartner(reference, body, user);
  }

  @Put('payout-accounts/:id')
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE)
  @AuditExempt('Audited by PayoutAccountService as payout_account.updated.')
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutAccountInputSchema)) body: PayoutAccountInput,
  ) {
    return this.accounts.updateForPartner(id, body, user);
  }

  @Post('payout-accounts/:id/verify')
  @RequirePermissions(P.PAYOUT_ACCOUNT_VERIFY)
  @AuditExempt('Audited by PayoutAccountService as payout_account.verified.')
  async verify(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ) {
    return this.accounts.verify(id, user);
  }

  @Post('payout-accounts/:id/reject')
  @RequirePermissions(P.PAYOUT_ACCOUNT_VERIFY)
  @AuditExempt('Audited by PayoutAccountService as payout_account.rejected.')
  async reject(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(payoutAccountRejectSchema)) body: PayoutAccountReject,
  ) {
    return this.accounts.reject(id, body.reason, user);
  }

  @Delete('payout-accounts/:id')
  @RequirePermissions(P.PAYOUT_ACCOUNT_MANAGE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutAccountService as payout_account.removed.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.accounts.removeForPartner(id, user);
  }
}
