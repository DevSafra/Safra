/**
 * Where a browser fetches listing photography, and which variant it asks for.
 *
 * ## Why this is shared rather than written twice
 *
 * The customer app and the partner portal each had their own copy: the same environment variable,
 * the same fallback, the same width-selection rule, in two files that nothing kept in step. They
 * agreed by coincidence. A change to either — a new format, a different fallback, a trailing slash
 * — would have made one app render images and the other render nothing, and the failure appears in
 * no server log because a 404 for an image happens in somebody else's browser.
 *
 * There are three places a media URL can be composed on this platform, and reducing that to two is
 * what this file does. The third is the API's own `urls` field, which is composed from `S3_PUBLIC_URL`
 * rather than from `NEXT_PUBLIC_MEDIA_URL`. **Those two must name the same origin**, and nothing in
 * the code can enforce it because they live in different processes with different environments —
 * see `docs/media-integrity.md` for the control that covers it.
 *
 * ## Why the width comes from `variantWidths`
 *
 * The pipeline never upscales, so a 1200px source has no 1600px variant and asking for one is a
 * 404 and a broken card. The stored list is the only truthful account of what exists.
 */

/** The base a browser should fetch media from, with any trailing slash removed. */
export function mediaBase(env: {
  NEXT_PUBLIC_MEDIA_URL?: string | undefined;
  API_URL?: string | undefined;
}): string {
  const explicit = env.NEXT_PUBLIC_MEDIA_URL;

  if (explicit) return explicit.replace(/\/+$/, '');

  /*
    The API's development media route, which serves from local disk. Correct ONLY when the API is
    also storing to local disk: with `S3_*` configured the API writes to the object store and this
    route 404s for every image. That mismatch was live here for weeks — see `docs/media-integrity.md`.
  */
  return `${(env.API_URL ?? 'http://localhost:4000').replace(/\/+$/, '')}/api/v1/media`;
}

/**
 * The URL of one variant, choosing the largest rendered width that is not larger than asked for.
 *
 * Falls back to the SMALLEST available rather than to the requested width: asking for a variant
 * that was never rendered is a guaranteed 404, and a slightly small image is a picture.
 */
export function mediaUrl(
  base: string,
  image: { fileKey: string; variantWidths: readonly number[] },
  desiredWidth: number,
  format: 'avif' | 'webp' = 'avif',
): string {
  const available = [...image.variantWidths].sort((a, b) => a - b);
  const chosen =
    available.filter((width) => width <= desiredWidth).pop() ??
    available[0] ??
    desiredWidth;

  return `${base}/${image.fileKey}-${chosen}.${format}`;
}
