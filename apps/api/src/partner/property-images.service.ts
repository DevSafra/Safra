import { Inject, Injectable } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import {
  ERROR,
  PERMISSIONS as P,
  type PropertyImageAltInput,
  type PropertyImageOrderInput,
} from '@safra/contracts';

import { AuditService } from '../common/audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { ImageService } from '../storage/image.service.js';
import type { AccessTokenClaims } from '../auth/token.service.js';
import { requirePartnerId } from '../rbac/ownership.js';
import { badRequest, conflict, notFound } from '../common/errors/app-error.js';

/** §5.5 rewards photo count in the ranking, so a cap keeps that from being gamed. */
const MAX_IMAGES_PER_PROPERTY = 30;

/**
 * A property's photographs — the gallery §5.6 renders and §7.2 manages.
 *
 * ## Ownership is a WHERE clause, never a check afterwards
 *
 * Every method resolves the property through `requireOwn`, which filters on the `partnerId` from
 * the VERIFIED token. Another partner's reference is therefore indistinguishable from one that
 * does not exist — a 404, not a 403, so a reference cannot be probed for existence.
 *
 * ## Nothing is ever hard-deleted (P-003)
 *
 * Archiving sets `deleted_at`. The stored objects are deliberately left in place: an image is
 * evidence of what a listing claimed on the day somebody booked it, and a dispute about "the room
 * looked nothing like the photo" is unanswerable if the photo is gone.
 *
 * ## The cover is an invariant, not a flag somebody remembers to set
 *
 * A property with images always has exactly one cover. Uploading the first sets it; archiving the
 * cover promotes the next by sort order; setting one clears the rest. Before this service those
 * rules lived in one branch of the upload handler, and archiving the cover left a listing with
 * NO cover at all — the card fell back to «لا صورة بعد» while the property still had photographs.
 */
