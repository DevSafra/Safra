import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { basename } from 'node:path';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';

import { loadEnv } from '../config/env.js';

/**
 * Uploads the self-hosted basemap: vector tiles, glyphs and sprites.
 *
 * ## Why we host a basemap at all
 *
 * The property page draws a map, and every hosted alternative was either a licence
 * problem or a recurring bill. OpenStreetMap's own tile servers warn commercial services
 * that «access may be withdrawn at any point» and forbid building tile archives; Stadia's
 * free tier says commercial use is not allowed; MapTiler's static API needs a paid plan.
 * An extract of the Protomaps basemap costs 154 MB of the object storage we already run,
 * and nothing per month.
 *
 * It also settles a privacy question the hosted options could not. Tiles fetched from a
 * third party would tell that third party which neighbourhood each visitor is looking at,
 * and their IP address with it. Served from our own bucket, nobody outside SAFRA learns
 * anything about a visitor at all.
 *
 * ## What an operator does first
 *
 * The tileset is built once with the `pmtiles` CLI (github.com/protomaps/go-pmtiles) and
 * is not produced here, because it is a 170 MB download from a daily planet build and has
 * no business running on a deploy:
 *
 *   pmtiles extract https://build.protomaps.com/<YYYYMMDD>.pmtiles syria.pmtiles \
 *     --bbox=35.5,32.2,42.5,37.4 --maxzoom=14
 *
 * The bbox is Syria. `--maxzoom=14` is the DATA's depth, not the map's: the map opens at
 * `PUBLIC_MAP_ZOOM` (15) and stops at `PUBLIC_MAP_MAX_ZOOM` (16), overzooming these tiles
 * for the last two levels. That costs nothing and keeps the archive a third of the size —
 * measured on the 2026-09-16 planet: 86 MB at z13, 162 MB at z14, 330 MB at z15.
 * Re-run it when the map data should be refreshed — there is no other reason to.
 *
 * ## Licences travelling with these files
 *
 * Tiles are an ODbL Produced Work: «© OpenStreetMap contributors» must stay visible on
 * the map, which `PropertyMap` renders as a permanent attribution control rather than
 * behind a toggle. Glyphs are Noto Sans under the SIL Open Font License. Both are carried
 * in `docs/` rather than only here.
 */

/** The font stacks the Protomaps style asks for, and nothing else. */
const FONT_STACKS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];

/** Glyphs are split into 256-codepoint ranges; a browser fetches only what it draws. */
const GLYPH_RANGES = 256;

const ASSETS = 'https://protomaps.github.io/basemaps-assets';

function client(endpoint: string, region: string, key: string, secret: string) {
  return new S3Client({
    endpoint,
    region,
    credentials: { accessKeyId: key, secretAccessKey: secret },
    forcePathStyle: true,
  });
}

async function putBuffer(
  s3: S3Client,
  bucket: string,
  key: string,
  body: Uint8Array,
  contentType: string,
): Promise<void> {
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      /* A year: these are immutable builds, replaced by uploading a new archive. */
      CacheControl: 'public, max-age=31536000, immutable',
    }),
  );
}

/** Fetches one asset from the Protomaps asset repository, or `null` if it has none. */
async function fetchAsset(path: string): Promise<Uint8Array | null> {
  const response = await fetch(`${ASSETS}/${path}`);
  if (!response.ok) return null;

  return new Uint8Array(await response.arrayBuffer());
}

async function main(): Promise<void> {
  const env = loadEnv();
  const [, , archivePath] = process.argv;

  const endpoint = env.S3_ENDPOINT;
  const bucket = env.S3_BUCKET;
  const region = env.S3_REGION ?? 'us-east-1';
  const accessKey = env.S3_ACCESS_KEY_ID;
  const secretKey = env.S3_SECRET_ACCESS_KEY;

  if (!endpoint || !bucket || !accessKey || !secretKey) {
    throw new Error('S3_ENDPOINT, S3_BUCKET and credentials must be set.');
  }

  if (!archivePath) {
    throw new Error(
      'Usage: pnpm basemap:bootstrap <path to .pmtiles>. See the header for how to build one.',
    );
  }

  const s3 = client(endpoint, region, accessKey, secretKey);

  /*
    The tileset, streamed rather than read into memory: it is 154 MB for Syria and a
    buffer that size is a needless spike in a script somebody may run on a small box.
  */
  const size = (await stat(archivePath)).size;
  console.log(
    `Uploading ${basename(archivePath)} (${Math.round(size / 1024 / 1024)} MB)…`,
  );

  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: 'basemap/tiles.pmtiles',
      Body: createReadStream(archivePath),
      ContentLength: size,
      ContentType: 'application/octet-stream',
      CacheControl: 'public, max-age=86400',
    }),
  );

  /*
    Sprites for the light and dark flavours. Both, because the map follows the reader's
    theme and a sprite fetched at theme-switch time would be a blank icon set until it
    arrived.
  */
  console.log('Uploading sprites…');
  for (const flavour of ['light', 'dark']) {
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) {
      const name = `${flavour}${suffix}`;
      const body = await fetchAsset(`sprites/v4/${name}`);
      if (!body) throw new Error(`Sprite ${name} could not be fetched.`);

      await putBuffer(
        s3,
        bucket,
        `basemap/sprites/${name}`,
        body,
        suffix.endsWith('.png') ? 'image/png' : 'application/json',
      );
    }
  }

  /*
    Every range of every stack the style names. All 256 rather than the handful Arabic and
    Latin need: a missing range is not an error the map reports, it is a word rendered as
    empty boxes, and which ranges a listing's street names reach is not something this
    script can know.
  */
  console.log('Uploading glyphs…');
  let uploaded = 0;
  let missing = 0;

  for (const stack of FONT_STACKS) {
    for (let i = 0; i < GLYPH_RANGES; i += 1) {
      const range = `${i * 256}-${i * 256 + 255}`;
      const body = await fetchAsset(`fonts/${encodeURIComponent(stack)}/${range}.pbf`);

      if (!body) {
        missing += 1;
        continue;
      }

      await putBuffer(
        s3,
        bucket,
        `basemap/fonts/${stack}/${range}.pbf`,
        body,
        'application/x-protobuf',
      );
      uploaded += 1;
    }
    console.log(`  ${stack}: done`);
  }

  console.log(
    `Basemap uploaded: 1 tileset, 8 sprite files, ${uploaded} glyph ranges ` +
      `(${missing} ranges the font does not define).`,
  );
  console.log(
    'Set NEXT_PUBLIC_BASEMAP_URL to the public base of this bucket, ' +
      'e.g. http://localhost:9000/safra-media/basemap',
  );
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
