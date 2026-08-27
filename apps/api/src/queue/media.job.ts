/** The one job the `media` queue carries, so far. */
export const MEDIA_JOB = 'image.render' as const;

/**
 * What a worker needs to turn one uploaded file into the six variants that get served.
 *
 * ## Keys, not bytes
 *
 * The opposite choice from `MailJobData`, and for the opposite reason. A rendered email travels
 * inside its job because re-rendering later could silently change a message somebody was told was
 * sent. A photograph must NOT travel inside its job: it is up to 10 MB, Redis is the queue's
 * durable store, and a hundred phone uploads would put a gigabyte of image data into the one
 * component whose eviction policy this system depends on being `noeviction`.
 *
 * So the bytes go to object storage under `originalKey` and the job carries the address. The cost
 * is that the worker does an extra read; the alternative is an outage under a busy afternoon.
 *
 * ## Nothing here is supplied by the client
 *
 * Both keys are generated server-side (`ImageService.keyFor`), and `imageId` is the row the
 * request already wrote. A job whose payload came from an upload form would be a way to make a
 * worker read and re-encode an arbitrary object in the bucket.
 */
/**
 * Which table the row lives in.
 *
 * The pipeline is ONE pipeline — one `ImageService`, one queue, one worker, one re-drive story —
 * and the only thing that differs between a listing photograph and an advertising creative is where
 * the finished widths are written. A second processor would be a second place for the magic-byte
 * check, the EXIF-stripping re-encode or the claim-before-render to be forgotten, and the one that
 * was forgotten would be the interesting one.
 *
 * Absent means `property_images`, so every job enqueued before advertising creatives existed still
 * means what it meant.
 */
export type MediaSubject = 'property_image' | 'ad_campaign';

export interface MediaJobData {
  /** The row this job completes — in `property_images`, or `ad_campaigns` for a creative. */
  readonly imageId: string;
  readonly subject?: MediaSubject;
  /** Where the uploaded bytes are parked. Private prefix — see `INCOMING_PREFIX`. */
  readonly originalKey: string;
  /** The prefix the variants hang off, already stored on the row. */
  readonly fileKey: string;
}

/**
 * A deterministic job id, so one upload cannot be rendered twice.
 *
 * Keyed on the image row rather than on the file, because the row is what the job completes: a
 * retried request that re-enqueues the same row is a no-op, where a second `add` with a fresh id
 * would mean two workers writing the same six objects and racing to update one row.
 *
 * A dash, never a colon — BullMQ rejects `:` outright, since it is its own key separator. See
 * `mailJobId`, where that cost ten minutes and 34 unsent notifications.
 */
export function mediaJobId(imageId: string): string {
  return `image-${imageId}`;
}

/**
 * The job id for a CAMPAIGN creative, keyed on the file rather than on the row.
 *
 * ## The bug this exists for (Bashar, 2026-08-27: «it keeps loading and nothing happens»)
 *
 * `mediaJobId` keys on the row, and its docblock explains why that is right: «a retried request
 * that re-enqueues the same row is a no-op». For `property_images` every upload INSERTS a row, so
 * the id is fresh each time and the property holds.
 *
 * A campaign's creative lives on the campaign. The row id is the same for every upload against it,
 * so the second one produced the same job id as the first — and completed jobs are retained for a
 * DAY (`RETENTION.removeOnComplete.age`), so BullMQ still knew that id and ignored the `add`
 * entirely. Silently: `add` resolves with the existing job, the API answers 201, the row sits at
 * `processing`, and the dialog spins for ever. Measured on `ADS-000721` — three uploads in the API
 * log, one render in the worker log, and the row pointing at a key nothing ever rendered.
 *
 * The FILE KEY carries a fresh uuid per upload (`ImageService.keyFor`), so this is unique per
 * upload and still deterministic for a retry of the SAME upload — which is the property the row key
 * was chosen for in the first place.
 */
export function creativeJobId(fileKey: string): string {
  return `creative-${fileKey.replaceAll('/', '_')}`;
}
