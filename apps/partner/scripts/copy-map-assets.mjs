/**
 * Copies MapLibre's RTL text plugin into `public/` so we serve it ourselves.
 *
 * The plugin is what joins Arabic letters and lays them right to left; without it the
 * map's own labels render as disconnected glyphs in the wrong order, which on an
 * Arabic-first product is the first thing anybody would notice.
 *
 * MapLibre loads it from a URL at run time rather than from the bundle, so it has to be
 * reachable over HTTP. The default in every example is unpkg — a third-party request on
 * behalf of a visitor, which is precisely what self-hosting the basemap was meant to
 * avoid. Copying it into `public/` keeps every byte of the map on our own origin, and
 * keeps the CSP's `script-src` at `'self'`.
 *
 * The partner portal needs it for the same reason the customer site does: its location
 * picker is a MapLibre map with Arabic labels. Each app builds independently, so each
 * provisions its own copy rather than reaching into a sibling's `public/`.
 *
 * Copied at build time rather than committed: it is 130 KB of somebody else's compiled
 * output, and a vendored copy is a dependency that no longer updates and that nobody
 * remembers to audit. `public/map/` is git-ignored.
 *
 * @mapbox/mapbox-gl-rtl-text is BSD-2-Clause; its LICENSE.md travels beside the copy.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const destination = join(here, '..', 'public', 'map');

/*
  Resolved through the package's own export rather than its `package.json`, which the
  package does not expose in `exports` — asking for it throws ERR_PACKAGE_PATH_NOT_EXPORTED.
  `src/index.js` is one directory below the root, so the root is two up.
*/
const entry = require.resolve('@mapbox/mapbox-gl-rtl-text');
const packageRoot = dirname(dirname(entry));

await mkdir(destination, { recursive: true });

await copyFile(
  join(packageRoot, 'dist', 'mapbox-gl-rtl-text.js'),
  join(destination, 'mapbox-gl-rtl-text.js'),
);

await copyFile(join(packageRoot, 'LICENSE.md'), join(destination, 'LICENSE.md'));

console.log('Copied the RTL text plugin into public/map/.');
