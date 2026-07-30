import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  Injectable,
  Logger,
  PayloadTooLargeException,
} from '@nestjs/common';
import sharp from 'sharp';
import type { Metadata } from 'sharp';

import { StorageService } from './storage.service.js';

/** 10 MB. Generous for a phone photo, bounded enough to survive abuse. */
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Rejects decompression bombs: a tiny file can declare enormous dimensions and
 * exhaust memory the moment it is decoded. Checked from the header BEFORE any
 * pixels are processed.
 */
const MAX_PIXELS = 50_000_000; // ~50 MP
const MIN_DIMENSION = 400; // below this it is unusable on a property page

/** Rendered widths. Covers a card thumbnail through a full-bleed gallery image. */
const WIDTHS = [400, 800, 1600] as const;

export interface ProcessedImage {
  fileKey: string;
  width: number;
  height: number;
  variants: { width: number; key: string; format: 'avif' | 'webp' }[];
}

/**
 * Validates, re-encodes and stores an uploaded image.
 *
 * The central security property is that **nothing the client uploaded is ever
 * stored**. Every byte served has been decoded by sharp and re-encoded by us, which:
 *
 *   - destroys polyglot files (a valid JPEG that is also a valid HTML/PHP payload),
 *   - strips EXIF, including the GPS coordinates of someone's home,
 *   - guarantees the stored bytes actually match the content type we advertise.
 *
 * The declared MIME type and filename from the client are both ignored entirely.
 * `sharp` reads the real format from the file header, which is the only claim worth
 * trusting.
 */
@Injectable()
export class ImageService {
  private readonly logger = new Logger(ImageService.name);

  constructor(private readonly storage: StorageService) {}

  async process(
    buffer: Buffer,
    /**
     * `kind` and `owner` build the storage prefix, e.g. `properties/PRO-000101` or
     * `cities/damascus`. Kept generic so a city image is not filed under
     * `properties/` — storage layout should describe what it holds.
     */
    context: { kind: 'properties' | 'cities'; owner: string },
  ): Promise<ProcessedImage> {
    if (buffer.byteLength === 0) {
      throw new BadRequestException('The uploaded file is empty.');
    }

    if (buffer.byteLength > MAX_BYTES) {
      throw new PayloadTooLargeException(
        `Images must be ${Math.floor(MAX_BYTES / 1024 / 1024)} MB or smaller.`,
      );
    }

    // `failOn: 'error'` makes sharp reject malformed input rather than trying to
    // salvage it — a "recovered" image from a hostile file is not something to serve.
    const image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS });

    let metadata: Metadata;
    try {
      metadata = await image.metadata();
    } catch {
      // Deliberately generic: echoing a decoder error tells an attacker which
      // parser they reached.
      throw new BadRequestException('The file could not be read as an image.');
    }

    const format = metadata.format;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // An allow-list of raster formats. SVG is excluded on purpose: it is a
    // document format that can carry script, and it is not what a property photo
    // needs.
    if (!format || !['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff'].includes(format)) {
      throw new BadRequestException(
        'Only JPEG, PNG, WebP, AVIF, HEIF or TIFF images are accepted.',
      );
    }

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw new BadRequestException(
        `Images must be at least ${MIN_DIMENSION}×${MIN_DIMENSION} pixels.`,
      );
    }

    if (width * height > MAX_PIXELS) {
      throw new BadRequestException('Image dimensions are too large.');
    }

    // The key is generated here and contains nothing from the client. A
    // caller-influenced key is a path-traversal write, and a caller-influenced
    // filename is a stored-XSS vector when it is later rendered.
    const id = randomUUID();
    const prefix = `${context.kind}/${context.owner}/${id}`;

    const variants: ProcessedImage['variants'] = [];

    for (const targetWidth of WIDTHS) {
      // Never upscale: enlarging a small photo wastes bytes and looks worse.
      const renderWidth = Math.min(targetWidth, width);

      const pipeline = image
        .clone()
        .rotate() // Applies EXIF orientation before the metadata is discarded.
        .resize({ width: renderWidth, withoutEnlargement: true });

      // AVIF first — materially smaller, and §14.1 budgets a 2-second page on an
      // image-heavy design. WebP is the fallback for older clients.
      const avif = await pipeline.clone().avif({ quality: 55, effort: 4 }).toBuffer();
      const webp = await pipeline.clone().webp({ quality: 78 }).toBuffer();

      const avifKey = `${prefix}-${renderWidth}.avif`;
      const webpKey = `${prefix}-${renderWidth}.webp`;

      await this.storage.put(avifKey, avif, 'image/avif');
      await this.storage.put(webpKey, webp, 'image/webp');

      variants.push(
        { width: renderWidth, key: avifKey, format: 'avif' },
        { width: renderWidth, key: webpKey, format: 'webp' },
      );

      // Identical widths would be produced for every target once renderWidth is
      // capped by the source, so stop after reaching the source width.
      if (renderWidth === width) break;
    }

    this.logger.log(
      `Processed image for ${context.kind}/${context.owner}: ${width}×${height} ${format} → ${variants.length} variants`,
    );

    return {
      // The canonical key is the prefix; variants are derived from it by width and
      // format, so the database stores one value rather than a matrix.
      fileKey: prefix,
      width,
      height,
      variants,
    };
  }

  async remove(fileKey: string): Promise<void> {
    // Soft-deleted rows keep pointing at their objects (P-003), so this is only
    // called for a genuinely orphaned upload.
    for (const targetWidth of WIDTHS) {
      await this.storage.remove(`${fileKey}-${targetWidth}.avif`);
      await this.storage.remove(`${fileKey}-${targetWidth}.webp`);
    }
  }

  publicUrl(fileKey: string, width: number, format: 'avif' | 'webp' = 'avif'): string {
    return this.storage.publicUrl(`${fileKey}-${width}.${format}`);
  }
}
