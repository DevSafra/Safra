import { Inject, Injectable, Logger } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Redis } from 'ioredis';

import type { Database } from '@safra/db';
import { ERROR } from '@safra/contracts';

import { DATABASE } from '../database/database.module.js';
import { ENV, type Env } from '../config/env.js';
import { REDIS } from '../redis/redis.tokens.js';
import { notFound } from '../common/errors/app-error.js';
import { describeError } from '../common/errors/safe-error.js';
import { areaPolygon, fuzzCoordinate, PUBLIC_MAP_ZOOM } from './public-location.js';

/**
 * The two pictures the property page asks for, and nothing else.
 *
 * A closed set rather than width/height query parameters. Caller-supplied dimensions
 * would make every distinct pair a cache miss and a paid MapTiler request, so a script
 * walking `?w=601`, `?w=602` … turns our own endpoint into a bill. The reader never
 * needed arbitrary sizes; two are what the design draws.
 */
const VARIANTS = {
  card: { width: 800, height: 320 },
  full: { width: 1000, height: 700 },
} as const;

export type MapVariant = keyof typeof VARIANTS;

export function isMapVariant(value: string): value is MapVariant {
  return Object.hasOwn(VARIANTS, value);
}

/**
 * How long a rendered map stays in Redis.
 *
 * A week. The inputs change about never — a listing's coordinates are set once when the
 * partner records the address — and every hit avoids a paid request. The TTL exists so a
 * corrected address reaches the page on its own within a week rather than needing a
 * cache bust, not because the bytes go stale.
 */
const CACHE_TTL_SECONDS = 7 * 24 * 60 * 60;

/**
 * How long we will wait for MapTiler before giving up on a page view.
 *
 * Short on purpose: this runs inside a request. A slow upstream must become a missing
 * picture in three seconds, never a property page that hangs — §3 puts the whole API at
 * p95 < 200 ms and a third party cannot be allowed to spend that budget.
 */
const UPSTREAM_TIMEOUT_MS = 3_000;

/**
 * Renders the location map for a published listing.
 *
 * ## Why this is a proxy rather than a URL in the payload
 *
 * MapTiler bills per request against `MAPTILER_KEY`, so the key is a credential. Putting
 * it in an `<img src>` publishes it to every visitor and to anyone reading the HTML —
 * the bill is then open to the internet. Rendering here keeps it server-side, and has
 * two effects worth having anyway: the customer app's CSP needs no new image origin
 * because the picture comes from our own, and MapTiler never sees a visitor's IP address
 * or which listing they are looking at, which is one fewer processor to account for.
 *
 * ## Why the route takes a SLUG and not a coordinate pair
 *
 * `/map/card.webp?lat=&lon=` would be an open, paid map renderer for the whole planet
 * with our key behind it. Addressing the property instead means the reachable set is
 * exactly the published listings, the coordinates come from our own database, and the
 * cache key space is bounded by inventory rather than by what a caller can type.
 */
