import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';

import {
  PERMISSIONS as P,
  groupTripCreateSchema,
  groupTripUpdateSchema,
  pageQuerySchema,
  type GroupTripCreateInput,
  type GroupTripUpdateInput,
  type PageQuery,
} from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import { GroupTripsService } from './group-trips.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/**
 * جروبات — the console's half (Bashar, 2026-09-27; built 2026-09-28).
 *
 * `SETTINGS_READ` opens the registry, `CATALOGUE_MANAGE` changes it — the split كتالوج المنصّة
 * draws, for the reason given there: operations staff read this catalogue all day and only a super
 * admin rewrites it.
 *
 * Numbered pages rather than a cursor, because this is a console registry and the reader types a
 * page number. `@AuditExempt` on every write: the service records inside the same transaction, so
 * the interceptor must not write a second, weaker row beside it.
 */
@Controller('admin/group-trips')
export class GroupTripsController {
  constructor(private readonly trips: GroupTripsService) {}

  @Get()
  @RequirePermissions(P.SETTINGS_READ)
  async list(@Query(new ZodValidationPipe(pageQuerySchema)) query: PageQuery) {
    return this.trips.list(query);
  }

  @Get(':slug')
  @RequirePermissions(P.SETTINGS_READ)
  async one(@Param('slug') slug: string) {
    return this.trips.bySlug(slug);
  }

  @Post()
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('GroupTripsService records group_trip.created inside the transaction.')
  async create(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Body(new ZodValidationPipe(groupTripCreateSchema)) body: GroupTripCreateInput,
  ) {
    return this.trips.create(user, body);
  }

  @Patch(':slug')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('GroupTripsService records group_trip.updated inside the transaction.')
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(groupTripUpdateSchema)) body: GroupTripUpdateInput,
  ) {
    return this.trips.update(user, slug, body);
  }

  @Delete(':slug')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('GroupTripsService records group_trip.deleted inside the transaction.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
  ) {
    return this.trips.remove(user, slug);
  }
}
