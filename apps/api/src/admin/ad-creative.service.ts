import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import type { Queue } from 'bullmq';

import { schema, type Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../common/audit/audit.service.js';
import { ImageService } from '../storage/image.service.js';
import { StorageService } from '../storage/storage.service.js';
import { MEDIA_JOB, creativeJobId, type MediaJobData } from '../queue/media.job.js';
import { JOB_OPTIONS, QUEUE } from '../queue/queue.definitions.js';
import { MEDIA_QUEUE } from '../queue/queue.tokens.js';
import { badRequest, notFound } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';
import { assertCanWrite, scopeFilter } from '../rbac/scope.sql.js';
import type { AccessTokenClaims } from '../auth/token.service.js';

/** What the console is handed back, so it can render the tile before the worker finishes. */
export interface AdCreative {
  readonly status: 'processing' | 'ready' | 'failed';
  readonly url: string | null;
  readonly width: number | null;
  readonly height: number | null;
  readonly failureCode: string | null;
}

/**
 * The creative image on an advertising campaign — the SAME pipeline the listings use.
 *
 * ## Why this is not a new pipeline
 *
 * Because the security lives in the pipeline, not in the caller. `ImageService.inspect` refuses
 * anything whose magic bytes are not a supported photograph, the worker DECODES and RE-ENCODES
 * every byte — which destroys polyglot files, strips EXIF including the GPS coordinates of
 * somebody's home, and guarantees the stored bytes match the content type we advertise — and
 * nothing the client uploaded is ever served. A second implementation would be a second place for
 * one of those to be forgotten.
 *
 * So this service does what `PropertyImageService.upload` does, minus the gallery: inspect, park the
 * original under the private `incoming/` prefix, write the row as `processing`, enqueue the render.
 * The worker branches on `MediaSubject` and writes the widths back here instead of to
 * `property_images`.
 *
 * ## One image, and no cover
 *
 * A campaign has one creative. There is no sort order, no cover to promote when one fails, and no
 * limit to enforce — a second upload REPLACES the first, and the old object is left for the same
 * reason a soft-deleted image keeps its bytes (P-003): the audit row points at a key, and a key
 * that resolves to nothing makes the record unverifiable.
 *
 * ## A campaign with no image is still a complete ad
 *
 * A headline and an advertiser name are the whole of §9.3's requirement. So every failure here is
 * recoverable by uploading again, and delivery simply omits `imageUrl` until the status is `ready`.
 */
@Injectable()
export class AdCreativeService {
  private readonly logger = new Logger(AdCreativeService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
    private readonly images: ImageService,
    private readonly storage: StorageService,
    @Inject(MEDIA_QUEUE) private readonly media: Queue<MediaJobData>,
  ) {}

  /**
   * Accepts one file for one campaign.
   *
   * Scoped like every other write on a campaign: the predicate so an out-of-scope reference answers
   * exactly as one that does not exist, `assertCanWrite` so a `read_only` member who may read the
   * registry cannot change what a city is shown.
   */
  async upload(
    claims: AccessTokenClaims | undefined,
    reference: string,
    file: { buffer: Buffer; originalname: string } | undefined,
  ): Promise<AdCreative> {
    const found = await this.db.execute<{ id: string; city_id: string | null }>(sql`
      SELECT id, city_id::text AS city_id FROM ad_campaigns
      WHERE reference = ${reference} AND deleted_at IS NULL
        AND ${scopeFilter(claims, 'city_id')}
      LIMIT 1
    `);

    const campaign = found.rows[0];

    if (!campaign) throw notFound(ERROR.CAMPAIGN_NOT_FOUND);

    assertCanWrite(claims, campaign.city_id);

    if (!file?.buffer) throw badRequest(ERROR.UPLOAD_FILE_MISSING);

    /* Cheap, and it throws — a file that is not a usable photograph never reaches storage. */
    const inspected = await this.images.inspect(file.buffer);

    const fileKey = this.images.keyFor({ kind: 'ads', owner: reference });
    const originalKey = this.images.incomingKeyFor(fileKey);

    /*
      Stored BEFORE the row points at it, so the row is never a promise the storage cannot keep —
      the same ordering, and the same reasoning, as the listing pipeline.
    */
    await this.storage.put(originalKey, file.buffer, 'application/octet-stream');

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.adCampaigns)
        .set({
          imageFileKey: fileKey,
          imageWidth: inspected.width,
          imageHeight: inspected.height,
          imageVariantWidths: [],
          imageStatus: 'processing',
          imageOriginalKey: originalKey,
          imageFailureCode: null,
        })
        .where(eq(schema.adCampaigns.id, campaign.id));

      await this.audit.record(
        {
          actorUserId: claims?.sub,
          actorRole: claims?.role,
          action: 'ad_campaign.creative_uploaded',
          subjectType: 'ad_campaign',
          subjectId: campaign.id,
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
    });

    /*
      After the commit, and its failure is swallowed.

      An enqueue that throws must not undo an upload the operator has been told succeeded, and the
      row is the durable record: it sits at `processing` with `image_original_key` set, which is
      exactly what a re-drive needs.
    */
    try {
      await this.media.add(
        MEDIA_JOB,
        { imageId: campaign.id, originalKey, fileKey, subject: 'ad_campaign' },
        /*
          Keyed on the FILE, not the campaign — see `creativeJobId`. Keying on the row made every
          replacement after the first a silent no-op for a day.
        */
        { ...JOB_OPTIONS.media, jobId: creativeJobId(fileKey) },
      );
    } catch (error) {
      this.logger.error(
        `Could not enqueue rendering for campaign ${reference}: ${describeError(error)}. ` +
          `The row stays processing on the ${QUEUE.media} queue and is recoverable by re-drive.`,
      );
    }

    return {
      status: 'processing',
      /*
        The URL is returned and does not resolve yet — deliberate, exactly as the listing upload
        does it. It is the address the variant WILL have, the console needs it to render the tile
        once processing finishes, and `status` is the field that says whether it works.
      */
      /* No variants yet — the address the render will produce. See `creativeUrl`. */
      url: creativeUrl(this.images, fileKey, null),
      width: inspected.width,
      height: inspected.height,
      failureCode: null,
    };
  }
}

