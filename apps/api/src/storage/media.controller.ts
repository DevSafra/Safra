import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { normalize, resolve, sep } from 'node:path';

import { Controller, Get, Header, NotFoundException, Param, Res } from '@nestjs/common';
import type { Response } from 'express';

import { Public } from '../rbac/decorators.js';

/**
 * Serves images from local disk in development.
 *
 * In deployed environments images are served by the object store or a CDN and this
 * route is never hit. It exists so a fresh checkout can display uploaded photos
 * without cloud credentials.
 *
 * Two things make it safe to serve user-supplied content from our own origin:
 *
 *  1. Every stored byte was re-encoded by sharp, so the file genuinely is an AVIF
 *     or WebP image — there is no attacker-controlled content to execute.
 *  2. The extension determines the Content-Type from a fixed map, `nosniff` is set,
 *     and anything not matching the expected key shape is rejected outright.
 */
@Controller('media')
export class MediaController {
  private readonly root = resolve(process.cwd(), '.storage');

  /**
   * Only the exact key shapes this system generates:
   * `properties/<REFERENCE>/<uuid>-<width>.<avif|webp>` and
   * `cities/<slug>/<uuid>-<width>.<avif|webp>`
   *
   * An allow-list pattern rather than a traversal blocklist — there is no `..` to
   * filter because nothing outside this shape is accepted in the first place.
   */
  private static readonly KEY_PATTERN =
    /^(properties|cities)\/[A-Za-z0-9-]{1,60}\/[0-9a-f-]{36}-\d{2,5}\.(avif|webp)$/;

  @Public()
  @Get(':kind/:owner/:filename')
  @Header('Cache-Control', 'public, max-age=31536000, immutable')
  @Header('X-Content-Type-Options', 'nosniff')
  async serve(
    @Param('kind') kind: string,
    @Param('owner') owner: string,
    @Param('filename') filename: string,
    @Res() response: Response,
  ): Promise<void> {
    const key = `${kind}/${owner}/${filename}`;

    if (!MediaController.KEY_PATTERN.test(key)) {
      throw new NotFoundException();
    }

    const target = resolve(this.root, normalize(key));

    // Belt and braces: the pattern already forbids traversal, but a path that
    // escapes the root must never be readable regardless of how it got here.
    if (target !== this.root && !target.startsWith(this.root + sep)) {
      throw new NotFoundException();
    }

    try {
      const info = await stat(target);
      if (!info.isFile()) throw new NotFoundException();

      response.setHeader(
        'Content-Type',
        filename.endsWith('.avif') ? 'image/avif' : 'image/webp',
      );
      response.setHeader('Content-Length', info.size);
      createReadStream(target).pipe(response);
    } catch {
      throw new NotFoundException();
    }
  }
}
