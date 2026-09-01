import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  couponActiveSchema,
  couponCreateSchema,
  couponUpdateSchema,
  createCityCategorySchema,
  createCitySchema,
  createCountrySchema,
  createCurrencySchema,
  updateCityCategorySchema,
  updateCitySchema,
  updateCountrySchema,
  updateCurrencySchema,
  giftCardCancelSchema,
  giftCardIssueSchema,
  pageQuerySchema,
  setStaffScopeSchema,
  type CouponActiveInput,
  type CreateCityCategoryInput,
  type CreateCityInput,
  type CreateCountryInput,
  type CreateCurrencyInput,
  type UpdateCityCategoryInput,
  type UpdateCityInput,
  type UpdateCountryInput,
  type UpdateCurrencyInput,
  type CouponCreateInput,
  type CouponUpdateInput,
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
import { GeoWriteService } from './geo-write.service.js';
import { GeoCategoryService } from './geo-category.service.js';
import { ReportsService } from './reports.service.js';
import { StaffOverviewService } from './staff-overview.service.js';
import { ExportRequestService } from './export-request.service.js';
import { StaffScopeService } from './staff-scope.service.js';
import { GiftCardService } from '../gift-cards/gift-card.service.js';
import { CouponAdminService } from './coupon-admin.service.js';
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

/**
 * The coupon-adoption view: a page of partners, narrowed by their answer and by a search.
 *
 * `status` is an allow-list rather than free text — it becomes a cast to `coupon_partner_status`,
 * and a value the enum does not know would be a 500 rather than a refusal.
 */
