import {
  Body,
  Controller,
  Delete,
  Inject,
  Param,
  Patch,
  Post,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  updateCityImageSchema,
  type UpdateCityImageInput,
} from '@safra/contracts';

import { Audited, AuditExempt } from '../common/audit/audit.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { ImageService } from '../storage/image.service.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

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
    private readonly audit: AuditService,
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
      throw badRequest(ERROR.UPLOAD_FILE_MISSING);
    }

    const city = await this.db.query.cities.findFirst({
      where: and(eq(schema.cities.slug, slug), isNull(schema.cities.deletedAt)),
      columns: { id: true, slug: true },
    });

    if (!city) throw notFound(ERROR.GEO_CITY_NOT_FOUND);

    const existing = await this.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM city_images
          WHERE city_id = ${city.id} AND deleted_at IS NULL`,
    );
    const count = Number(existing.rows[0]?.count ?? 0);

    if (count >= MAX_IMAGES_PER_CITY) {
      throw badRequest(ERROR.GEO_CITY_IMAGE_LIMIT, { max: MAX_IMAGES_PER_CITY });
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

  /**
   * What a photograph SAYS — its alt text, its credit, where it sits, and whether it is the hero.
   *
   * ## The gap (Bashar, 2026-08-31)
   *
   * «Add management for city image metadata (hero image selection, alt text, sort order and
   * credit) so the public city pages can be managed correctly and accessibly.»
   *
   * Every one of these columns has existed since `city_images` was created and NONE of them could
   * be written: the upload set `is_hero` on the first picture and `sort_order` by arrival, and
   * `alt_ar/en/de` stayed NULL for ever. §5.4's hero band is the first third of the public city
   * page, so every city photograph the platform has ever served went out with an EMPTY alt — a
   * screen reader announced nothing at all. That is the accessibility half of this endpoint, and
   * it is the half that matters.
   *
   * ## The hero is exclusive, and that is enforced here rather than hoped for
   *
   * Two heroes is not a state §5.4 can draw — `ORDER BY is_hero DESC` would pick either. The
   * previous hero is cleared in the SAME transaction that names the new one, so there is no
   * instant at which a reader could see two or none.
   *
   * ## Nothing here touches the bytes
   *
   * `file_key`, `width`, `height` and `variant_widths` are the worker's. A form that could edit
   * them would be a form that can make a row describe an object that is not there.
   */
  @Patch(':imageId')
  @RequirePermissions(P.GEO_MANAGE)
  @AuditExempt('Recorded inside the transaction, with the previous hero it displaced.')
  async update(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('slug') slug: string,
    @Param('imageId') imageId: string,
    @Body(new ZodValidationPipe(updateCityImageSchema)) body: UpdateCityImageInput,
  ) {
    const found = await this.db.execute<{ id: string; city_id: string }>(sql`
      SELECT i.id::text, i.city_id::text
      FROM city_images i
      JOIN cities c ON c.id = i.city_id
      WHERE i.id = ${imageId}::uuid AND c.slug = ${slug}
        AND i.deleted_at IS NULL AND c.deleted_at IS NULL
      LIMIT 1
    `);

    const image = found.rows[0];

    if (!image) throw notFound(ERROR.IMAGE_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      /* One hero per city — the previous one goes in the same breath as the new one. */
      if (body.isHero === true) {
        await tx.execute(sql`
          UPDATE city_images SET is_hero = false, updated_at = now()
          WHERE city_id = ${image.city_id}::uuid AND id <> ${image.id}::uuid
            AND is_hero AND deleted_at IS NULL
        `);
      }

      /*
        `IS DISTINCT FROM` is not needed here, but the ABSENT-versus-NULL distinction is: an alt
        text or a credit the caller did not send must be left alone, and one sent as `null` must
        be cleared. `coalesce` cannot say both, so each column is only written when its key is
        present — an empty alt is the correct answer for a decorative image.
      */
      await tx.execute(sql`
        UPDATE city_images SET
          alt_ar     = ${'altAr' in body ? sql`${body.altAr ?? null}` : sql`alt_ar`},
          alt_en     = ${'altEn' in body ? sql`${body.altEn ?? null}` : sql`alt_en`},
          alt_de     = ${'altDe' in body ? sql`${body.altDe ?? null}` : sql`alt_de`},
          credit     = ${'credit' in body ? sql`${body.credit ?? null}` : sql`credit`},
          is_hero    = ${body.isHero === true ? sql`true` : sql`is_hero`},
          sort_order = coalesce(${body.sortOrder ?? null}, sort_order),
          updated_at = now()
        WHERE id = ${image.id}::uuid
      `);

      await this.audit.record(
        {
          actorUserId: user?.sub,
          actorRole: user?.role,
          action: 'city_image.updated',
          subjectType: 'city_image',
          subjectId: image.id,
          before: { slug },
          after: { slug, ...body },
        },
        tx as unknown as Database,
      );
    });

    return { id: image.id };
  }

  /**
   * Soft delete only (P-003), and it may never leave the city without a photograph.
   *
   * Two rules, both from Bashar on 2026-09-02, and they are the same rule seen from two sides:
   * **every city has at least one image**, and **deleting the main promotes the next one**.
   *
   * ## Why the last image cannot go
   *
   * The public destination card and §5.4's hero band both draw a city's photograph. Archiving the
   * only one leaves the card falling back to the ornament — which is a designed state for a city
   * nobody has photographed YET, not an outcome an operator should be able to produce by pressing
   * delete. So it is refused with a message that says what to do instead: upload the replacement
   * first. This is the shape `property-images.service.ts` already uses for a published listing.
   *
   * ## Why the promotion is a subquery rather than a read and a write
   *
   * `UPDATE … WHERE id = (SELECT … LIMIT 1)` inside the transaction, so two operators archiving
   * two images at once cannot both read «the next one» as the same row and both promote it. The
   * order is `sort_order, created_at` — EXACTLY the order the console lists them in, so «the first
   * image on the list» means the same thing to the operator and to this statement. The public read
   * orders by `is_hero DESC, sort_order`, which is a different question and deliberately so.
   *
   * Without the promotion the city keeps zero heroes. Nothing 500s — the public cover query falls
   * through to `sort_order` and still finds a picture — but the console then shows no «الرئيسية»
   * badge at all, so the operator and the site disagree about which photograph is the main one,
   * and the next upload silently becomes the cover.
   */
  @Delete(':imageId')
  @RequirePermissions(P.GEO_MANAGE)
  @Audited({
    action: 'city_image.archived',
    subjectType: 'city_image',
    subjectParam: 'imageId',
  })
  async remove(@Param('slug') slug: string, @Param('imageId') imageId: string) {
    const found = await this.db
      .select({
        id: schema.cityImages.id,
        cityId: schema.cityImages.cityId,
        isHero: schema.cityImages.isHero,
      })
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

    const image = found[0];

    if (!image) throw notFound(ERROR.IMAGE_NOT_FOUND);

    const live = await this.db.execute<{ n: number }>(sql`
      SELECT count(*)::int AS n FROM city_images
      WHERE city_id = ${image.cityId}::uuid AND deleted_at IS NULL
    `);

    if (Number(live.rows[0]?.n ?? 0) <= 1) {
      throw conflict(ERROR.GEO_CITY_IMAGE_LAST_ONE);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.cityImages)
        .set({ deletedAt: new Date() })
        .where(eq(schema.cityImages.id, imageId));

      if (image.isHero) {
        await tx.execute(sql`
          UPDATE city_images SET is_hero = true, updated_at = now()
          WHERE id = (
            SELECT id FROM city_images
            WHERE city_id = ${image.cityId}::uuid AND deleted_at IS NULL
            ORDER BY sort_order, created_at
            LIMIT 1
          )
        `);
      }
    });

    return { id: imageId, archived: true };
  }
}
