import { describe, expect, it } from 'vitest';

import { mediaBase, mediaUrl } from './media.js';

/**
 * The two Next apps built these URLs independently, with the same variable and the same rule in
 * two files that nothing kept in step. They agreed by coincidence; a change to either would have
 * left one app rendering images and the other rendering nothing, silently.
 */
describe('mediaBase', () => {
  it('prefers the configured public URL', () => {
    expect(
      mediaBase({
        NEXT_PUBLIC_MEDIA_URL: 'https://media.safra.com',
        API_URL: 'http://api',
      }),
    ).toBe('https://media.safra.com');
  });

  /* A trailing slash produces `//` in every URL, which some CDNs treat as a different key. */
  it('strips a trailing slash so keys never double up', () => {
    expect(mediaBase({ NEXT_PUBLIC_MEDIA_URL: 'https://media.safra.com/' })).toBe(
      'https://media.safra.com',
    );
  });

  it('falls back to the API media route when nothing is configured', () => {
    expect(mediaBase({ API_URL: 'http://localhost:4000' })).toBe(
      'http://localhost:4000/api/v1/media',
    );
  });
});

describe('mediaUrl', () => {
  const image = { fileKey: 'properties/PRO-1/abc', variantWidths: [400, 800, 1600] };

  it('picks the largest rendered width that is not larger than asked for', () => {
    expect(mediaUrl('https://m', image, 1000)).toBe(
      'https://m/properties/PRO-1/abc-800.avif',
    );
  });

  /**
   * The pipeline never upscales, so asking for a width it did not render is a 404 and a broken
   * card. Falling back to the SMALLEST available is a slightly small picture, which is a picture.
   */
  it('falls back to the smallest rendered width rather than to the one requested', () => {
    expect(mediaUrl('https://m', { ...image, variantWidths: [400] }, 1600)).toBe(
      'https://m/properties/PRO-1/abc-400.avif',
    );
  });

  it('honours the requested format', () => {
    expect(mediaUrl('https://m', image, 400, 'webp')).toContain('-400.webp');
  });
});
