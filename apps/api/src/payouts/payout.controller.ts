import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { z } from 'zod';

import {
  PAYOUT_STATUSES,
  PERMISSIONS as P,
  pageQuerySchema,
  payoutPaidSchema,
  payoutReasonSchema,
  payoutReleaseSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { PayoutScheduler } from './payout.scheduler.js';
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

/*
  The action schemas live in `@safra/contracts` so the console's forms validate against the same
  definition the API enforces. They were declared here until the console grew screens that post to
  these routes — at which point a second copy would have been a second set of rules.
*/
const releaseSchema = payoutReleaseSchema;
const paidSchema = payoutPaidSchema;
const reasonSchema = payoutReasonSchema;

/**
 * The registry's filters.
 *
 * `.strict()` via `pageQuerySchema`, so an unknown parameter is a 400 rather than a filter that
 * silently does nothing — a reader who mistypes `?statuss=paid` must not be shown everything while
 * believing they narrowed it.
 *
 * `status` is an ENUM rather than a string reaching a cast. `${'$'}{query.status}::payout_status`
 * with arbitrary text would be a parameterised cast and therefore not injectable, but it would
 * still 500 on anything that is not a member; an allow-list answers 400 with a useful message.
 */
const payoutListQuerySchema = pageQuerySchema.extend({
  status: z.enum(PAYOUT_STATUSES).optional(),
  q: z.string().trim().min(1).max(80).optional(),
});

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
  constructor(
    private readonly payouts: PayoutService,
    private readonly scheduler: PayoutScheduler,
  ) {}

  /**
   * Sweeps newly-payable bookings into their partners' open periods.
   *
   * Idempotent, so a scheduler calling it every hour is safe. It is a POST rather than a GET
   * because it writes, even though it takes no body.
   */
  /**
   * The payout registry (§9.3).
   *
   * `PAYOUT_READ`, not `PAYOUT_EXECUTE`: reading what SAFRA owes and has sent is finance's daily
   * work, and moving the money is a separate decision. Before this existed the console could act on
   * a payout but never see one — every action route took an id an operator had no way to obtain
   * except by querying the database.
   */
  @Get()
  @RequirePermissions(P.PAYOUT_READ)
  @AuditExempt('Reading the payout registry; changes nothing.')
  async list(
    @Query(new ZodValidationPipe(payoutListQuerySchema))
    query: z.infer<typeof payoutListQuerySchema>,
  ) {
    return this.payouts.listForStaff(query);
  }

  /**
   * One payout: what it covers, who decided it, and the ledger movement it discharged.
   *
   * Keyed on the human REFERENCE rather than the id, so the URL an operator shares is the one
   * printed on the row. The action routes below still take the id, because they are posted by the
   * screen this returns rather than typed by anybody.
   */
  @Get(':reference')
  @RequirePermissions(P.PAYOUT_READ)
  @AuditExempt('Reading one payout; changes nothing.')
  async detail(@Param('reference') reference: string) {
    return this.payouts.detailForStaff(reference);
  }

  @Post('accrue')
  @RequirePermissions(P.PAYOUT_EXECUTE)
  @AuditExempt(
    'Bulk accrual; each payout carries its own audit trail on release and payment.',
  )
  async accrue() {
    /*
      Through the SCHEDULER, not straight to the service.

      A hand-run has to land in `scheduled_job_runs` like any other, or the console's "last
      accrual" footnote and the runbook's "run it again" step disagree about whether anything
      happened. It also shares the advisory lock, so a manual run during a scheduled one skips
      instead of racing it.
    */
    await this.scheduler.run();

    return this.payouts.latestAccrual();
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
