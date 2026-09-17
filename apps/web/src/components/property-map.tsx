'use client';

import { useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { areaCircle, PUBLIC_MAP_MAX_ZOOM, PUBLIC_MAP_ZOOM } from '@safra/contracts';
import { basemapBase } from '@safra/session';

/*
  MapLibre's own stylesheet, ~10 KB gzipped. Imported statically rather than with the
  library because Next collects a client component's CSS into the route's sheet, and a
  stylesheet that arrived with the dynamic chunk would paint an unpositioned canvas for a
  frame first. The `import type` above costs nothing — it is erased before bundling.
*/
import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * Where the self-hosted basemap lives. Absent means the page draws no map at all.
 *
 * Read through `basemapBase` so this and the CSP in `middleware.ts` derive the SAME origin
 * from the same rule. Next inlines `process.env.NEXT_PUBLIC_*` at build time, so both
 * names have to be written out literally here rather than passed as a variable.
 */
const BASEMAP = basemapBase({
  NEXT_PUBLIC_BASEMAP_URL: process.env['NEXT_PUBLIC_BASEMAP_URL'],
  NEXT_PUBLIC_MEDIA_URL: process.env['NEXT_PUBLIC_MEDIA_URL'],
});

export interface PropertyMapLabels {
  /** The button that hands the map over to the reader. */
  readonly explore: string;
  /** Names the region for a screen reader. */
  readonly region: string;
}

/**
 * The location map on a property page (O-web-12).
 *
 * ## Why an interactive map does not leak the address
 *
 * The privacy model is not «the reader may not zoom». It is that the exact location is
 * NEVER SENT: `fuzzCoordinate` rounds to three decimals before the payload leaves the
 * API, so the browser holds a point good to about 100 m and nothing better. Panning and
 * zooming cannot reveal a precision that was never transmitted, which is why turning the
 * map loose is safe here and would not be on a site that shipped exact coordinates and
 * hid them behind a viewport.
 *
 * Two things follow from that rather than from secrecy:
 *
 * - **A disc, not a pin.** The reference this was built from draws a teardrop on the
 *   building. A pin asserts a precision we do not have; the disc is `AREA_RADIUS_METRES`
 *   wide and says «somewhere in here», which is the true statement.
 * - **`PUBLIC_MAP_MAX_ZOOM`.** Not a security boundary — the rounded pair is in the
 *   payload and can be typed into any map on earth. At z19 a 150 m disc sits over a
 *   handful of roofs and invites «it must be one of those», a confidence the data does
 *   not support. Stopping at 16 keeps the picture as vague as the number behind it.
 *
 * ## Why the library is not in the page bundle
 *
 * MapLibre and its RTL text plugin are around 200 KB gzipped, which is not a price a
 * reader should pay for a listing they scroll half of. Everything is behind a dynamic
 * `import()` fired by an `IntersectionObserver`, so the map costs exactly nothing until
 * «الموقع» comes into view, and nothing at all to somebody who never reaches it.
 *
 * ## MapLibre is pinned to v5, deliberately
 *
 * `maplibre-gl@6` does not work with `pmtiles@4`'s protocol handler. The failure has no
 * error attached to it: the style loads, the canvas gets a drawing surface, WebGL reports
 * itself healthy, and the source simply never leaves `isSourceLoaded: false`, so `load`
 * never fires and the map stays blank. Nothing appears in the console and nothing appears
 * in our logs.
 *
 * Verified by swapping only the major — v6.10.0 blank, v5.24.0 draws. Anybody raising this
 * to 6 needs to check that a tile actually renders, not that the build passes.
 *
 * ## Why the reader has to ask before it moves
 *
 * It mounts inert — no drag, no scroll-zoom — and becomes interactive on «اعرض على
 * الخريطة». A live map inside a scrolling page steals the wheel on a laptop and the
 * finger on a phone, and a reader trying to get past a listing should not have to escape
 * a map to do it.
 */
export function PropertyMap({
  latitude,
  longitude,
  locale,
  labels,
}: {
  readonly latitude: string;
  readonly longitude: string;
  readonly locale: string;
  readonly labels: PropertyMapLabels;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const map = useRef<MapLibreMap | null>(null);
  /** The loaded module, kept so `enable` can add a control without importing again. */
  const lib = useRef<typeof MapLibre | null>(null);
  const [near, setNear] = useState(false);
  /*
    Read from the document rather than passed down from the server.

    The theme toggle is client-side — it sets `data-theme` and a cookie without a
    navigation — so a prop rendered on the server is correct exactly until somebody uses
    the toggle, and then it is a light map on a dark page until the next reload.
  */
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  const [interactive, setInteractive] = useState(false);
  /*
    The same fact as `interactive`, as a ref, because the map effect must READ it without
    DEPENDING on it: a theme switch rebuilds the map, and a rebuilt map that came up inert
    under a hidden button would leave the reader with no way to ask again.
  */
  const asked = useRef(false);
  const [failed, setFailed] = useState(false);
  /** Set once the map has drawn, so the placeholder can step out from under it. */
  const [drawn, setDrawn] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset['theme'] === 'dark' ? 'dark' : 'light');

    read();

    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  /*
    `near`, not `visible`: the observer fires 200px early so the tiles are usually there by
    the time the section is, and a reader who stops just short of the location card has
    still paid nothing.
  */
  useEffect(() => {
    const element = container.current;
    if (!element || near) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: '200px' },
    );

    observer.observe(element);

    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !container.current || !BASEMAP) return;

    let cancelled = false;

    const start = async () => {
      try {
        const [maplibre, pmtiles, basemaps] = await Promise.all([
          import('maplibre-gl'),
          import('pmtiles'),
          import('@protomaps/basemaps'),
        ]);

        if (cancelled || !container.current) return;

        lib.current = maplibre;

        /*
          Arabic needs the RTL plugin, and it must load EAGERLY — the second argument is
          `lazy`, and passing `true` produces a map with no labels at all.

          The style's label expressions gate on `is-supported-script`, which answers false
          for Arabic until the plugin is in memory. Lazy loading defers the plugin until
          RTL text is first encountered, so the check fails, every Arabic label is
          suppressed, no Arabic glyph range is ever requested, and the map draws streets,
          parks and water without one name on them. Nothing errors; it just looks like a
          basemap that forgot its labels.

          Served from our own origin rather than unpkg, so the map contacts nobody.
        */
        if (maplibre.getRTLTextPluginStatus() === 'unavailable') {
          /*
            AWAITED, and that is the second half of the same bug. Starting the download
            without waiting lets the map be created and the first tiles be parsed while the
            plugin is still in flight, and those tiles keep the layout they were parsed
            with: «محطة قطار الحجاز» came out as «زاجحلا راطق ةطحم», letter for letter
            backwards. Correct glyphs, correct font, wrong order — which reads as a broken
            font rather than a missing plugin.
          */
          await maplibre.setRTLTextPlugin('/map/mapbox-gl-rtl-text.js', false);
          if (cancelled || !container.current) return;
        }

        const protocol = new pmtiles.Protocol();
        maplibre.addProtocol('pmtiles', protocol.tile);

        const flavour = basemaps.namedFlavor(theme === 'dark' ? 'dark' : 'light');
        const centre: [number, number] = [Number(longitude), Number(latitude)];

        const instance = new maplibre.Map({
          container: container.current,
          /*
            The whole style is assembled here from files we host. No key, no vendor
            call-out, and nothing in this object points at a third party.
          */
          style: {
            version: 8,
            glyphs: `${BASEMAP}/fonts/{fontstack}/{range}.pbf`,
            sprite: `${BASEMAP}/sprites/${theme === 'dark' ? 'dark' : 'light'}`,
            sources: {
              protomaps: {
                type: 'vector',
                /*
                  The tile TEMPLATE rather than `url:`, which saves MapLibre a TileJSON
                  round trip through the protocol before it can draw anything. The zoom
                  range restates what the archive's own header says; `pmtiles extract`
                  built it with `--maxzoom=14`, and the map overzooms from there.
                */
                tiles: [`pmtiles://${BASEMAP}/tiles.pmtiles/{z}/{x}/{y}`],
                minzoom: 0,
                maxzoom: 14,
                /* ODbL: this must stay visible, so it is a permanent control below. */
                attribution: '© OpenStreetMap contributors',
              },
            },
            /*
              Cast because `@protomaps/basemaps` is built against MapLibre v5's types and
              the two `LayerSpecification` shapes are structurally identical but nominally
              distinct. A runtime check follows: the map is driven in a browser, and a
              style the renderer rejects shows up as a blank canvas immediately.
            */
            layers: basemaps.layers('protomaps', flavour, {
              lang: locale,
            }) as MapLibre.LayerSpecification[],
          },
          center: centre,
          zoom: PUBLIC_MAP_ZOOM,
          maxZoom: PUBLIC_MAP_MAX_ZOOM,
          attributionControl: false,
          /* Inert until asked. Each of these is re-enabled together in the handler below. */
          interactive: false,
        });

        map.current = instance;

        instance.addControl(
          new maplibre.AttributionControl({ compact: false }),
          'bottom-right',
        );

        /*
          A missing glyph range must not blank the card — a word renders as boxes and the
          rest of the map is still useful. A style or source that cannot load means there
          is no map at all, and the card is better off without the empty canvas.
        */
        instance.on('error', (event: { error?: unknown }) => {
          const message = event.error instanceof Error ? event.error.message : '';
          if (/style|source|sprite/i.test(message)) setFailed(true);
        });

        instance.on('load', () => {
          if (cancelled) return;

          instance.addSource('listing-area', {
            type: 'geojson',
            data: areaCircle(Number(latitude), Number(longitude)),
          });

          instance.addLayer({
            id: 'listing-area-fill',
            type: 'fill',
            source: 'listing-area',
            paint: { 'fill-color': '#a87a1f', 'fill-opacity': 0.22 },
          });

          instance.addLayer({
            id: 'listing-area-edge',
            type: 'line',
            source: 'listing-area',
            paint: { 'line-color': '#a87a1f', 'line-width': 2, 'line-opacity': 0.9 },
          });

          setDrawn(true);

          if (asked.current) giveControl(instance, maplibre);
        });
      } catch {
        /*
          WebGL refused, or a chunk did not arrive. Either way the reader keeps the
          address above and loses only a picture.
        */
        if (!cancelled) setFailed(true);
      }
    };

    void start();

    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [near, latitude, longitude, theme, locale]);

  /**
   * Hands the map over: drag, wheel, pinch and keyboard together.
   *
   * Each handler is named rather than recreating the map with `interactive: true`, which
   * would throw away the tiles already fetched and redraw from blank at the moment the
   * reader asked to look closer.
   */
  const enable = () => {
    const instance = map.current;
    const maplibre = lib.current;
    if (!instance || !maplibre) return;

    asked.current = true;
    giveControl(instance, maplibre);
    setInteractive(true);
  };

  if (!BASEMAP || failed) {
    return null;
  }

  return (
    <figure className="relative border-t border-line">
      <div
        ref={container}
        role="region"
        aria-label={labels.region}
        className="h-48 w-full sm:h-56 lg:h-64"
      />

      {!drawn ? (
        <div aria-hidden className="absolute inset-0 animate-pulse bg-field" />
      ) : null}

      {!interactive ? (
        <button
          type="button"
          onClick={enable}
          className="btn-gold absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-full px-4 py-2 text-sm font-bold shadow-[var(--shadow-lift)] transition-[transform,box-shadow] duration-150 ease-out-strong hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none"
        >
          {labels.explore}
        </button>
      ) : null}
    </figure>
  );
}

/**
 * Hands a map over to the reader: drag, wheel, pinch and keyboard together.
 *
 * Named handlers rather than rebuilding the map with `interactive: true`, which would
 * throw away the tiles already fetched and redraw from blank at the moment somebody asked
 * to look closer.
 */
function giveControl(instance: MapLibreMap, maplibre: typeof MapLibre): void {
  instance.dragPan.enable();
  instance.scrollZoom.enable();
  instance.touchZoomRotate.enable();
  instance.doubleClickZoom.enable();
  instance.keyboard.enable();
  instance.addControl(
    new maplibre.NavigationControl({ showCompass: false }),
    'top-right',
  );
}
