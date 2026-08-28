import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { eq, sql } from 'drizzle-orm';

import type { Database } from '@safra/db';
import { schema } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { ImageService } from '../storage/image.service.js';
import { StorageService } from '../storage/storage.service.js';
import { QUEUE } from './queue.definitions.js';
import { DeadLetterService } from './dead-letter.service.js';
import { MEDIA_JOB, type MediaJobData, type MediaSubject } from './media.job.js';
import { describeError } from '../common/errors/safe-error.js';

/**
 * The `media` queue's worker-side body: decode, re-encode, publish, tidy up.
 *
 * ## Why the failure path is longer than the success path
 *
 * A `property_images` row is not free-standing — the gallery it belongs to has invariants the rest
 * of the codebase relies on. **A property with images has exactly one cover**, and the first upload
 * becomes it. So an image that fails to render is not simply a row to mark `failed`: if it was the
 * cover, the property now has no cover, and every card falls back to «لا صورة بعد» while the
 * listing still has photographs. That was a real bug once already, fixed in
 * `PropertyImageService.archive`, and moving encoding to a worker re-opened the same hole from a
 * new direction.
 *
 * So `fail()` marks the row AND promotes the next image by sort order, in one transaction, exactly
 * as archiving does.
 *
 * ## The original is deleted last, and only on success
 *
 * It is the only copy. Deleting it before the variants are written would make a retry impossible —
 * the job would come back to an empty key and fail forever — and deleting it on terminal failure
 * would destroy the evidence of what was actually uploaded. It is left in place for the `failed`
 * case on purpose; `original_key` stays set, which is how an operator finds it.
 */
@Injectable()
export class MediaProcessor {
  private readonly logger = new Logger(MediaProcessor.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly images: ImageService,
    private readonly storage: StorageService,
    private readonly deadLetters: DeadLetterService,
  ) {}

  /** Runs one job. Throws to request a retry. */
  async process(job: Job<MediaJobData>): Promise<void> {
    if (job.name !== MEDIA_JOB) {
      /* Deploy skew — an older worker meeting a job a newer API enqueued. Retrying cannot help. */
      throw new Error(`Unknown job name on the ${QUEUE.media} queue: ${job.name}`);
    }

    const { imageId, originalKey, fileKey } = job.data;
    /* Absent means `property_images` — see `MediaSubject`. */
    const subject = job.data.subject ?? 'property_image';

    /*
      Claimed, not just read.

      `UPDATE … WHERE status = 'processing' RETURNING` is what makes a duplicate run harmless: a job
      that arrives after the row already reached `ready` — a stall reclaim, a manual retry, a second
      worker — matches nothing and returns here. Reading the row and then deciding would leave the
      window between the two open, which at concurrency 4 is not theoretical.

      The `updated_at` touch is the claim itself; the trigger on this table would do it anyway.
    */
    const claimed =
      subject === 'ad_campaign'
        ? await this.db.execute<{ id: string }>(sql`
            UPDATE ad_campaigns SET updated_at = now()
            WHERE id = ${imageId}::uuid AND image_status = 'processing'
            RETURNING id
          `)
        : subject === 'dispute_evidence'
          ? /*
              Evidence has no status to claim, because the table is APPEND-ONLY: a row exists the
              moment the bytes are stored and never changes state. `variant_widths IS NULL` is the
              equivalent question — «has anything rendered this yet» — and it makes a re-drive of a
              file already rendered a no-op, exactly as the status claims do elsewhere.
            */
            await this.db.execute<{ id: string }>(sql`
              SELECT id FROM dispute_evidence
              WHERE id = ${imageId}::uuid AND variant_widths IS NULL
            `)
          : await this.db.execute<{ id: string }>(sql`
              UPDATE property_images SET updated_at = now()
              WHERE id = ${imageId}::uuid AND status = 'processing'
              RETURNING id
            `);

    if (!claimed.rows[0]) {
      this.logger.log(`Image ${imageId} is no longer processing; nothing to do.`);

      return;
    }

    const original = await this.storage.get(originalKey);

    if (!original) {
      /*
        Terminal, and deliberately not a retry: the bytes are gone, and no number of attempts
        brings them back. Throwing would burn three attempts to reach the same place slower.
      */
      await this.fail(imageId, ERROR.UPLOAD_FILE_MISSING, subject);
      this.logger.error(`Image ${imageId}: the uploaded object ${originalKey} is gone.`);

      return;
    }

    const processed = await this.images.render(original, fileKey);

    /*
      The typed builder rather than a `sql` template, for `variant_widths` alone.

      A JS array interpolated into a `sql` template expands to a TUPLE — `(400, 800)` — which is a
      row constructor, not an `integer[]`, and Postgres rejects the assignment. Drizzle's `.set()`
      knows the column is an array and encodes it correctly, so the type declaration does the work
      instead of a hand-written `ARRAY[…]::integer[]` that has to be got right by eye.
    */
    // Distinct widths only — each appears twice, once per format.
    const widths = [...new Set(processed.variants.map((variant) => variant.width))];

    if (subject === 'dispute_evidence') {
      /*
        Only the widths. There is no `ready` to set and no cover to promote — the row has been
        readable since it was written, and this is what lets a URL ask for a size that exists.
      */
      await this.db
        .update(schema.disputeEvidence)
        .set({ variantWidths: widths })
        .where(eq(schema.disputeEvidence.id, imageId));
    } else if (subject === 'ad_campaign') {
      await this.db
        .update(schema.adCampaigns)
        .set({
          imageStatus: 'ready',
          imageWidth: processed.width,
          imageHeight: processed.height,
          imageVariantWidths: widths,
          imageOriginalKey: null,
          imageFailureCode: null,
        })
        .where(eq(schema.adCampaigns.id, imageId));
    } else {
      await this.db
        .update(schema.propertyImages)
        .set({
          status: 'ready',
          width: processed.width,
          height: processed.height,
          variantWidths: widths,
          /* Cleared with the object below, so a set column always means a file still exists. */
          originalKey: null,
          failureCode: null,
        })
        .where(eq(schema.propertyImages.id, imageId));
    }

    /*
      Last. A failure here leaves an orphan under `incoming/` and a perfectly good published image,
      which is the right way round — the reverse would be a gallery entry with no bytes behind it.
      `original_key` is already NULL, so the orphan is found by listing the prefix rather than by
      querying, and it is not reachable by anybody: the prefix is not in the public read policy.
    */
    await this.storage.remove(originalKey).catch((error: unknown) => {
      this.logger.warn(
        `Image ${imageId} published, but ${originalKey} could not be removed: ` +
          `${describeError(error)}`,
      );
    });

    this.logger.log(`Image ${imageId} ready: ${processed.variants.length} variants.`);
  }

