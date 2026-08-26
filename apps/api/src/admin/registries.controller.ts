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
  Query,
  Res,
  Req,
} from '@nestjs/common';
import type { Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';

import {
  BOOKING_ATTENTION,
  PERMISSIONS as P,
  giftCardCancelSchema,
  giftCardIssueSchema,
  pageQuerySchema,
  setStaffScopeSchema,
  type GiftCardCancelInput,
  type GiftCardIssueInput,
  type PageQuery,
  type SetStaffScopeInput,
} from '@safra/contracts';

import type { Request } from 'express';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
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
import { ExportRequestService } from './export-request.service.js';
import { StaffScopeService } from './staff-scope.service.js';
import { GiftCardService } from '../gift-cards/gift-card.service.js';
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
const listQuerySchema = pageQuerySchema.extend({
  /** Free text. Bounded because it reaches a `LIKE` pattern. */
  q: z.string().trim().min(1).max(80).optional(),
});

/** One definition, used by both the list and the export, so their filters cannot diverge. */
const bookingStatusSchema = z.enum([
  'draft',
  'pending_payment',
  'pending_confirmation',
  'confirmed',
  'cancelled',
  'checked_in',
  'completed',
  'disputed',
]);

const bookingListQuerySchema = listQuerySchema.extend({
  status: bookingStatusSchema.optional(),
  /**
   * §6.4's window about to lapse — the dashboard's EC-008 alert, as a list.
   *
   * A boolean rather than a number of minutes: the threshold has to match the COUNT the dashboard
   * shows, and a caller-supplied window would let the two disagree. `SLA_EXPIRY_WARNING_MINUTES`
   * lives in one place and every reader takes it from there.
   *
   * `literal('1')`, not `coerce.boolean()`. Coercion treats every non-empty string as true, so
   * `?expiring=false` and `?expiring=0` would both TURN THE FILTER ON — a URL that says the opposite
   * of what it does. Accepting exactly one value makes the query string honest and anything else
   * simply not the filter.
   */
  expiring: z
    .literal('1')
    .optional()
    .transform((value) => value === '1'),
  /**
   * Which dashboard alert this view answers — EC-004 or EC-011.
   *
   * An enum rather than a free string: the predicates live in the service, and a value it does not
   * know would silently return the UNFILTERED list — an operator told «٤٢٨ لم يُسجَّل وصولهم» and
   * shown every booking there is. That is the failure every attention link exists to prevent.
   */
  attention: z.enum(BOOKING_ATTENTION).optional(),
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
    private readonly exportRequests: ExportRequestService,
    private readonly staffScope: StaffScopeService,
    private readonly giftCardIssuer: GiftCardService,
  ) {}

  // ── الحجوزات ───────────────────────────────────────────────────────────────

  @Get('bookings')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async listBookings(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(bookingListQuerySchema))
    query: z.infer<typeof bookingListQuerySchema>,
  ) {
    const [page, counts] = await Promise.all([
      this.bookings.list({ ...query, actor: user }),
      this.bookings.counts(user),
    ]);

    return { ...page, counts };
  }

  /**
   * تصدير CSV, audited (B-13).
   *
   * ## A POST that ASKS for a file, rather than a GET that is one
   *
   * The export is built by a worker now (BullMQ phase 5), which removes the 20,000-row truncation
   * that existed only because the file was made inside a request. Two consequences follow from the
   * verb rather than from taste: a GET that creates a row would let a prefetch or a pasted link
   * produce an export in somebody's name, and a download that takes minutes cannot be a response.
   *
   * Throttled hard. An export is the cheapest way to pull a large slice of customer data out of the
   * console, so the limit is about bounding that, not about load.
   */
  @Post('bookings/export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @RequirePermissions(P.BOOKING_READ_ALL)
  async requestBookingExport(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(
      new ZodValidationPipe(
        z
          .object({
            q: z.string().trim().min(1).max(80).optional(),
            status: bookingStatusSchema.optional(),
          })
          .strict(),
      ),
    )
    body: { q?: string | undefined; status?: string | undefined },
  ) {
    return this.exportRequests.request(user, body);
  }

  /**
   * The exports this caller may collect.
   *
   * No extra permission beyond `BOOKING_READ_ALL`: the service scopes the list to the caller's own
   * requests unless they hold `STAFF_MANAGE`, so the authorisation is in the WHERE clause where it
   * cannot be forgotten.
   */
  @Get('exports')
  @RequirePermissions(P.BOOKING_READ_ALL)
  async listExports(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery,
  ) {
    return this.exportRequests.list(user, query);
  }

  /**
   * The bytes.
   *
   * `Header`-controlled download rather than a JSON payload the client turns into a file: the
   * browser handles the save, and the API is the only thing that ever sees the whole set — which is
   * what lets it write one accurate audit row, here, immediately before the bytes leave.
   *
   * Throttled hard for the same reason the request is: an export is the cheapest way to pull a large
   * slice of customer data out of the console.
   */
  @Get('exports/:reference/download')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @RequirePermissions(P.BOOKING_READ_ALL)
  async downloadExport(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Res() response: Response,
  ): Promise<void> {
    const { filename, csv } = await this.exportRequests.download(user, reference);

    response.setHeader('Content-Type', 'text/csv; charset=utf-8');
    response.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    /* Never cached: it carries customer names and is scoped to one requester. */
    response.setHeader('Cache-Control', 'no-store');
    response.send(csv);
  }

  // ── الموظفون: النطاق (§8.2) ─────────────────────────────────────────────────

  /*
    `GET staff/scopes` was removed on 2026-08-23, and the WRITE below deliberately was not.

    The read served a paged column of everybody's scope on الموظفون. That table is gone — a scope is
    a property of a PERSON and now lives on their own record, where `StaffService.detail` joins it —
    so the endpoint had no caller and no reader it could serve.

    The write is a different question and the answer is different. Nothing in the console calls it
    TODAY either, because the panel that did was deleted with the table. That is a gap rather than a
    dead route: a super admin can no longer scope a colleague to cities, and صفحة الموظف shows the
    scope it cannot change. Deleting this because its only caller went away would turn a missing
    screen into a missing capability, quietly, and the console would have to grow the endpoint back
    to get the feature back. Recorded as O-staff-3.
  */

  /**
   * Sets one staff member's scope.
   *
   * Narrowing revokes their sessions immediately — see `StaffScopeService`. Widening is allowed to
   * lag by the token's lifetime, which is the trade ADR 0003 already made for permissions.
   */
  @Put('staff/:userId/scope')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt(
    'StaffScopeService records staff.scope_changed itself, inside the same transaction as the ' +
      'write — with the before and after kind, the outside-access value and the city slugs, which ' +
      'an interceptor firing after the fact could not know.',
  )
  @RequirePermissions(P.STAFF_MANAGE)
  async setStaffScope(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('userId') userId: string,
    @Body(new ZodValidationPipe(setStaffScopeSchema)) body: SetStaffScopeInput,
    @Req() request: Request,
  ) {
    return this.staffScope.set(user, userId, body, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  // ── الشركاء · العقارات · العملاء ────────────────────────────────────────────

  @Get('partners')
  @RequirePermissions(P.PARTNER_READ)
  async listPartners(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.registry.partners({ ...query, actor: user });
  }

  @Get('properties')
  @RequirePermissions(P.PROPERTY_READ)
  async listProperties(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.registry.properties({ ...query, actor: user });
  }

  @Get('customers')
  @RequirePermissions(P.CUSTOMER_READ)
  async listCustomers(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.registry.customers(query);
  }

  /**
   * ONE customer's record — everything the platform holds about them.
   *
   * `customer.read`, the same capability as the registry it is opened from: this shows more DETAIL
   * about somebody a reader can already find, not a different class of information. The contact
   * details on it are the ones §9.4's booking screen has always displayed.
   *
   * The reference is looked up in a `WHERE` clause, so a reference that does not exist and one that
   * is malformed answer identically.
   */
  @Get('customers/:reference')
  @RequirePermissions(P.CUSTOMER_READ)
  @AuditExempt('Reading a customer record; changes nothing.')
  async customerDetail(@Param('reference') reference: string) {
    return this.registry.customerDetail(reference);
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
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    const [page, counters] = await Promise.all([
      this.finance.list({ ...query, actor: user }),
      this.finance.counters(user),
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

  /**
   * Issues a card SAFRA is giving away — §9.3's «+ إنشاء بطاقة هدية».
   *
   * `GIFT_CARD_MANAGE`, which finance and super admin hold and which had no route behind it at all:
   * the permission, the `issued_by_user_id` column and the disabled button on بطاقات الهدايا were
   * three halves of a feature nobody had finished.
   *
   * Throttled like the wallet adjustment, and for the same reason — this creates a liability out
   * of nothing, so a loop that gets loose is expensive rather than merely noisy.
   *
   * `AuditExempt` because `GiftCardService` writes `gift_card.issued` INSIDE the transaction, with
   * the amount, the currency and the reason. The interceptor resolves its subject from a route
   * param and this route has none — the card does not exist until the body is handled.
   */
  @Post('gift-cards')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(P.GIFT_CARD_MANAGE)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @AuditExempt(
    'GiftCardService records gift_card.issued inside the transaction, with the amount, ' +
      'the currency and the reason — none of which the interceptor can see.',
  )
  async issueGiftCard(
    @Body(new ZodValidationPipe(giftCardIssueSchema)) body: GiftCardIssueInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.giftCardIssuer.issue(user, body);
  }

  /**
   * Voids a live card — §9.3's «إلغاء».
   *
   * `GIFT_CARD_MANAGE`, the same capability as issuing one, because it is the same power in
   * reverse: creating and destroying a liability are one authority, not two.
   *
   * `AuditExempt` because `GiftCardService` writes `gift_card.cancelled` inside the transaction
   * with the balance either side and whether the buyer was made whole — none of which the
   * interceptor can see.
   */
  @Post('gift-cards/:reference/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.GIFT_CARD_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt(
    'GiftCardService records gift_card.cancelled inside the transaction, with the balance ' +
      'either side of it and whether the value was returned.',
  )
  async cancelGiftCard(
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(giftCardCancelSchema)) body: GiftCardCancelInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.giftCardIssuer.cancel(user, reference, body);
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
  async reportCards(@CurrentUser() user: AccessTokenClaims | undefined) {
    return { cards: await this.reports.cards(user) };
  }

  // ── الموظفون (overview) ────────────────────────────────────────────────────

  /**
   * Counters and recent staff activity.
   *
   * `STAFF_MANAGE` — the same right the staff list itself needs. Recent activity names which
   * colleague did what, which is not something to hand to every staff role.
   *
   * The permission MATRIX was removed on 2026-08-23. Bashar asked for it off الموظفون by name, and
   * أدوار الموظفين is where a role's capabilities are read now — a matrix beside it was a second
   * rendering of the same fact, from a second source. Dropped from the console's schema first and
   * from this payload after, in that order deliberately: zod ignores an unknown key, so a client
   * that stops expecting a field survives a server that still sends it, and the reverse fails the
   * parse and blanks the page.
   */
  @Get('staff/overview')
  @RequirePermissions(P.STAFF_MANAGE)
  async staffOverviewData() {
    const [counters, activity] = await Promise.all([
      this.staffOverview.counters(),
      this.staffOverview.activity(),
    ]);

    return { counters, activity };
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
