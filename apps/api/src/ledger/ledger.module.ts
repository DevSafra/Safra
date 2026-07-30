import { Controller, Get, Global, Module } from '@nestjs/common';

import { PERMISSIONS as P } from '@safra/contracts';

import { RequirePermissions } from '../rbac/decorators.js';
import { LedgerService } from './ledger.service.js';

/**
 * Finance-only read of the books (§9.3 "Payments and invoices").
 *
 * A trial balance that does not balance means the books are broken, so it is exposed
 * as a first-class check rather than something to discover in a monthly report.
 */
@Controller('admin/ledger')
class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Get('trial-balance')
  @RequirePermissions(P.LEDGER_READ)
  async trialBalance() {
    return this.ledger.trialBalance();
  }
}

@Global()
@Module({
  controllers: [LedgerController],
  providers: [LedgerService],
  exports: [LedgerService],
})
export class LedgerModule {}
