import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';

import {
  ERROR,
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
import { SettingsRevalidationService } from '../settings/settings-revalidation.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest } from '../common/errors/app-error.js';

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
  constructor(
    private readonly trips: GroupTripsService,
    /*
      Why a controller reaches for this: the customer app caches جروبات for five minutes, so a trip
      published here — or a cover uploaded here — sat behind the old view until the window expired.
      Bashar raised exactly that about a city photograph on 2026-09-13, and كتالوج المنصّة's image
      controller has purged ever since. Best-effort and already-committed: a customer app that is
      restarting must never fail a write that succeeded.
    */
    private readonly revalidation: SettingsRevalidationService,
  ) {}

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
    const created = await this.trips.create(user, body);

    await this.revalidation.revalidateCatalogue(`group_trip.created ${created.slug}`);

    return created;
  }

  @Patch(':slug')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('GroupTripsService records group_trip.updated inside the transaction.')
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
    @Body(new ZodValidationPipe(groupTripUpdateSchema)) body: GroupTripUpdateInput,
  ) {
    const updated = await this.trips.update(user, slug, body);

    await this.revalidation.revalidateCatalogue(`group_trip.updated ${slug}`);

    return updated;
  }

  /**
   * The cover photograph's BYTES (Bashar, 2026-09-29).
   *
   * Ten megabytes and one file, the same ceiling the city hero takes — a limit set on the
   * interceptor rather than checked afterwards, so an oversized upload is refused before it is
   * read into memory rather than after.
   *
   * `CATALOGUE_MANAGE`, like every other write on this controller: authoring a trip and
   * illustrating it are the same job, so a second permission would be a distinction with nobody
   * on the other side of it.
   */
  @Post(':slug/cover')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt(
    'GroupTripsService records group_trip.cover_uploaded inside the transaction.',
  )
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async uploadCover(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file?.buffer) throw badRequest(ERROR.UPLOAD_FILE_MISSING);

    const row = await this.trips.setCover(user, slug, file.buffer);

    await this.revalidation.revalidateCatalogue(`group_trip.cover_uploaded ${slug}`);

    return row;
  }

  @Delete(':slug/cover')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt(
    'GroupTripsService records group_trip.cover_removed inside the transaction.',
  )
  async removeCover(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
  ) {
    const row = await this.trips.removeCover(user, slug);

    await this.revalidation.revalidateCatalogue(`group_trip.cover_removed ${slug}`);

    return row;
  }

  @Delete(':slug')
  @RequirePermissions(P.CATALOGUE_MANAGE)
  @AuditExempt('GroupTripsService records group_trip.deleted inside the transaction.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
  ) {
    const removed = await this.trips.remove(user, slug);

    await this.revalidation.revalidateCatalogue(`group_trip.deleted ${slug}`);

    return removed;
  }
}
