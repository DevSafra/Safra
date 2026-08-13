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
export interface MediaJobData {
  /** The `property_images` row this job completes. */
  readonly imageId: string;
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
