import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { sql } from 'drizzle-orm';

import type { Database } from '@safra/db';

import { DATABASE } from '../database/database.module.js';
import { describeError } from '../common/errors/safe-error.js';
import { JOB_OPTIONS } from './queue.definitions.js';
import { MEDIA_QUEUE } from './queue.tokens.js';
import { MEDIA_JOB, creativeJobId, mediaJobId, type MediaJobData } from './media.job.js';

/**
 * Re-driving image renders whose jobs were lost — `O-media-2`, and the half media never had.
 *
 * ## The gap
 *
 * `PropertyImageService.upload` and `AdCreativeService.upload` both commit the row at `processing`
 * and THEN enqueue the render, deliberately swallowing an enqueue failure so a successful upload is
 * never undone by a queue that is briefly unavailable. The row is the durable record and carries
 * the original key, which is precisely what a re-drive needs.
 *
 * **Nothing read it.** If the job was lost — the worker down long enough, Redis restarting with
 * `appendonly` off (it is off, and the API warns about exactly this at boot), or the job dropped —
 * the row sat at `processing` **permanently**. The console polls, gives up after forty seconds and
 * says so, and every subsequent upload takes the same path.
 *
 * `notification-redrive` has run every five minutes for this exact failure since 2026-08-13 and
 * calls itself «the recovery half of `O-notify-2`». Media had no equivalent half; the asymmetry was
 * not deliberate, it is that the listing pipeline predates that lesson and advertising inherited
 * its shape.
 *
 * ## Re-driving is safe because the ids are deterministic
 *
 * `mediaJobId(id)` for a listing photograph and `creativeJobId(fileKey)` for a creative are stable
 * for the same upload, so BullMQ refuses a second job while the first exists. A row whose job is
 * merely SLOW is therefore a no-op here rather than a duplicate render — which matters, because the
 * worst outcome of a re-drive would be two workers writing the same six objects and racing to
 * update one row.
 *
 * ## Why the threshold is generous
 *
 * A render is seconds of work, but the queue is shared and a deploy restarts the worker. Ten
 * minutes is long enough that a rolling restart is not treated as a loss and short enough that a
 * partner who uploaded before lunch has their photograph by the time they look again. Being wrong
 * in the early direction costs nothing — see the deterministic id — so the number is chosen for
 * honesty about what «lost» means rather than for safety.
 *
 * ## Dispute evidence is NOT here, and that is a decision
 *
 * `dispute_evidence` carries no `status` and no original key: it stores the file and fills
 * `variant_widths` when the render lands, so «stuck» there is `variant_widths IS NULL` — a
 * different predicate over a row that is already readable, since the evidence is served from its
 * `storage_key` whether or not the variants exist. It degrades to a slower image rather than to a
 * spinner that never stops, which is why it is recorded rather than swept in.
 */
/** How long a row must sit at `processing` before its job counts as lost. */
const STALE_AFTER_MINUTES = 10;

/** Bounded per run, so a re-drive after a long outage does not become its own incident. */
const BATCH = 200;

type StuckImage = { id: string; original_key: string; file_key: string };
type StuckCreative = { id: string; original_key: string; file_key: string };

@Injectable()
export class MediaRedriveService {
  private readonly logger = new Logger(MediaRedriveService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(MEDIA_QUEUE) private readonly media: Queue<MediaJobData>,
  ) {}

  /** Re-enqueues every stuck render it can find. Returns what it did, for the job record. */
  async run(): Promise<{ images: number; creatives: number }> {
    const [images, creatives] = await Promise.all([
      this.redriveImages(),
      this.redriveCreatives(),
    ]);

    if (images + creatives > 0) {
      this.logger.warn(
        `Re-drove ${images} listing photograph(s) and ${creatives} advertising creative(s) ` +
          `stuck at processing for more than ${STALE_AFTER_MINUTES} minutes. ` +
          'A render job was lost; the rows carried their original keys, so nothing was.',
      );
    }

    return { images, creatives };
  }

  private async redriveImages(): Promise<number> {
    /*
      `original_key IS NOT NULL` is not belt and braces: it is what makes the row re-drivable. A
      row at `processing` with no original key has lost the BYTES, and re-enqueueing it would make
      a worker fail repeatedly against an object that is not there — a lost render turned into a
      recurring error, which is worse than a stuck row because it looks like a fault in the worker.
    */
    const rows = await this.db.execute<StuckImage>(sql`
      SELECT id::text, original_key, file_key
        FROM property_images
       WHERE status = 'processing'
         AND deleted_at IS NULL
         AND original_key IS NOT NULL
         AND created_at < now() - ${`${STALE_AFTER_MINUTES} minutes`}::interval
       ORDER BY created_at
       LIMIT ${BATCH}
    `);

    let sent = 0;

    for (const row of rows.rows) {
      if (
        await this.enqueue(
          { imageId: row.id, originalKey: row.original_key, fileKey: row.file_key },
          mediaJobId(row.id),
        )
      ) {
        sent += 1;
      }
    }

    return sent;
  }

  private async redriveCreatives(): Promise<number> {
    /*
      `updated_at`, not `created_at`. A campaign row is created when the campaign is, and its
      creative may be uploaded days later — dating the staleness from creation would re-drive every
      campaign that ever had an upload, immediately and for ever.
    */
    const rows = await this.db.execute<StuckCreative>(sql`
      SELECT id::text, image_original_key AS original_key, image_file_key AS file_key
        FROM ad_campaigns
       WHERE image_status = 'processing'
         AND deleted_at IS NULL
         AND image_original_key IS NOT NULL
         AND image_file_key IS NOT NULL
         AND updated_at < now() - ${`${STALE_AFTER_MINUTES} minutes`}::interval
       ORDER BY updated_at
       LIMIT ${BATCH}
    `);

    let sent = 0;

    for (const row of rows.rows) {
      if (
        await this.enqueue(
          {
            imageId: row.id,
            subject: 'ad_campaign',
            originalKey: row.original_key,
            fileKey: row.file_key,
          },
          /* Keyed on the FILE, like the upload — see `creativeJobId`. */
          creativeJobId(row.file_key),
        )
      ) {
        sent += 1;
      }
    }

    return sent;
  }

  /**
   * One `add`, and a failure that does not stop the sweep.
   *
   * A queue that refuses one job must not cost the other 199 their re-drive, and the next run is
   * five minutes away — so this logs and carries on rather than throwing. The same reasoning the
   * upload paths give for swallowing their own enqueue failure, on the other side of it.
   */
  private async enqueue(data: MediaJobData, jobId: string): Promise<boolean> {
    try {
      await this.media.add(MEDIA_JOB, data, { ...JOB_OPTIONS.media, jobId });

      return true;
    } catch (error) {
      this.logger.error(
        `Could not re-drive render ${jobId}: ${describeError(error)}. ` +
          'The row stays processing and the next run will try again.',
      );

      return false;
    }
  }
}
