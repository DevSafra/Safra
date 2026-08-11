import { Controller, Get, Param, Query } from '@nestjs/common';

import { invoiceQuerySchema, type InvoiceQuery } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { InvoicesService } from './invoices.service.js';

/**
 * الفواتير (handoff §6).
 *
 * Read-only, and there is no write planned: a receipt is a VIEW of a booking, so the way to change one
 * is to change the booking. Both handlers derive the customer from the verified token and take no
 * customer id, so "show me somebody else's receipts" is a question this controller cannot be asked.
 *
 * No permission decorator, because there is no permission to hold — reading your own receipts is
 * something any signed-in customer may do, and the absence of a customer profile on the token is what
 * refuses a partner or a staff member.
 */
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly invoices: InvoicesService) {}

  @Get()
  @AuditExempt('A customer reading their own receipt list; changes nothing.')
  async list(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(invoiceQuerySchema)) query: InvoiceQuery,
  ) {
    return this.invoices.list(user, query);
  }

  /**
   * One receipt in full.
   *
   * The reference is bounded and then compared inside a query that already carries the caller's own
   * profile, so a guessed reference finds nothing rather than being found and then refused.
   */
  @Get(':reference')
  @AuditExempt('A customer reading one of their own receipts; changes nothing.')
  async one(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.invoices.one(user, reference);
  }
}