  /**
   * Called on every failed attempt; acts only on the last one.
   *
   * `attemptsMade < attempts` means BullMQ will try again, and marking the row `failed` on the
   * first attempt would show the partner a dead photograph that was about to come back to life.
   */
  async onFailed(job: Job<MediaJobData> | undefined, error: Error): Promise<void> {
    if (!job) {
      this.logger.error(
        `A ${QUEUE.media} job failed before it could be read: ${describeError(error)}`,
      );

      return;
    }

    const attempts = job.opts.attempts ?? 1;

    if (job.attemptsMade < attempts) return;

    await this.fail(job.data.imageId, ERROR.UPLOAD_IMAGE_PROCESSING_FAILED);

    await this.deadLetters.record({
      queue: QUEUE.media,
      name: job.name,
      /*
        The payload is three server-generated keys and a row id — no bytes, no filename, nothing a
        person typed. `DeadLetterService` redacts anyway; there is simply nothing here to find.
      */
      jobId: String(job.id ?? ''),
      payload: job.data,
      error,
      attempts: job.attemptsMade,
    });
  }

  /**
   * Marks one image dead and repairs the gallery around it.
   *
   * The cover promotion is the reason this is a transaction and not an `UPDATE`. It is the same
   * statement `PropertyImageService.archive` uses, for the same reason: `UPDATE … WHERE id = (SELECT
   * … LIMIT 1)` rather than a read then a write, so two images failing at once cannot both promote
   * and leave two covers — the partial unique index would reject the second, which is the guarantee
   * doing its job rather than a crash to explain.
   */
  private async fail(
    imageId: string,
    code: string,
    subject: MediaSubject = 'property_image',
  ): Promise<void> {
    /*
      A campaign's creative fails on its own, with none of the gallery's consequences.

      `property_images` has to promote the next photograph when a COVER fails, because a published
      listing with no cover renders «لا صورة بعد» to customers. A campaign has one image and no
      cover to lose: the ad falls back to text, which is a complete ad, so the whole CTE below is
      not merely unnecessary here — it names columns this table does not have.
    */
    if (subject === 'dispute_evidence') {
      /*
        Nothing to record. The table is append-only and has no failure column, so an unrendered
        piece of evidence stays exactly what it is — a row with no variants, which is what the
        reader is shown as «still processing». The log line below is the record.
      */
      return;
    }

    if (subject === 'ad_campaign') {
      await this.db
        .update(schema.adCampaigns)
        .set({ imageStatus: 'failed', imageFailureCode: code })
        .where(eq(schema.adCampaigns.id, imageId));

      this.logger.warn(`Campaign creative ${imageId} failed: ${code}.`);

      return;
    }

    try {
      await this.db.transaction(async (tx) => {
        /*
          The CTE is not decoration: `RETURNING` yields the row AFTER the update.

          The obvious version — `UPDATE … SET is_cover = false … RETURNING is_cover` — returns
          false every time, because that is what it was just set to. So the promotion below never
          ran, and a failed cover left the property with none: the exact bug this method exists to
          prevent, written into the method preventing it. `previous` reads the row and locks it
          before the write, so `is_cover` here is what it was when the job failed.
        */
        const marked = await tx.execute<{ property_id: string; is_cover: boolean }>(sql`
          WITH previous AS (
            SELECT id, property_id, is_cover FROM property_images
            WHERE id = ${imageId}::uuid AND status <> 'failed'
            FOR UPDATE
          ), marked AS (
            UPDATE property_images
            SET status = 'failed', failure_code = ${code}, is_cover = false
            WHERE id = (SELECT id FROM previous)
            RETURNING id
          )
          SELECT previous.property_id, previous.is_cover
          FROM previous, marked
        `);

        const row = marked.rows[0];

        if (!row?.is_cover) return;

        await tx.execute(sql`
          UPDATE property_images
          SET is_cover = true
          WHERE id = (
            SELECT id FROM property_images
            WHERE property_id = ${row.property_id}::uuid
              AND deleted_at IS NULL AND status <> 'failed'
            ORDER BY sort_order, created_at
            LIMIT 1
          )
        `);
      });
    } catch (error) {
      /*
        Swallowed on purpose. This runs inside BullMQ's `failed` event, where an unhandled rejection
        takes the worker process down — one unwritable row would stop every queue on the host. The
        dead letter is recorded separately and is the durable record.
      */
      this.logger.error(
        `Could not mark image ${imageId} failed: ` + `${describeError(error)}`,
      );
    }
  }
}