@Injectable()
export class PropertyImageService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly images: ImageService,
    private readonly audit: AuditService,
  ) {}

  /** What this property currently has, in display order. */
  async list(claims: AccessTokenClaims | undefined, reference: string) {
    const property = await this.requireOwn(claims, reference);

    const rows = await this.db.execute<ImageRow>(sql`
      SELECT id, file_key, width, height, variant_widths, is_cover, sort_order,
             alt_ar, alt_en, alt_de
      FROM property_images
      WHERE property_id = ${property.id} AND deleted_at IS NULL
      ORDER BY sort_order, created_at
    `);

    return rows.rows.map((row) => this.toView(row));
  }

  /**
   * Accepts one photograph.
   *
   * `mimetype` and `originalname` are BOTH ignored — either can be set to anything by the client,
   * and only the decoded file header is evidence. `ImageService.process` re-encodes, which strips
   * EXIF (and with it the GPS coordinates of somebody's home) as a side effect of doing the work.
   */
  async upload(
    claims: AccessTokenClaims | undefined,
    reference: string,
    file: { buffer: Buffer; originalname: string } | undefined,
  ) {
    const property = await this.requireOwn(claims, reference);

    if (!file?.buffer) throw badRequest(ERROR.UPLOAD_FILE_MISSING);

    const existing = await this.countLive(property.id);

    if (existing >= MAX_IMAGES_PER_PROPERTY) {
      throw badRequest(ERROR.PROPERTY_IMAGE_LIMIT, { max: MAX_IMAGES_PER_PROPERTY });
    }

    const processed = await this.images.process(file.buffer, {
      kind: 'properties',
      owner: property.reference,
    });

    const inserted = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.propertyImages)
        .values({
          propertyId: property.id,
          fileKey: processed.fileKey,
          width: processed.width,
          height: processed.height,
          // Distinct widths only — each appears twice, once per format.
          variantWidths: [...new Set(processed.variants.map((v) => v.width))],
          /* The first image becomes the cover, so a listing is never coverless. */
          isCover: existing === 0,
          sortOrder: existing,
        })
        .returning({ id: schema.propertyImages.id });

      if (!row) throw new Error('Image insert returned no row.');

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property_image.uploaded',
          subjectType: 'property',
          subjectId: property.id,
          after: {
            fileKey: processed.fileKey,
            width: processed.width,
            height: processed.height,
            /* Recorded for support, never used as a key. */
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

  /**
   * Archives one image (P-003 — a soft delete, never a removal).
   *
   * ## The two rules that were missing
   *
   * **A published listing keeps at least one image.** §5.6's gallery and every search result card
   * assume a photograph; archiving the last one leaves a published listing rendering a placeholder
   * to customers. Refused with a message that names the remedy — upload the replacement first.
   *
   * **Archiving the cover promotes the next.** Previously it did not, and the property kept its
   * photographs while its card said «لا صورة بعد». Promotion is by sort order, so it is the image
   * the partner already placed first among the rest.
   */
  async archive(
    claims: AccessTokenClaims | undefined,
    reference: string,
    imageId: string,
  ) {
    const property = await this.requireOwn(claims, reference);

    const found = await this.db.execute<{ id: string; is_cover: boolean }>(sql`
      SELECT id, is_cover FROM property_images
      WHERE id = ${imageId} AND property_id = ${property.id} AND deleted_at IS NULL
    `);

    const image = found.rows[0];

    if (!image) throw notFound(ERROR.IMAGE_NOT_FOUND);

    const live = await this.countLive(property.id);

    if (live <= 1 && property.status === 'published') {
      throw conflict(ERROR.IMAGE_LAST_ONE);
    }

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.propertyImages)
        .set({ deletedAt: new Date() })
        .where(eq(schema.propertyImages.id, imageId));

      /*
        Promote the next by sort order. `UPDATE … WHERE id = (SELECT … LIMIT 1)` rather than a read
        then a write, so two concurrent archives cannot both promote and leave two covers — the
        partial index below would reject the second, which is the guarantee doing its job.
      */
      if (image.is_cover) {
        await tx.execute(sql`
          UPDATE property_images
          SET is_cover = true
          WHERE id = (
            SELECT id FROM property_images
            WHERE property_id = ${property.id} AND deleted_at IS NULL
            ORDER BY sort_order, created_at
            LIMIT 1
          )
        `);
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property_image.archived',
          subjectType: 'property_image',
          subjectId: imageId,
          after: { wasCover: image.is_cover },
        },
        tx as unknown as Database,
      );
    });

    return { id: imageId, archived: true as const };
  }

  /**
   * Sets the display order from the FULL list of ids.
   *
   * The set must match the property's live images exactly. A partial array would otherwise be
   * ambiguous — does an omitted image go last, or was it meant to be archived? — and guessing
   * either way silently changes what a customer sees.
   */
  async reorder(
    claims: AccessTokenClaims | undefined,
    reference: string,
    input: PropertyImageOrderInput,
  ) {
    const property = await this.requireOwn(claims, reference);

    const live = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM property_images
      WHERE property_id = ${property.id} AND deleted_at IS NULL
    `);

    const liveIds = new Set(live.rows.map((row) => row.id));
    const givenIds = new Set(input.imageIds);

    const sameSet =
      liveIds.size === givenIds.size && [...liveIds].every((id) => givenIds.has(id));

    if (!sameSet) throw badRequest(ERROR.IMAGE_ORDER_MISMATCH);

    await this.db.transaction(async (tx) => {
      for (const [index, id] of input.imageIds.entries()) {
        await tx
          .update(schema.propertyImages)
          .set({ sortOrder: index })
          .where(eq(schema.propertyImages.id, id));
      }

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property_image.reordered',
          subjectType: 'property',
          subjectId: property.id,
          after: { order: input.imageIds },
        },
        tx as unknown as Database,
      );
    });

    return { reordered: input.imageIds.length };
  }

  /**
   * Makes one image the cover.
   *
   * Clears the others FIRST, in the same transaction. A partial unique index allows one cover per
   * property, so setting before clearing would collide with the outgoing cover — the order here is
   * not stylistic.
   */
  async setCover(
    claims: AccessTokenClaims | undefined,
    reference: string,
    imageId: string,
  ) {
    const property = await this.requireOwn(claims, reference);

    const found = await this.db.execute<{ id: string }>(sql`
      SELECT id FROM property_images
      WHERE id = ${imageId} AND property_id = ${property.id} AND deleted_at IS NULL
    `);

    if (!found.rows[0]) throw notFound(ERROR.IMAGE_NOT_FOUND);

    await this.db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE property_images SET is_cover = false
        WHERE property_id = ${property.id} AND is_cover = true
      `);
      await tx.execute(sql`
        UPDATE property_images SET is_cover = true WHERE id = ${imageId}
      `);

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'property_image.cover_set',
          subjectType: 'property',
          subjectId: property.id,
          after: { imageId },
        },
        tx as unknown as Database,
      );
    });

    return { id: imageId, isCover: true as const };
  }

  /**
   * Sets alternative text, per locale.
   *
   * Not audited. Alt text is copy rather than a decision about money, access or visibility, and an
   * audit row per keystroke-sized edit would bury the events §15 exists to surface. The change is
   * still attributable through the property's own history.
   */
  async setAlt(
    claims: AccessTokenClaims | undefined,
    reference: string,
    imageId: string,
    input: PropertyImageAltInput,
  ) {
    const property = await this.requireOwn(claims, reference);

    const updated = await this.db
      .update(schema.propertyImages)
      .set({
        altAr: input.ar ?? null,
        altEn: input.en ?? null,
        altDe: input.de ?? null,
      })
      .where(
        and(
          eq(schema.propertyImages.id, imageId),
          eq(schema.propertyImages.propertyId, property.id),
          isNull(schema.propertyImages.deletedAt),
        ),
      )
      .returning({ id: schema.propertyImages.id });

    if (!updated[0]) throw notFound(ERROR.IMAGE_NOT_FOUND);

    return { id: imageId, updated: true as const };
  }

  /**
   * The property, if it belongs to the caller.
   *
   * A 404 for another partner's reference — never a 403. The two must be indistinguishable, or the
   * endpoint becomes a way to discover which references exist.
   */
  private async requireOwn(claims: AccessTokenClaims | undefined, reference: string) {
    const partnerId = requirePartnerId(claims, P.PROPERTY_MANAGE_OWN);

    const property = await this.db.query.properties.findFirst({
      where: and(
        eq(schema.properties.reference, reference),
        eq(schema.properties.partnerId, partnerId),
        isNull(schema.properties.deletedAt),
      ),
      columns: { id: true, reference: true, status: true },
    });

    if (!property) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    return property;
  }

  private async countLive(propertyId: string): Promise<number> {
    const result = await this.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM property_images
          WHERE property_id = ${propertyId} AND deleted_at IS NULL`,
    );

    return Number(result.rows[0]?.count ?? 0);
  }

  private toView(row: ImageRow) {
    return {
      id: row.id,
      fileKey: row.file_key,
      width: row.width,
      height: row.height,
      variantWidths: row.variant_widths ?? [],
      isCover: row.is_cover,
      sortOrder: row.sort_order,
      alt: { ar: row.alt_ar, en: row.alt_en, de: row.alt_de },
      urls: {
        thumbnail: this.images.publicUrl(row.file_key, 400),
        medium: this.images.publicUrl(row.file_key, 800),
        large: this.images.publicUrl(row.file_key, 1600),
      },
    };
  }
}

type ImageRow = {
  id: string;
  file_key: string;
  width: number | null;
  height: number | null;
  variant_widths: number[] | null;
  is_cover: boolean;
  sort_order: number;
  alt_ar: string | null;
  alt_en: string | null;
  alt_de: string | null;
};