/**
 * The width an ad tile is served at, WHERE ONE THAT WIDE EXISTS.
 *
 * One width rather than a srcset: the customer app renders the creative in a card of a fixed size,
 * and offering three would be three objects stored for a picture nobody zooms into.
 */
export const CREATIVE_WIDTH = 800;

/**
 * The URL of the widest variant that ACTUALLY EXISTS at or below `CREATIVE_WIDTH`.
 *
 * ## Why this is not `publicUrl(fileKey, CREATIVE_WIDTH)`
 *
 * Because the pipeline never upscales. A 640px creative produces variants at 400 and 640 and NO
 * 800 — so asking for 800 addresses an object that was never written, and the browser renders a
 * broken image: `naturalWidth` zero, a 404 nobody sees, on a picture the row says is `ready`.
 *
 * Found by a test that replaced a 900px creative with a 640px one, which is an ordinary thing for
 * an operator to do. `apps/web/src/lib/property.ts` had already solved this for the listing gallery
 * — «the pipeline never upscales, so a 1200px source has no 1600px variant» — and this is the same
 * problem arriving at a second caller.
 *
 * Falls back to the SMALLEST variant when every one is wider than the target, and to the target
 * itself when the row records none at all: a row still `processing` has an empty array, and the
 * address it produces is the one the variant will have.
 */
export function creativeUrl(
  images: ImageService,
  fileKey: string,
  variantWidths: readonly number[] | null,
): string {
  const available = [...(variantWidths ?? [])].sort((a, b) => a - b);
  const chosen =
    available.filter((width) => width <= CREATIVE_WIDTH).pop() ??
    available[0] ??
    CREATIVE_WIDTH;

  return images.publicUrl(fileKey, chosen);
}
