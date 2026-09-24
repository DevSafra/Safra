import type * as MapLibre from 'maplibre-gl';
import type * as Basemaps from '@protomaps/basemaps';

import { basemapBase } from '@safra/session';

/**
 * Where the self-hosted basemap lives. Absent means an app draws no map at all.
 *
 * Read through `basemapBase` so this and the CSP in `middleware.ts` derive the SAME origin from
 * the same rule. Next inlines `process.env.NEXT_PUBLIC_*` at build time, so both names have to
 * be written out literally here rather than passed as a variable.
 */
export const BASEMAP = basemapBase({
  NEXT_PUBLIC_BASEMAP_URL: process.env['NEXT_PUBLIC_BASEMAP_URL'],
  NEXT_PUBLIC_MEDIA_URL: process.env['NEXT_PUBLIC_MEDIA_URL'],
});

/**
 * The three dynamic imports and the RTL plugin, in one place.
 *
 * ## Why this is shared rather than repeated
 *
 * The property page's map and the search map both need the same four things right, and three of
 * them are traps that cost a day each when they were first met:
 *
 * - **`maplibre-gl@6` does not work with `pmtiles@4`** and fails silently — the style loads, WebGL
 *   reports itself healthy, and the source never leaves `isSourceLoaded: false`.
 * - **The RTL text plugin loaded LAZILY produces a map with no labels at all**, because the
 *   style's label expressions gate on `is-supported-script`, which answers false for Arabic until
 *   the plugin is in memory.
 * - **Not AWAITING it** lets the first tiles parse without it, and «محطة قطار الحجاز» comes out
 *   backwards letter by letter.
 *
 * A second component re-deriving all that is a second chance to get one of them wrong, and the
 * failure is a blank or reversed map rather than an error anybody would see in a test.
 */
export async function loadMapLibre(): Promise<{
  maplibre: typeof MapLibre;
  basemaps: typeof Basemaps;
}> {
  const [maplibre, pmtiles, basemaps] = await Promise.all([
    import('maplibre-gl'),
    import('pmtiles'),
    import('@protomaps/basemaps'),
  ]);

  if (maplibre.getRTLTextPluginStatus() === 'unavailable') {
    /*
      Eager AND awaited — see the note above. The plugin is WebAssembly, so the CSP needs
      `'wasm-unsafe-eval'`, which is deliberately NOT `'unsafe-eval'`.
    */
    await maplibre.setRTLTextPlugin('/map/mapbox-gl-rtl-text.js', false);
  }

  const protocol = new pmtiles.Protocol();
  maplibre.addProtocol('pmtiles', protocol.tile);

  return { maplibre, basemaps };
}

/**
 * The whole style, assembled from files we host.
 *
 * No key, no vendor call-out, and nothing in this object points at a third party — which is what
 * keeps «no third party learns which listing a visitor is looking at» true rather than aspirational.
 */
export function basemapStyle(
  basemaps: typeof Basemaps,
  theme: 'light' | 'dark',
  locale: string,
): MapLibre.StyleSpecification {
  const flavour = basemaps.namedFlavor(theme === 'dark' ? 'dark' : 'light');

  return {
    version: 8,
    glyphs: `${BASEMAP ?? ''}/fonts/{fontstack}/{range}.pbf`,
    sprite: `${BASEMAP ?? ''}/sprites/${theme === 'dark' ? 'dark' : 'light'}`,
    sources: {
      protomaps: {
        type: 'vector',
        /*
          The tile TEMPLATE rather than `url:`, which saves MapLibre a TileJSON round trip
          through the protocol before it can draw anything. The zoom range restates what the
          archive's own header says; `pmtiles extract` built it with `--maxzoom=14`.
        */
        tiles: [`pmtiles://${BASEMAP ?? ''}/tiles.pmtiles/{z}/{x}/{y}`],
        minzoom: 0,
        maxzoom: 14,
        /* ODbL: this must stay visible, so every map adds an AttributionControl. */
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: basemaps.layers('protomaps', flavour, {
      lang: locale,
    }) as MapLibre.LayerSpecification[],
  };
}

/**
 * What the server leaves in a map URL for the client to replace.
 *
 * ## Why it lives HERE and not beside the component that uses it
 *
 * It was exported from `search-map.tsx`, which carries `'use client'` — so importing it into
 * the Server Component that builds the URL did not yield the string. It yielded React's client
 * REFERENCE STUB: a function that throws «Attempted to call BBOX_PLACEHOLDER() from the
 * server». That stub was then stringified straight into the query, and the map's «search this
 * area» produced `?bbox=function(){throw Error(...)}`.
 *
 * Nothing warned. The typecheck is satisfied because the declared type is `string`, the build
 * passes, the page renders, and the only symptom is a filter that silently matches nothing.
 * A constant shared across the boundary has to come from a module neither side owns.
 */
export const BBOX_PLACEHOLDER = '__SAFRA_BBOX__';
