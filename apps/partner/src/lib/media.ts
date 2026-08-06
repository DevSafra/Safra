/**
 * The URL of a listing photo.
 *
 * ## Why not an authenticated proxy
 *
 * The first version of this app streamed photos through a route handler with the partner's token
 * attached, on the reasoning that everything else here is authenticated. That was wrong twice: the
 * API has no endpoint to serve one — the proxy pointed at a route that does not exist and would
 * have 404'd the moment a listing had a photo — and a listing photo is PUBLIC content that already
 * appears on safra.com. `StorageService` draws exactly that line: `publicUrl` for public objects,
 * an authenticated read for private ones like identity documents.
 *
 * ## Why the width comes from `variantWidths`
 *
 * The pipeline never upscales, so a 1200px source has no 1600px variant and asking for one is a
 * 404 and a broken card. The same rule the customer site's `imageUrl()` follows — picking from
 * what was actually rendered.
 */
const MEDIA_BASE =
  process.env['NEXT_PUBLIC_MEDIA_URL'] ??
  `${process.env['API_URL'] ?? 'http://localhost:4000'}/api/v1/media`;

export function coverUrl(
  key: string,
  variantWidths: readonly number[],
  desiredWidth = 800,
  format: 'avif' | 'webp' = 'avif',
): string {
  const available = [...variantWidths].sort((a, b) => a - b);
  const chosen =
    available.filter((width) => width <= desiredWidth).pop() ??
    available[0] ??
    desiredWidth;

  return `${MEDIA_BASE}/${key}-${chosen}.${format}`;
}
