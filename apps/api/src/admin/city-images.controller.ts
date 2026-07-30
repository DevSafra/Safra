import {
  BadRequestException,
  Controller,
  Delete,
  Inject,
  NotFoundException,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { Audited } from '../common/audit/audit.interceptor.js';
import { DATABASE } from '../database/database.module.js';
import { ImageService } from '../storage/image.service.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

const MAX_IMAGES_PER_CITY = 12;

/**
 * City hero photography (§5.4), uploaded by staff rather than partners — a city page
 * is SAFRA's own marketing surface, not a partner's listing.
 *
 * Gated on GEO_MANAGE, the same permission that governs cities and countries.
 */
@Controller('admin/cities/:slug/images')
export class CityImagesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly images: ImageService,
  ) {}

  @Post()
  @RequirePermissions(P.GEO_MANAGE)
  @Audited({ action: 'city_image.uploaded', subjectType: 'city', subjectParam: 'slug' })
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024, files: 1 } }),
  )
  async upload(
    @CurrentUser() _user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
    @UploadedFile() file: { buffer: Buffer } | undefined,
  ) {
    if (!file?.buffer) {
      throw new BadRequestException('No file was uploaded under the field name "file".');
    }

    const city = await this.db.query.cities.findFirst({
      where: and(eq(schema.cities.slug, slug), isNull(schema.cities.deletedAt)),
      columns: { id: true, slug: true },
    });

    if (!city) throw new NotFoundException('City not found.');

    const existing = await this.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM city_images
          WHERE city_id = ${city.id} AND deleted_at IS NULL`,
    );
    const count = Number(existing.rows[0]?.count ?? 0);

    if (count >= MAX_IMAGES_PER_CITY) {
      throw new BadRequestException(
        `A city may have at most ${MAX_IMAGES_PER_CITY} images.`,
      );
    }

    // Same pipeline as property images: decoded, re-encoded, EXIF stripped.
    const processed = await this.images.process(file.buffer, {
      kind: 'cities',
      owner: city.slug,
    });

    const [row] = await this.db
      .insert(schema.cityImages)
      .values({
        cityId: city.id,
        fileKey: processed.fileKey,
        width: processed.width,
        height: processed.height,
        variantWidths: [...new Set(processed.variants.map((v) => v.width))],
        isHero: count === 0,
        sortOrder: count,
      })
      .returning({ id: schema.cityImages.id });

    if (!row) throw new Error('City image insert returned no row.');

    return {
      id: row.id,
      fileKey: processed.fileKey,
      width: processed.width,
      height: processed.height,
    };
  }

  /** Soft delete only (P-003). */
  @Delete(':imageId')
  @RequirePermissions(P.GEO_MANAGE)
  @Audited({
    action: 'city_image.archived',
    subjectType: 'city_image',
    subjectParam: 'imageId',
  })
  async remove(@Param('slug') slug: string, @Param('imageId') imageId: string) {
    const rows = await this.db
      .select({ id: schema.cityImages.id })
      .from(schema.cityImages)
      .innerJoin(schema.cities, eq(schema.cities.id, schema.cityImages.cityId))
      .where(
        and(
          eq(schema.cityImages.id, imageId),
          eq(schema.cities.slug, slug),
          isNull(schema.cityImages.deletedAt),
        ),
      )
      .limit(1);

    if (rows.length === 0) throw new NotFoundException('Image not found.');

    await this.db
      .update(schema.cityImages)
      .set({ deletedAt: new Date() })
      .where(eq(schema.cityImages.id, imageId));

    return { id: imageId, archived: true };
  }
}
