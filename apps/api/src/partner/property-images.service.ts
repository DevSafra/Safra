import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
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
import { StorageService } from '../storage/storage.service.js';
import { IMAGE_IS_LIVE } from '../storage/image-visibility.js';
import { MEDIA_QUEUE } from '../queue/queue.tokens.js';
import { JOB_OPTIONS } from '../queue/queue.definitions.js';
import { MEDIA_JOB, mediaJobId } from '../queue/media.job.js';
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
  private readonly logger = new Logger(PropertyImageService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly images: ImageService,
    private readonly storage: StorageService,
    private readonly audit: AuditService,
    @Inject(MEDIA_QUEUE) private readonly media: Queue,
  ) {}

  /** What this property currently has, in display order. */
  async list(claims: AccessTokenClaims | undefined, reference: string) {
    const property = await this.requireOwn(claims, reference);

    const rows = await this.db.execute<ImageRow>(sql`
      SELECT id, file_key, width, height, variant_widths, is_cover, sort_order,
             alt_ar, alt_en, alt_de, status::text AS status, failure_code
      FROM property_images
      /*
        The OWNER's set, so a photograph that is still rendering is shown rather than hidden — one
        that vanished for ten seconds and came back would read as a bug — and one that FAILED is
        shown too, because it is the only place the partner can be told why.
      */
      WHERE property_id = ${property.id} AND deleted_at IS NULL
      ORDER BY sort_order, created_at
    `);

    return rows.rows.map((row) => this.toView(row));
  }

  /**
   * Accepts one photograph, and hands the encoding to a worker.
   *
   * `mimetype` and `originalname` are BOTH ignored — either can be set to anything by the client,
   * and only the decoded file header is evidence.
   *
   * ## What moved, and what deliberately did not
   *
   * Until BullMQ phase 3 this method decoded the file and wrote six re-encoded variants before
   * answering, which is roughly a second and a half of CPU and the reason the endpoint is throttled
   * to 20/min. That work is now a `media` job.
   *
   * **Validation did not move.** `inspect` still runs here, so a file that is not an image, or is a
   * decompression bomb, or is too small to use, is refused with a 400 the person who chose it can
   * read. Deferring that would turn a bad file into a dead letter and a silent gap in a gallery.
   *
   * ## The bytes are parked somewhere a stranger cannot read
   *
   * Between this method and the worker there is one moment where the platform holds a file exactly
   * as it arrived — the one thing `ImageService` otherwise guarantees never happens. It goes under
   * `incoming/`, which is outside the `properties/*` anonymous-read grant, and it is deleted as soon
   * as the variants exist.
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

    /*
      Where the new photograph goes: AFTER the last one, which is not the same as "at position
      `existing`".

      `sortOrder: existing` was the obvious version and it was wrong, because archiving does not
      renumber the rows it leaves behind. A gallery of three whose first two are archived still
      holds one image at position 2, and the count is 1 — so the next upload claimed position 1 and
      appeared BEFORE the photograph already there. The partner uploads a new picture and it lands
      in the middle of their gallery, which reads as the order being random.

      Positions can also COLLIDE this way, and a tie is broken by `created_at`, so two uploads into
      the same gap come back in an order nothing on the screen explains.
    */
    const nextPosition = await this.nextSortOrder(property.id);

    /* Cheap, and it throws — a file that is not a usable photograph never reaches storage. */
    const inspected = await this.images.inspect(file.buffer);

    const fileKey = this.images.keyFor({
      kind: 'properties',
      owner: property.reference,
    });
    const originalKey = this.images.incomingKeyFor(fileKey);

    /*
      Stored BEFORE the row exists, so the row is never a promise the storage cannot keep. The
      reverse order would leave a `processing` row pointing at an object that was never written if
      the upload failed here, and the worker would find nothing and mark it dead — a photograph the
      partner watched succeed, failing seconds later for a reason nothing records.
    */
    await this.storage.put(originalKey, file.buffer, 'application/octet-stream');

    const inserted = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(schema.propertyImages)
        .values({
          propertyId: property.id,
          fileKey,
          /*
            Known already: `inspect` read them from the header. The row is therefore complete apart
            from `variant_widths`, which is the one thing that genuinely cannot be known until the
            encodes have run — the pipeline never upscales, so the real widths depend on the source.
          */
          width: inspected.width,
          height: inspected.height,
          variantWidths: [],
          status: 'processing',
          originalKey,
          /* The first image becomes the cover, so a listing is never coverless. */
          isCover: existing === 0,
          sortOrder: nextPosition,
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
            fileKey,
            width: inspected.width,
            height: inspected.height,
            /* Recorded for support, never used as a key. */
            uploadedAs: file.originalname,
          },
        },
        tx as unknown as Database,
      );

      return row;
    });

    /*
      After the commit, and its failure is swallowed — the same shape as `NotificationService.notify`.

      An enqueue that throws must not undo an upload the partner has already been told succeeded, and
      the row is the durable record: it sits at `processing` with its `original_key` set, which is
      exactly what a re-drive needs and what `safra_images_processing_stuck` alerts on. Losing the
      job is recoverable; losing the row is not.
    */
    try {
      await this.media.add(
        MEDIA_JOB,
        { imageId: inserted.id, originalKey, fileKey },
        { ...JOB_OPTIONS.media, jobId: mediaJobId(inserted.id) },
      );
    } catch (error) {
      this.logger.error(
        `Could not enqueue rendering for image ${inserted.id}: ` +
          `${error instanceof Error ? error.message : String(error)}. ` +
          'The row stays processing and is recoverable by re-drive.',
      );
    }

    return {
      id: inserted.id,
      fileKey,
      width: inspected.width,
      height: inspected.height,
      status: 'processing' as const,
      /*
        The URLs are returned, and none of them resolves yet.

        Deliberate: they are the addresses those variants WILL have, the manager needs them to render
        the tile once processing finishes, and withholding them would mean a second shape of this
        response that the client has to branch on. `status` is the field that says whether they work
        — which is the whole reason the column exists.
      */
      urls: {
        thumbnail: this.images.publicUrl(fileKey, 400),
        medium: this.images.publicUrl(fileKey, 800),
        large: this.images.publicUrl(fileKey, 1600),
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
            WHERE property_id = ${property.id} AND ${IMAGE_IS_LIVE}
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

  /**
   * One past the last live position.
   *
   * `max + 1` over the live rows, not the count of them — see the note in `upload`. Zero for an
   * empty gallery, which keeps the first image at position 0 as before.
   */
  private async nextSortOrder(propertyId: string): Promise<number> {
    const result = await this.db.execute<{ next: string }>(
      sql`SELECT coalesce(max(sort_order) + 1, 0)::text AS next FROM property_images
          WHERE property_id = ${propertyId} AND ${IMAGE_IS_LIVE}`,
    );

    return Number(result.rows[0]?.next ?? 0);
  }

  private async countLive(propertyId: string): Promise<number> {
    const result = await this.db.execute<{ count: string }>(
      sql`SELECT count(*)::text AS count FROM property_images
          WHERE property_id = ${propertyId} AND ${IMAGE_IS_LIVE}`,
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
      status: row.status,
      /* An ERROR code. The partner's app resolves it; it is never a sentence from here. */
      failureCode: row.failure_code,
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
  status: string;
  failure_code: string | null;
  width: number | null;
  height: number | null;
  variant_widths: number[] | null;
  is_cover: boolean;
  sort_order: number;
  alt_ar: string | null;
  alt_en: string | null;
  alt_de: string | null;
};
