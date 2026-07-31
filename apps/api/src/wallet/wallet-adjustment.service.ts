import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import type { Role, WalletAdjustInput } from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { MONEY_SCALE, fromMinor, toMinor } from '../common/money.js';
import { DATABASE } from '../database/database.module.js';
import { FxRateService } from '../fx/fx-rate.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import { WalletService, type WalletMovementResult } from './wallet.service.js';

/**
 * Finance moving a balance by hand (SRS §2.3, §4.1).
 *
 * Separate from `WalletService` on purpose. The service is the primitive the SLA
 * sweep and (later) checkout call, and it must stay free of ledger and audit
 * dependencies so those callers keep posting their own, correctly-shaped entries.
 * This is the one path where the movement IS the whole transaction, so the
 * balancing legs and the audit row belong here.
 *
 * Everything happens in a single database transaction. A wallet credit whose
 * ledger entry rolled back would be money on the books that never came from
 * anywhere, and an adjustment with no audit row is precisely what §4.1 forbids.
 */
@Injectable()
export class WalletAdjustmentService {
  private readonly logger = new Logger(WalletAdjustmentService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly wallet: WalletService,
    private readonly ledger: LedgerService,
    private readonly fx: FxRateService,
    private readonly audit: AuditService,
  ) {}

  async adjust(
    customerProfileId: string,
    input: WalletAdjustInput,
    actor: { userId?: string | undefined; role?: Role | undefined },
  ): Promise<WalletMovementResult> {
    if (!actor.userId) {
      // The permission guard has already run, so a missing subject means a token
      // shape this route cannot attribute an action to. Refusing is the only
      // option that keeps the audit trail honest.
      throw new BadRequestException('An adjustment must be attributable to a user.');
    }

    const currencyId = await this.currencyId(input.currency);

    return this.db.transaction(async (tx) => {
      const handle = tx as unknown as Database;

      const movement =
        input.direction === 'credit'
          ? await this.wallet.credit(handle, {
              customerProfileId,
              amount: input.amount,
              currencyId,
              reason: 'admin_adjustment',
              createdByUserId: actor.userId,
              note: input.note,
            })
          : await this.wallet.debit(handle, {
              customerProfileId,
              amount: input.amount,
              currencyId,
              reason: 'admin_adjustment',
              createdByUserId: actor.userId,
              note: input.note,
            });

      /**
       * Posted in the wallet's own currency at the applied amount, not the
       * requested one. If finance credited 10 JOD to a USD wallet, what SAFRA
       * actually owes is the converted figure — booking the request would leave the
       * ledger disagreeing with the balance it is supposed to explain.
       */
      const fxRateToSyp = await this.fx.rateToSyp(movement.currencyCode);

      await this.ledger.post(
        handle,
        input.direction === 'credit'
          ? [
              {
                account: 'wallet_adjustment',
                direction: 'debit',
                amount: movement.appliedAmount,
                description: `Manual wallet credit: ${input.note}`,
              },
              {
                account: 'wallet_credit',
                direction: 'credit',
                amount: movement.appliedAmount,
                description: 'Customer wallet balance increased by finance',
              },
            ]
          : [
              {
                account: 'wallet_debit',
                direction: 'debit',
                amount: movement.appliedAmount,
                description: 'Customer wallet balance reduced by finance',
              },
              {
                account: 'wallet_adjustment',
                direction: 'credit',
                amount: movement.appliedAmount,
                description: `Manual wallet debit: ${input.note}`,
              },
            ],
        {
          currencyId: movement.currencyId,
          fxRateToSyp,
          customerProfileId,
          createdByUserId: actor.userId,
        },
      );

      /**
       * The balance before, DERIVED from the movement rather than read beforehand.
       *
       * A separate read would sit outside the row lock, so a concurrent movement
       * between the read and the write would make the audit row claim a starting
       * balance that was never true. Reversing the applied amount cannot disagree
       * with what actually happened.
       */
      const balanceBefore = reverse(
        movement.balance,
        movement.appliedAmount,
        input.direction,
      );

      /**
       * Written here rather than by the route interceptor, for the same reason
       * FxRateService writes its own: the interceptor resolves its subject from a
       * route param and would record neither the amount nor the balance either
       * side of it (§15).
       */
      await this.audit.record(
        {
          actorUserId: actor.userId,
          actorRole: actor.role,
          action: 'wallet.adjusted',
          subjectType: 'wallet',
          subjectId: movement.walletId,
          before: {
            balance: balanceBefore,
            currency: movement.currencyCode,
          },
          after: {
            balance: movement.balance,
            currency: movement.currencyCode,
            direction: input.direction,
            requestedAmount: input.amount,
            requestedCurrency: input.currency,
            appliedAmount: movement.appliedAmount,
            note: input.note,
          },
        },
        handle,
      );

      this.logger.log(
        `Wallet ${movement.walletId} ${input.direction}ed ${movement.appliedAmount} ` +
          `${movement.currencyCode} by user ${actor.userId}; balance now ${movement.balance}.`,
      );

      return movement;
    });
  }

  private async currencyId(code: string): Promise<string> {
    const rows = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM currencies WHERE code = ${code}
    `);

    const id = rows.rows[0]?.id;

    // Unlike a missing FX rate this IS the caller's mistake, so it is a 400.
    if (!id) throw new BadRequestException(`Unknown currency "${code}".`);

    return id;
  }
}

/** Undoes a movement to recover the balance it started from, in exact minor units. */
function reverse(
  balanceAfter: string,
  applied: string,
  direction: 'credit' | 'debit',
): string {
  const after = toMinor(balanceAfter, MONEY_SCALE);
  const delta = toMinor(applied, MONEY_SCALE);

  return fromMinor(direction === 'credit' ? after - delta : after + delta, MONEY_SCALE);
}
