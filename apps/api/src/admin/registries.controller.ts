import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import { PERMISSIONS as P, cursorQuerySchema } from '@safra/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { BookingListService } from './booking-list.service.js';
import { RegistryService } from './registry.service.js';
import { FinanceService } from './finance.service.js';
import { PromotionsService } from './promotions.service.js';
import { GeoService } from './geo.service.js';
import { ReportsService } from './reports.service.js';
import { StaffOverviewService } from './staff-overview.service.js';
import {
  EmergencyService,
  activateEmergencySchema,
  type ActivateEmergencyInput,
} from './emergency.service.js';

/**
 * A paginated, searchable list request.
 *
 * `.strict()` on purpose: an unknown query parameter is rejected rather than ignored, so a
 * typo'd `?status=` cannot silently return the unfiltered list — which on a registry means
 * quietly showing more than the caller asked for.
 */
const listQuerySchema = cursorQuerySchema.extend({
  /** Free text. Bounded because it reaches a `LIKE` pattern. */
  q: z.string().trim().min(1).max(80).optional(),
});

const bookingListQuerySchema = listQuerySchema.extend({
  status: z
    .enum([
      'draft',
      'pending_payment',
      'pending_confirmation',
      'confirmed',
      'cancelled',
      'checked_in',
      'completed',
      'disputed',
    ])
    .optional(),
});

const deactivateEmergencySchema = z
  .object({ reason: z.string().min(10).max(500) })
  .strict();

/**
 * The console's registry and finance reads (design handoff §8).
 *
 * ## Why a second admin controller
 *
 * `AdminController` owns verification DECISIONS — approving a partner, reviewing a listing,
 * importing a sanctions list. These are registry READS plus the two Emergency Mode writes.
 * Keeping them apart means the file that can change a partner's status stays small enough to
 * review in one sitting, which is the file where that matters most.
 *
 * ## Permissions are per resource, never "is admin"
 *
 * Each route names the narrowest permission that fits: a support agent can read customers but
 * not the ledger; a finance officer can read payments and wallets but cannot approve a partner.
 * §4.1 requires exactly this, and lumping them behind one right would make the permission
 * matrix on the staff screen a fiction.
 */
@Controller('admin')
export class RegistriesController {
  constructor(
    private readonly bookings: BookingListService,
    private readonly registry: RegistryService,
    private readonly finance: FinanceService,
    private readonly promotions: PromotionsService,
    private readonly geo: GeoService,
    private readonly reports: ReportsService,
    private readonly staffOverview: StaffOverviewService,
    private readonly emergency: EmergencyService,
  ) {}

  // ── الحجوزات ───────────────────────────────────────────────────────────────

  @Get('bookings')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async listBookings(
    @Query(new ZodValidationPipe(bookingListQuerySchema))
    query: z.infer<typeof bookingListQuerySchema>,
  ) {
    const [page, counts] = await Promise.all([
      this.bookings.list(query),
      this.bookings.counts(),
    ]);

    return { ...page, counts };
  }

  // ── الشركاء · العقارات · العملاء ────────────────────────────────────────────

  @Get('partners')
  @RequirePermissions(P.PARTNER_READ)
  async listPartners(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.registry.partners(query);
  }

  @Get('properties')
  @RequirePermissions(P.PROPERTY_READ)
  async listProperties(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.registry.properties(query);
  }

  @Get('customers')
  @RequirePermissions(P.CUSTOMER_READ)
  async listCustomers(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.registry.customers(query);
  }

  // ── الدفع والفواتير · المحفظة ───────────────────────────────────────────────

  /**
   * `LEDGER_READ`, not `PAYMENT_READ`.
   *
   * The counters are aggregated from `ledger_entries` and include what SAFRA owes partners,
   * which is a finance view rather than a per-booking payment lookup. A support agent holds
   * `PAYMENT_READ` so they can answer "did this card go through"; they have no business
   * reading the company's outstanding liabilities.
   */
  @Get('finance')
  @RequirePermissions(P.LEDGER_READ)
  async finances(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    const [page, counters] = await Promise.all([
      this.finance.list(query),
      this.finance.counters(),
    ]);

    return { ...page, counters };
  }

  @Get('wallet-transactions')
  @RequirePermissions(P.WALLET_READ)
  async walletTransactions(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.finance.wallet(query);
  }

  // ── بطاقات الهدايا · الكوبونات ─────────────────────────────────────────────

  @Get('gift-cards')
  @RequirePermissions(P.GIFT_CARD_READ)
  async giftCards(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.promotions.giftCards(query);
  }

  @Get('coupons')
  @RequirePermissions(P.COUPON_READ)
  async coupons(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.promotions.coupons(query);
  }

  // ── المدن والدول والعملات ───────────────────────────────────────────────────

  /**
   * One round trip for the whole geography screen.
   *
   * Three small lists that are always rendered together; three endpoints would be three
   * sequential awaits in a server component for no benefit.
   */
  @Get('geo')
  @RequirePermissions(P.SETTINGS_READ)
  async geography(
    @Query(
      new ZodValidationPipe(
        z.object({ q: z.string().trim().max(80).optional() }).strict(),
      ),
    )
    query: {
      q?: string | undefined;
    },
  ) {
    const [countries, currencies, cities] = await Promise.all([
      this.geo.countries(),
      this.geo.currencies(),
      this.geo.cities(query.q),
    ]);

    return { countries, currencies, cities };
  }

  // ── التقارير ───────────────────────────────────────────────────────────────

  @Get('reports')
  @RequirePermissions(P.REPORT_READ)
  async reportCards() {
    return { cards: await this.reports.cards() };
  }

  // ── الموظفون (overview) ────────────────────────────────────────────────────

  /**
   * Counters, the permission matrix and recent staff activity.
   *
   * `STAFF_MANAGE` — the same right the staff list itself needs. The matrix reveals the
   * authorization model, which is not something to hand to every staff role: it is a map of
   * which account to compromise for which capability.
   */
  @Get('staff/overview')
  @RequirePermissions(P.STAFF_MANAGE)
  async staffOverviewData() {
    const [counters, activity] = await Promise.all([
      this.staffOverview.counters(),
      this.staffOverview.activity(),
    ]);

    return { counters, matrix: this.staffOverview.matrix(), activity };
  }

  // ── Emergency Mode (EC-009) ────────────────────────────────────────────────

  @Get('emergency')
  @RequirePermissions(P.EMERGENCY_MODE_ACTIVATE)
  async emergencyState() {
    const [active, history, scopes] = await Promise.all([
      this.emergency.active(),
      this.emergency.history(),
      this.emergency.scopes(),
    ]);

    return { active, history, scopes };
  }

  /**
   * Throttled to 5/minute despite already being Super-Admin-only.
   *
   * Not about brute force — the caller is authenticated. It bounds the damage of a UI bug or a
   * stuck retry loop declaring an emergency repeatedly, each one of which fires a broadcast to
   * every customer with an upcoming booking in the scope.
   */
  @Post('emergency')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions(P.EMERGENCY_MODE_ACTIVATE)
  async activateEmergency(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(activateEmergencySchema)) body: ActivateEmergencyInput,
  ) {
    return this.emergency.activate(user, body);
  }

  @Delete('emergency/:id')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.EMERGENCY_MODE_ACTIVATE)
  async deactivateEmergency(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('id') id: string,
    @Body(new ZodValidationPipe(deactivateEmergencySchema))
    body: z.infer<typeof deactivateEmergencySchema>,
  ) {
    await this.emergency.deactivate(user, id, body.reason);

    return { ok: true };
  }
}