@Injectable()
export class PropertyMapService {
  private readonly logger = new Logger(PropertyMapService.name);

  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ENV) private readonly env: Env,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /**
   * The rendered image bytes for one published listing.
   *
   * Throws `notFound` for every reason a map cannot be drawn — no plan configured, no
   * such slug, a slug that exists but is not published, a listing with no coordinates,
   * or an upstream that failed. "Not yours to see" and "not there" answer identically,
   * and an unpublished listing cannot be probed through its map.
   */
  async image(slug: string, variant: MapVariant): Promise<Buffer> {
    const key = this.env.MAPTILER_KEY;
    if (!key) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    /*
      `safra:` for the reason `queue.module.ts` gives about its own prefix: this Redis is
      not guaranteed to be ours alone, and an unnamespaced `map:…` is exactly the kind of
      key another service would also think was free.
    */
    const cacheKey = `safra:map:${variant}:${slug}`;

    const cached = await this.readCache(cacheKey);
    if (cached) return cached;

    /*
      The visibility rule is the WHERE clause, not a check afterwards. An unpublished or
      deleted listing produces no row and answers 404 — the same answer a slug nobody
      ever created gets, so the map cannot be used to confirm that a hidden listing
      exists.
    */
    const result = await this.db.execute<Record<string, unknown>>(sql`
      SELECT p.latitude, p.longitude
        FROM properties p
       WHERE p.slug = ${slug}
         AND p.status = 'published'
         AND p.deleted_at IS NULL
       LIMIT 1
    `);

    const row = result.rows[0];
    if (!row) throw notFound(ERROR.PROPERTY_NOT_FOUND);

    const latitude = fuzzCoordinate(row['latitude']);
    const longitude = fuzzCoordinate(row['longitude']);
    if (latitude === null || longitude === null) {
      throw notFound(ERROR.PROPERTY_NOT_FOUND);
    }

    const bytes = await this.render(latitude, longitude, variant, key);

    await this.writeCache(cacheKey, bytes);

    return bytes;
  }

  /**
   * Asks MapTiler for the picture.
   *
   * The key travels as a query parameter because that is the only way MapTiler accepts
   * it. It is interpolated into a URL built here from values that are ours — a rounded
   * number from our database and a member of `VARIANTS` — so nothing a caller typed
   * reaches the request.
   */
  private async render(
    latitude: string,
    longitude: string,
    variant: MapVariant,
    key: string,
  ): Promise<Buffer> {
    const { width, height } = VARIANTS[variant];

    /*
      MapTiler orders the centre as lon,lat. Getting it backwards puts a Damascus listing
      in the Indian Ocean, which is why both are formatted from the same helper and the
      order is stated here rather than remembered.
    */
    /*
      The area disc travels WITH the picture, so the card and the enlarged view cannot
      disagree about where the listing is. `path` takes the polygon from `areaPolygon`;
      the gold is the brand's `--color-gold`, at a third opacity for the fill so the
      streets underneath stay readable.
    */
    const path = [
      'fill:%23a87a1f55',
      'stroke:%23a87a1f',
      'width:2',
      areaPolygon(Number(latitude), Number(longitude)),
    ].join('|');

    const url =
      `https://api.maptiler.com/maps/streets-v2/static/` +
      `${longitude},${latitude},${PUBLIC_MAP_ZOOM}/${width}x${height}@2x.webp` +
      `?key=${encodeURIComponent(key)}&attribution=bottomleft&path=${path}`;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        /*
          The STATUS only. A MapTiler error body can quote the request URL back, and that
          URL carries the key — logging it would write the credential into our own logs,
          which is the leak this service exists to prevent, arriving by the back door.
        */
        this.logger.warn(`MapTiler answered ${response.status} for a ${variant} map.`);
        throw notFound(ERROR.PROPERTY_NOT_FOUND);
      }

      return Buffer.from(await response.arrayBuffer());
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        this.logger.warn(`MapTiler timed out after ${UPSTREAM_TIMEOUT_MS}ms.`);
      }
      throw notFound(ERROR.PROPERTY_NOT_FOUND);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Cache reads and writes never fail a page.
   *
   * A Redis blip must cost a paid request, not a missing map: the picture is still
   * renderable without the cache, so an error here is downgraded to a miss.
   */
  private async readCache(key: string): Promise<Buffer | null> {
    try {
      return await this.redis.getBuffer(key);
    } catch (error) {
      this.logger.warn(`Map cache read failed: ${describeError(error)}`);
      return null;
    }
  }

  private async writeCache(key: string, bytes: Buffer): Promise<void> {
    try {
      await this.redis.set(key, bytes, 'EX', CACHE_TTL_SECONDS);
    } catch (error) {
      this.logger.warn(`Map cache write failed: ${describeError(error)}`);
    }
  }
}
