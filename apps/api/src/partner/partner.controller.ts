import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';

import {
  PERMISSIONS as P,
  type CalendarQuery,
  type CalendarRangeUpdate,
  type PropertyCreateInput,
  type PropertyUpdateInput,
  type UnitCreateInput,
  type UnitUpdateInput,
  calendarQuerySchema,
  calendarRangeUpdateSchema,
  propertyCreateSchema,
  propertyUpdateSchema,
  unitCreateSchema,
  unitUpdateSchema,
} from '@safra/contracts';

import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { CalendarService } from './calendar.service.js';
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
  ) {}

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
