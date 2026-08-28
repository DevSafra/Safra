import { randomUUID } from 'node:crypto';

import { Injectable, Logger, PayloadTooLargeException } from '@nestjs/common';
import sharp from 'sharp';
import type { Metadata } from 'sharp';

import { StorageService } from './storage.service.js';
import { ERROR } from '@safra/contracts';
import { badRequest } from '../common/errors/app-error.js';
import { errorMessage } from '@safra/i18n';

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

/** What the header says, once sharp has decoded it — everything `render` needs to be told. */
export interface ImageInspection {
  width: number;
  height: number;
  format: string;
}

/**
 * Where an upload waits between arriving and being re-encoded.
 *
 * `incoming/`, deliberately NOT under `properties/` — `bootstrap-media.ts` grants anonymous read on
 * `properties/*` and nothing else, so a file that is still exactly as a stranger sent it is not
 * reachable by anybody who guesses the key. This is the only moment such a file exists at all, and
 * it is the whole reason the prefix is separate rather than tidy.
 */
export const INCOMING_PREFIX = 'incoming';

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

  /**
   * Everything cheap enough to answer inside the request, and nothing else.
   *
   * ## Why this is separate from `render`
   *
   * Encoding moved to a worker (BullMQ phase 3), and the temptation was to move ALL of it — accept
   * the bytes, answer 202, decide later. That would be wrong: a file that is not an image, or is a
   * decompression bomb, or is 30 px wide, is refused by the rules below in single-digit
   * milliseconds, and refusing it in the REQUEST is the only way the person who chose the file
   * finds out. Deferred, the same upload becomes a job that fails, a dead letter, and a partner
   * staring at a gallery wondering what happened.
   *
   * So the boundary is: **validation is a request concern, encoding is a worker concern.** What
   * moves is the six `sharp` encodes and the six uploads — which is the second and a half this
   * endpoint was spending, and the reason it is throttled to 20/min.
   *
   * Reading the header still decodes enough to be worth bounding, which `limitInputPixels` does.
   */
  async inspect(buffer: Buffer): Promise<ImageInspection> {
    if (buffer.byteLength === 0) {
      throw badRequest(ERROR.UPLOAD_FILE_EMPTY);
    }

    if (buffer.byteLength > MAX_BYTES) {
      throw new PayloadTooLargeException({
        statusCode: 413,
        code: ERROR.UPLOAD_FILE_TOO_LARGE,
        message: errorMessage(ERROR.UPLOAD_FILE_TOO_LARGE, 'en', {
          maxMb: Math.floor(MAX_BYTES / 1024 / 1024),
        }),
      });
    }

    let metadata: Metadata;
    try {
      metadata = await sharp(buffer, {
        failOn: 'error',
        limitInputPixels: MAX_PIXELS,
      }).metadata();
    } catch {
      // Deliberately generic: echoing a decoder error tells an attacker which
      // parser they reached.
      throw badRequest(ERROR.UPLOAD_NOT_AN_IMAGE);
    }

    const format = metadata.format;
    const width = metadata.width ?? 0;
    const height = metadata.height ?? 0;

    // An allow-list of raster formats. SVG is excluded on purpose: it is a
    // document format that can carry script, and it is not what a property photo
    // needs.
    if (!format || !['jpeg', 'png', 'webp', 'avif', 'heif', 'tiff'].includes(format)) {
      throw badRequest(ERROR.UPLOAD_IMAGE_TYPE_UNSUPPORTED);
    }

    if (width < MIN_DIMENSION || height < MIN_DIMENSION) {
      throw badRequest(ERROR.UPLOAD_IMAGE_TOO_SMALL, { min: MIN_DIMENSION });
    }

    if (width * height > MAX_PIXELS) {
      throw badRequest(ERROR.UPLOAD_IMAGE_TOO_LARGE);
    }

    return { width, height, format };
  }

  /**
   * The key an image's variants will hang off, generated before any of them exist.
   *
   * Generated in the REQUEST rather than by the worker, so the database row is complete the moment
   * it is written: `file_key` is `NOT NULL`, and a row that had to wait for a worker to learn its
   * own key could not be inserted at all. It contains nothing from the client — a caller-influenced
   * key is a path-traversal write, and a caller-influenced filename is a stored-XSS vector when it
   * is later rendered.
   */
  keyFor(context: {
    kind: 'properties' | 'cities' | 'ads' | 'disputes';
    owner: string;
  }): string {
    return `${context.kind}/${context.owner}/${randomUUID()}`;
  }

  /** Where an upload waits for its worker. Private prefix — see `INCOMING_PREFIX`. */
  incomingKeyFor(fileKey: string): string {
    return `${INCOMING_PREFIX}/${fileKey.replaceAll('/', '_')}`;
  }

  /**
   * Decodes, resizes and re-encodes — the expensive half.
   *
   * The central security property lives HERE and is unchanged by the move to a worker: **nothing
   * the client uploaded is ever served.** Every byte a browser receives has been decoded by sharp
   * and re-encoded by us, which destroys polyglot files, strips EXIF including the GPS coordinates
   * of somebody's home, and guarantees the stored bytes match the content type we advertise.
   *
   * `inspect` must have accepted the same buffer first. It is called again here rather than trusted
   * from the caller, because the worker reads the bytes back from storage and "the object under
   * this key is the object we validated" is an assumption, not a fact — one an operator with bucket
   * write access could break, and the cost of re-checking is a header read.
   */
  async render(buffer: Buffer, fileKey: string): Promise<ProcessedImage> {
    const { width, height, format } = await this.inspect(buffer);

    const image = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PIXELS });
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

      const avifKey = `${fileKey}-${renderWidth}.avif`;
      const webpKey = `${fileKey}-${renderWidth}.webp`;

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
      `Rendered ${fileKey}: ${width}×${height} ${format} → ${variants.length} variants`,
    );

    return { fileKey, width, height, variants };
  }

  /**
   * Validate and render in one call, inside the request.
   *
   * Still used by the ADMIN city-image upload, which is a handful of images a year by a staff
   * member watching the response — a queue there would add a processing state to a screen nobody
   * would ever catch in it. Partner property uploads go through `inspect` + `render` across the
   * `media` queue, because those arrive thirty at a time from a phone.
   */
  async process(
    buffer: Buffer,
    /**
     * `kind` and `owner` build the storage prefix, e.g. `properties/PRO-000101` or
     * `cities/damascus`. Kept generic so a city image is not filed under
     * `properties/` — storage layout should describe what it holds.
     */
    context: { kind: 'properties' | 'cities'; owner: string },
  ): Promise<ProcessedImage> {
    await this.inspect(buffer);

    return this.render(buffer, this.keyFor(context));
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
