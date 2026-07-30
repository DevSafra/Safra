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
import { Throttle } from '@nestjs/throttler';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { PERMISSIONS as P } from '@safra/contracts';

import { AuditExempt } from '../common/audit/audit.interceptor.js';
import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ImageService } from '../storage/image.service.js';
import { CurrentUser, RequirePermissions } from '../rbac/decorators.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';

/** §5.5 rewards photo count in the ranking, so a cap keeps that from being gamed. */
const MAX_IMAGES_PER_PROPERTY = 30;

/**
 * Property image upload (roadmap item 81, feeding §5.6's gallery).
 *
 * Multipart upload rather than a presigned URL. A presigned PUT would let the
 * browser write straight to the bucket and save us the bandwidth, but it also means
 * the object lands **unvalidated** — we could not decode it, strip its EXIF, or
 * confirm it is even an image before it is publicly readable. Routing bytes through
 * the API keeps that guarantee; if bandwidth becomes the constraint, the fix is a
 * presigned upload into a quarantine bucket plus a processing worker, not skipping
 * validation.
 */
@Controller('partner/properties/:reference/images')
export class PartnerImagesController {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly images: ImageService,
    private readonly audit: AuditService,
  ) {}

  @Post()
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Audited transactionally alongside the property_images insert.')
  // Image processing is CPU-heavy, so the budget is tighter than the global one.
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(
    FileInterceptor('file', {
      // Held in memory: sharp needs the whole buffer, and a temp file would be one
      // more place an unvalidated upload could sit.
      limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    }),
  )
  async upload(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @UploadedFile()
    file: { buffer: Buffer; mimetype: string; originalname: string } | undefined,
  ) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);

    if (!file?.buffer) {
      throw new BadRequestException('No file was uploaded under the field name "file".');
    }

    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        eq(schema.properties.partnerId, partnerId),
        isNull(schema.properties.deletedAt),
      ),
      columns: { id: true, reference: true },
    });

    // 404 rather than 403 — another partner's reference must not be confirmable.
    if (!property) throw new NotFoundException('Property not found.');

    const existing = await this.db.execute<{ count: string }>(
      sql`SELECT COUNT(*)::text AS count FROM property_images
          WHERE property_id = ${property.id} AND deleted_at IS NULL`,
    );

    if (Number(existing.rows[0]?.count ?? 0) >= MAX_IMAGES_PER_PROPERTY) {
      throw new BadRequestException(
        `A property may have at most ${MAX_IMAGES_PER_PROPERTY} images.`,
      );
    }

    /**
     * file.mimetype and file.originalname are BOTH ignored. Either can be set to
     * anything by the client; only the decoded file header is evidence.
     */
    const processed = await this.images.process(file.buffer, {
      kind: 'properties',
      owner: property.reference,
    });

    const inserted = await this.db.transaction(async (tx) => {
      const isFirst = Number(existing.rows[0]?.count ?? 0) === 0;

      const [row] = await tx
        .insert(schema.propertyImages)
        .values({
          propertyId: property.id,
          fileKey: processed.fileKey,
          width: processed.width,
          height: processed.height,
          // Distinct widths only — each appears twice, once per format.
          variantWidths: [...new Set(processed.variants.map((v) => v.width))],
          // The first image becomes the cover, so a listing is never coverless.
          isCover: isFirst,
          sortOrder: Number(existing.rows[0]?.count ?? 0),
        })
        .returning({ id: schema.propertyImages.id });

      if (!row) throw new Error('Image insert returned no row.');

      await this.audit.record(
        {
          actorUserId: user?.sub,
          actorRole: user?.role,
          action: 'property_image.uploaded',
          subjectType: 'property',
          subjectId: property.id,
          after: {
            fileKey: processed.fileKey,
            width: processed.width,
            height: processed.height,
            // The original filename is recorded for support, never used as a key.
            uploadedAs: file.originalname,
          },
        },
        tx as unknown as Database,
      );

      return row;
    });

    return {
      id: inserted.id,
      fileKey: processed.fileKey,
      width: processed.width,
      height: processed.height,
      urls: {
        thumbnail: this.images.publicUrl(processed.fileKey, 400),
        medium: this.images.publicUrl(processed.fileKey, 800),
        large: this.images.publicUrl(processed.fileKey, 1600),
      },
    };
  }

  /** Soft delete only (P-003). The stored objects are intentionally left in place. */
  @Delete(':imageId')
  @RequirePermissions(P.PROPERTY_MANAGE_OWN)
  @AuditExempt('Audited transactionally alongside the soft delete.')
  async remove(
    @CurrentUser() user: AccessTokenClaims | undefined,
    @Param('reference') reference: string,
    @Param('imageId') imageId: string,
  ) {
    const partnerId = requirePartnerId(user, P.PROPERTY_MANAGE_OWN);

    const rows = await this.db
      .select({ id: schema.propertyImages.id, isCover: schema.propertyImages.isCover })
      .from(schema.propertyImages)
      .innerJoin(
        schema.properties,
        eq(schema.properties.id, schema.propertyImages.propertyId),
      )
      .where(
        and(
          eq(schema.propertyImages.id, imageId),
          eq(schema.properties.reference, reference),
          eq(schema.properties.partnerId, partnerId),
          isNull(schema.propertyImages.deletedAt),
        ),
      )
      .limit(1);

    const image = rows[0];
    if (!image) throw new NotFoundException('Image not found.');

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.propertyImages)
        .set({ deletedAt: new Date() })
        .where(eq(schema.propertyImages.id, imageId));

      await this.audit.record(
        {
          actorUserId: user?.sub,
          actorRole: user?.role,
          action: 'property_image.archived',
          subjectType: 'property_image',
          subjectId: imageId,
        },
        tx as unknown as Database,
      );
    });

    return { id: imageId, archived: true };
  }
}
