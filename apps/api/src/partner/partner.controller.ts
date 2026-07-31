import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';

import {
  PERMISSIONS as P,
  type CalendarQuery,
  type CalendarRangeUpdate,
  type PartnerRegisterInput,
  type PropertyCreateInput,
  type PropertyUpdateInput,
  type UnitCreateInput,
  type UnitUpdateInput,
  calendarQuerySchema,
  calendarRangeUpdateSchema,
  partnerRegisterSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  unitCreateSchema,
  unitUpdateSchema,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, Public, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { CalendarService } from './calendar.service.js';
import { PartnerRegistrationService } from './partner-registration.service.js';
import { PropertiesService } from './properties.service.js';

/**
 * The partner dashboard API (SRS §8.3).
 *
 * Every handler carries @RequirePermissions AND the service re-derives the
 * partner id from the token before touching a row. Two layers on purpose: the
 * decorator answers "may this role act at all", the service answers "on whose
 * data" — and only the second prevents one partner reaching another's inventory.
 */
@Controller('partner')
export class PartnerController {
  constructor(
    private readonly properties: PropertiesService,
    private readonly calendar: CalendarService,
    private readonly registration: PartnerRegistrationService,
  ) {}

  /**
   * Applying to become a partner (§8.1).
   *
   * `@Public()` — the applicant has no account yet, which is the point. That is safe
   * only because of what registration does NOT grant: the partner lands in `pending`,
   * item 116 blocks publication while unverified, and ADR 0002 makes sanctions
   * screening a hard precondition for verifying them. Anyone may apply; nothing they
   * create reaches a customer until a human and a screening check have both passed.
   *
   * Throttled like customer registration: five a minute per address. It writes two
   * rows and runs an Argon2id hash, so it is both expensive and worth abusing.
   */
  @Public()
  @Post('register')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @AuditExempt(
    'PartnerRegistrationService records partner.registered in the same transaction.',
  )
  async register(
    @Body(new ZodValidationPipe(partnerRegisterSchema)) body: PartnerRegisterInput,
    @Req() request: Request,
  ) {
    return this.registration.register(body, {
      ipAddress: request.ip,
      userAgent: request.get('user-agent'),
    });
  }

  @Get('properties')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async listProperties(@CurrentUser() user: AccessTokenClaims | undefined) {
    return this.properties.listOwn(user);
  }

  @Post('properties')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async createProperty(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(propertyCreateSchema)) body: PropertyCreateInput,
  ) {
    return this.properties.create(user, body);
  }

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
  @Post('properties/:reference/submit')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async submitForReview(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
  ) {
    return this.properties.submitForReview(user, reference);
  }

  @Post('properties/:reference/units')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async addUnit(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Body(new ZodValidationPipe(unitCreateSchema)) body: UnitCreateInput,
  ) {
    return this.properties.addUnit(user, reference, body);
  }

  @Patch('units/:unitId')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  async updateUnit(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('unitId') unitId: string,
    @Body(new ZodValidationPipe(unitUpdateSchema)) body: UnitUpdateInput,
  ) {
    return this.properties.updateUnit(user, unitId, body);
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