const couponPartnersQuerySchema = listQuerySchema.extend({
  status: z.enum(['pending', 'accepted', 'rejected']).optional(),
});

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
    private readonly geoWrite: GeoWriteService,
    private readonly geoCategories: GeoCategoryService,
    private readonly reports: ReportsService,
    private readonly staffOverview: StaffOverviewService,
    private readonly emergency: EmergencyService,
    private readonly exportRequests: ExportRequestService,
    private readonly staffScope: StaffScopeService,
    private readonly giftCardIssuer: GiftCardService,
    private readonly couponAdmin: CouponAdminService,
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

  /**
   * Creating a coupon — §9.3's «+ كوبون جديد».
   *
   * `COUPON_MANAGE`, which finance and super admin hold and which had no route behind it: the
   * permission, the `coupons` table and a disabled button were a feature that existed only in the
   * data model.
   *
   * Throttled, because a coupon is money off that anybody holding the code can spend.
   *
   * `AuditExempt` — `CouponAdminService` records `coupon.created` inside the transaction with the
   * code, the value and the window, none of which the interceptor can see.
   */
  @Post('coupons')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions(P.COUPON_MANAGE)
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @AuditExempt('CouponAdminService records coupon.created inside the transaction.')
  async createCoupon(
    @Body(new ZodValidationPipe(couponCreateSchema)) body: CouponCreateInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    return this.couponAdmin.create(user, body);
  }

  /** Editing a coupon's window and caps. Its code and value are set once — see the service. */
  @Patch('coupons/:code')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.COUPON_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @AuditExempt('CouponAdminService records coupon.updated inside the transaction.')
  async updateCoupon(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(couponUpdateSchema)) body: CouponUpdateInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    await this.couponAdmin.update(user, code, body);

    return { ok: true };
  }

  /** Pausing or resuming a campaign, without touching its dates. */
  @Post('coupons/:code/active')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions(P.COUPON_MANAGE)
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @AuditExempt(
    'CouponAdminService records coupon.activated/deactivated in the transaction.',
  )
  async setCouponActive(
    @Param('code') code: string,
    @Body(new ZodValidationPipe(couponActiveSchema)) body: CouponActiveInput,
    @CurrentUser() user: AccessTokenClaims | undefined,
  ) {
    await this.couponAdmin.setActive(user, code, body);

    return { ok: true };
  }

  @Get('coupons')
  @RequirePermissions(P.COUPON_READ)
  async coupons(
    @Query(new ZodValidationPipe(listQuerySchema)) query: z.infer<typeof listQuerySchema>,
  ) {
    return this.promotions.coupons(query);
  }

  /**
   * Who has taken one coupon up, who refused, and who has not answered.
   *
   * `COUPON_READ` **and** `PARTNER_READ`, both — `RequirePermissions` is an AND.
   *
   * The first is obvious: this is a view of a coupon, opened from the registry that needs it. The
   * second is the answer to «what does this let somebody reach that they could not reach before».
   * The rows are PARTNERS — a name, a reference, a city — and the permission catalogue is the input
   * to custom staff roles, so a role built with `coupon.read` alone would have read a partner
   * directory through a coupon. Every built-in role holding `coupon.read` already holds
   * `partner.read`, so nothing in use loses access; the pairing closes a door rather than shutting
   * one somebody was using.
   */
  @Get('coupons/:code/partners')
  @RequirePermissions(P.COUPON_READ, P.PARTNER_READ)
  async couponParticipation(
    @Param('code') code: string,
    @Query(new ZodValidationPipe(couponPartnersQuerySchema))
    query: z.infer<typeof couponPartnersQuerySchema>,
  ) {
    return this.promotions.couponParticipation(code, query);
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

  /*
    ── The three «+ إضافة» buttons, and the row a city finally has ───────────

    `GEO_MANAGE` on every one: `SETTINGS_READ` above opens the screen, and reading which markets
    exist is not the same authority as opening or closing one. Each is `AuditExempt` because
    `GeoWriteService` records inside the transaction — a row written and an audit line missing is
    the pair this codebase keeps refusing to allow.

    Nothing here deletes. A country, city or currency is referenced by bookings and ledger rows
    that outlive the decision to stop selling there; `isActive` is how a market closes.
  */

  /*
    ── الفئات ────────────────────────────────────────────────────────────────

    Their own screen, so their own routes. `SETTINGS_READ` opens the list because the geography
    screen already reads them to draw its category column; changing one is `GEO_MANAGE`, the same
    authority that opens and closes a market.
  */

  @Get('geo/categories')
  @RequirePermissions(P.SETTINGS_READ)
  async cityCategories() {
    return { categories: await this.geoCategories.list() };
  }

  @Post('geo/categories')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoCategoryService records city_category.created inside the transaction.')
  async createCityCategory(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(createCityCategorySchema)) body: CreateCityCategoryInput,
  ) {
    return this.geoCategories.create(user, body);
  }

  @Patch('geo/categories/:code')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoCategoryService records city_category.updated inside the transaction.')
  async updateCityCategory(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateCityCategorySchema)) body: UpdateCityCategoryInput,
  ) {
    return this.geoCategories.update(user, code, body);
  }

  @Post('geo/currencies')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records currency.created inside the transaction.')
  async createCurrency(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(createCurrencySchema)) body: CreateCurrencyInput,
  ) {
    return this.geoWrite.createCurrency(user, body);
  }

  @Patch('geo/currencies/:code')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records currency.updated inside the transaction.')
  async updateCurrency(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateCurrencySchema)) body: UpdateCurrencyInput,
  ) {
    return this.geoWrite.updateCurrency(user, code.toUpperCase(), body);
  }

  /*
    ── Deleting geography ──────────────────────────────────────────────────────────────────
    Bashar (2026-08-31): «I can add/edit everything on the page المدن والدول والعملات but I can
    not delete», and «also on the page الفئات same». Behind `GEO_MANAGE`, the same permission the
    creates and the edits are behind: a person who may add a city may remove one they added by
    mistake. What they may NOT do is remove one anything points at — that is the service's
    reference check, not a permission, because it is about the data rather than the person.
  */
  @Delete('geo/currencies/:code')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records currency.deleted inside the transaction.')
  async deleteCurrency(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
  ) {
    return this.geoWrite.deleteCurrency(user, code.toUpperCase());
  }

  @Delete('geo/countries/:code')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records country.deleted inside the transaction.')
  async deleteCountry(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
  ) {
    return this.geoWrite.deleteCountry(user, code.toUpperCase());
  }

  @Delete('geo/cities/:slug')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records city.deleted inside the transaction.')
  async deleteCity(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
  ) {
    return this.geoWrite.deleteCity(user, slug);
  }

  @Delete('geo/categories/:code')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoCategoryService records city_category.deleted inside the transaction.')
  async deleteCityCategory(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
  ) {
    return this.geoCategories.remove(user, code);
  }

  @Post('geo/countries')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records country.created inside the transaction.')
  async createCountry(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(createCountrySchema)) body: CreateCountryInput,
  ) {
    return this.geoWrite.createCountry(user, body);
  }

  @Patch('geo/countries/:code')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records country.updated inside the transaction.')
  async updateCountry(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('code') code: string,
    @Body(new ZodValidationPipe(updateCountrySchema)) body: UpdateCountryInput,
  ) {
    return this.geoWrite.updateCountry(user, code.toUpperCase(), body);
  }

  @Post('geo/cities')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records city.created inside the transaction.')
  async createCity(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(createCitySchema)) body: CreateCityInput,
  ) {
    return this.geoWrite.createCity(user, body);
  }

  @Patch('geo/cities/:slug')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('GeoWriteService records city.updated inside the transaction.')
  async updateCity(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(updateCitySchema)) body: UpdateCityInput,
  ) {
    return this.geoWrite.updateCity(user, slug, body);
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
