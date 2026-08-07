import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { z } from 'zod';

import { PERMISSIONS as P } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PayoutService } from './payout.service.js';

/**
 * A partner's own payouts (design handoff §7.1).
 *
 * Read-only, and scoped by the service to the `partnerId` in the VERIFIED token. There is no route
 * that names a partner, so "can this partner see that partner's transfers" is a question this
 * controller cannot be asked.
 *
 * A partner cannot release, hold or pay anything — those live on the staff controller below,
 * behind `PAYOUT_EXECUTE`, which only finance and super admin hold. Money leaving SAFRA is never
 * initiated by its recipient.
 */
@Controller('partner/payouts')
export class PartnerPayoutController {
  constructor(private readonly payouts: PayoutService) {}

  @Get()
  @RequirePermissions(P.PAYOUT_READ_OWN)
  @AuditExempt('A partner reading their own transfers; changes nothing.')
  async list(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.payouts.listForPartner(user);
  }

  /** What one payout covers — the answer to "what is this $1,240 for". */
  @Get(':reference/bookings')
  @RequirePermissions(P.PAYOUT_READ_OWN)
  @AuditExempt('A partner reading their own transfers; changes nothing.')
  async items(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.payouts.itemsForPartner(reference, user);
  }
}

const releaseSchema = z
  .object({
    /** The handoff's "مجدول يوم الخميس" — a date, not a timestamp. */
    scheduledFor: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    notes: z.string().trim().max(500).optional(),
  })
  .strict();

const paidSchema = z
  .object({
    /** The bank's own reference, so a partner's question can be answered against a statement. */
    paidReference: z.string().trim().min(1).max(120),
  })
  .strict();

const reasonSchema = z.object({ reason: z.string().trim().min(1).max(500) }).strict();

/**
 * Staff administration of payouts (§9.3, and the handoff's «صرف مستحقات الشركاء» permission row).
 *
 * ## Why release and payment are separate permissions from reading
 *
 * `PAYOUT_READ` is finance looking; `PAYOUT_EXECUTE` is money moving. §4.1 requires staff to hold
 * only what their role needs, and these are different decisions with different blast radii — the
 * same reasoning that keeps partner approval and listing publication apart.
 *
 * Every route here is audited by the service, one row per transition, because §15 requires a
 * record of who decided that money should move.
 */
@Controller('admin/payouts')
export class AdminPayoutController {
  constructor(private readonly payouts: PayoutService) {}

  /**
   * Sweeps newly-payable bookings into their partners' open periods.
   *
   * Idempotent, so a scheduler calling it every hour is safe. It is a POST rather than a GET
   * because it writes, even though it takes no body.
   */
  @Post('accrue')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @AuditExempt(
    'Bulk accrual; each payout carries its own audit trail on release and payment.',
  )
  async accrue() {
    return this.payouts.accrue();
  }

  @Post(':id/close')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutService as partner_payout.closed.')
  async close(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.payouts.close(id, user);
  }

  @Post(':id/release')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutService as partner_payout.released.')
  async release(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(releaseSchema)) body: z.infer<typeof releaseSchema>,
  ): Promise<void> {
    await this.payouts.release(id, body, user);
  }

  @Post(':id/paid')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt(
    'Audited by PayoutService as partner_payout.paid, alongside the ledger movement.',
  )
  async markPaid(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(paidSchema)) body: z.infer<typeof paidSchema>,
  ): Promise<void> {
    await this.payouts.markPaid(id, body, user);
  }

  @Post(':id/hold')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutService as partner_payout.held.')
  async hold(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ): Promise<void> {
    await this.payouts.hold(id, body, user);
  }

  @Post(':id/lift-hold')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutService as partner_payout.hold_lifted.')
  async liftHold(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
  ): Promise<void> {
    await this.payouts.release_hold(id, user);
  }

  @Post(':id/cancel')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @HttpCode(HttpStatus.NO_CONTENT)
  @AuditExempt('Audited by PayoutService as partner_payout.cancelled.')
  async cancel(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(reasonSchema)) body: z.infer<typeof reasonSchema>,
  ): Promise<void> {
    await this.payouts.cancel(id, body, user);
  }
}
