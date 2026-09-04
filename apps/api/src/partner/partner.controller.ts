import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';

import {
  PERMISSIONS as P,
  type CalendarQuery,
  type CalendarRangeUpdate,
  type PortfolioCalendarQuery,
  type PropertyCreateInput,
  type PropertyUpdateInput,
  type UnitCreateInput,
  type UnitUpdateInput,
  calendarQuerySchema,
  calendarRangeUpdateSchema,
  portfolioCalendarQuerySchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  unitCreateSchema,
  unitUpdateSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { RefusedWhileSuspended } from '../rbac/suspended-partner.guard.js';
import { RequireVerifiedPartner } from '../rbac/verified-partner.guard.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { CalendarService } from './calendar.service.js';
import { PartnerDashboardService } from './dashboard.service.js';
import { PropertiesService } from './properties.service.js';

/**
 * The partner dashboard API (SRS §8.3).
 *
 * Every handler carries @RequirePermissions AND the service re-derives the
 * partner id from the token before touching a row. Two layers on purpose: the
 * decorator answers "may this role act at all", the service answers "on whose
 * data" — and only the second prevents one partner reaching another's inventory.
 *
 * ## `POST /partner/register` is gone (Bashar, 2026-08-19)
 *
 * It was the one `@Public()` route here, and it created a partner ACCOUNT — anyone could self-
 * register and land in `pending`. That was defensible while publication was the only thing being
 * withheld, but it is not the flow Bashar specified: a request reaches the super admin, who
 * telephones the applicant, accepts, and only then is an account created.
 *
 * Two doors into the same relationship would have meant two review queues that must agree, so
 * this one is closed. `POST /partner/applications` is the way in — see
 * `partner-application.controller.ts`. Nothing in this file is public any more.
 */
@Controller('partner')
export class PartnerController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly calendar: CalendarService,
    private readonly dashboardService: PartnerDashboardService,
  ) {}

  /**
   * Who the signed-in partner IS — their business name, city, tier and score.
   *
   * ## Why this is an endpoint and not a token claim
   *
   * The obvious alternative is to put the display name in the JWT. It is the wrong place: access
   * tokens live 15 minutes and are cached, so a partner who corrects their trading name would keep
   * seeing the old one until it expired; and a token is sent on every request to every endpoint,
   * so anything added to it is paid for on all of them.
   *
   * This is one primary-key lookup, read once per render by an app that is server-rendered anyway.
   *
   * ## Why it takes no id
   *
   * It reads `claims.partnerId` from the VERIFIED token and nothing else, so "can this partner see
   * that partner's profile" is a question the endpoint cannot be asked — the same shape as the
   * console's `admin/me`.
   */
  @Get('me')
  async me(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.properties.profile(user);
  }

  /**
   * لوحة التحكم (§7.1) — the KPIs, the pending-request queue, a month calendar and the alerts,
   * in one round trip.
   *
   * `BOOKING_READ_OWN` because that is what almost everything on it is: the partner's own
   * bookings, counted four ways. The payout line is the exception and is read under the same
   * permission the payout endpoints use — a partner who may see their payouts may see that one of
   * them is scheduled.
   *
   * Takes no partner id. `PartnerDashboardService` reads it from the verified token.
   */
  @Get('dashboard')
  @RequirePermissions(P.BOOKING_READ_OWN)
  async dashboard(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.dashboardService.overview(user);
  }

  /**
   * The amenities this partner may declare on a unit.
   *
   * `PROPERTY_MANAGE_OWN` because that is the authority it serves — the picker on تعديل — and an
   * employee with it may edit a unit, so they may read the list that populates the control.
   */
  @Get('amenities')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async amenities(@CurrentUser() user: AccessTokenClaims | undefined) {
    return { amenities: await this.properties.offerableAmenities(user) };
  }

  @Get('properties')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async listProperties(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.properties.listOwn(user);
  }

  /** One listing, with the fields a form prefills from and the units a calendar is chosen by. */
  @Get('properties/:reference')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('A partner reading their own listing; changes nothing.')
  async readProperty(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.properties.readOwn(user, reference);
  }

  /* Refused while suspended: creating a listing. */
  @RefusedWhileSuspended()
  @Post('properties')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async createProperty(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(propertyCreateSchema)) body: PropertyCreateInput,
  ) {
    return this.properties.create(user, body);
  }

  /* Refused while suspended: modifying a listing. */
  @RefusedWhileSuspended()
  @Patch('properties/:reference')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async updateProperty(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(propertyUpdateSchema)) body: PropertyUpdateInput,
  ) {
    return this.properties.update(user, reference, body);
  }

  /**
   * As far as a partner can move a listing toward being live. Publication requires
   * PROPERTY_APPROVE, which no partner role holds (§8.1).
   */
  /* Refused while suspended: submitting a listing for review — the ACTIVATE step. */
  @RefusedWhileSuspended()
  @Post('properties/:reference/submit')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async submitForReview(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.properties.submitForReview(user, reference);
  }

  /*
    A unit carries a base price, so creating one IS setting a price — step 7 (Bashar, 2026-08-19).

    The consequence is stated rather than hidden: an unverified partner can write their property's
    address and description and nothing more. That is what «انضم كشريك» tells an applicant will
    happen, and what لوحة الشريك repeats on العقود والمستندات while they wait.
  */
  @RequireVerifiedPartner()
  /* Refused while suspended: adding a unit, which carries a price. */
  @RefusedWhileSuspended()
  @Post('properties/:reference/units')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async addUnit(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(unitCreateSchema)) body: UnitCreateInput,
  ) {
    return this.properties.addUnit(user, reference, body);
  }

  /* Changes the base price among other things — gated whole rather than per field. */
  @RequireVerifiedPartner()
  /* Refused while suspended: modifying a unit. */
  @RefusedWhileSuspended()
  @Patch('units/:unitId')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async updateUnit(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(unitUpdateSchema)) body: UnitUpdateInput,
  ) {
    return this.properties.updateUnit(user, unitId, body);
  }

  /**
   * The whole portfolio's month — every unit, grouped under its property.
   *
   * A separate endpoint rather than a flag on the per-unit read: it answers a different shape and,
   * more to the point, it takes a MONTH where that one takes a free `from`/`to`. Bounding the range
   * in the contract is what keeps "show me my rooms" from being able to ask for a century.
   *
   * Takes no partner id, like every handler here. The service derives it from the verified token,
   * so "show me another partner's calendars" is a question this endpoint cannot be asked.
   */
  @Get('calendars')
  @RequirePermissions(P.CALENDAR_MANAGE_OWN)
  async readPortfolioCalendar(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Query(new ZodValidationPipe(portfolioCalendarQuerySchema))
    query: PortfolioCalendarQuery,
  ) {
    return this.calendar.readPortfolio(user, query);
  }

  @Get('units/:unitId/calendar')
  @RequirePermissions(P.CALENDAR_MANAGE_OWN)
  async readCalendar(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('unitId') unitId: string,
    @Query(new ZodValidationPipe(calendarQuerySchema)) query: CalendarQuery,
  ) {
    return this.calendar.read(user, unitId, query);
  }

  /* Dates AND nightly prices, which is two of the three things step 7 names. */
  @RequireVerifiedPartner()
  /* Refused while suspended: dates and nightly prices — how a listing is OFFERED. */
  @RefusedWhileSuspended()
  @Put('units/:unitId/calendar')
  @RequirePermissions(P.CALENDAR_MANAGE_OWN)
  async updateCalendar(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(calendarRangeUpdateSchema)) body: CalendarRangeUpdate,
  ) {
    return this.calendar.updateRange(user, unitId, body);
  }
}
