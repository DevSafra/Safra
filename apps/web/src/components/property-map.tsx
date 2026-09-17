'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { areaCircle, PUBLIC_MAP_MAX_ZOOM, PUBLIC_MAP_ZOOM } from '@safra/contracts';
import { basemapBase } from '@safra/session';

import { PropertyMapCard, type PropertyMapCardData } from './property-map-card';

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
  /** The button that opens the full-screen map. */
  readonly explore: string;
  /** Names the inline map for a screen reader. */
  readonly region: string;
  /** The control that leaves the full-screen map. */
  readonly close: string;
  /** The full-screen map's accessible name. */
  readonly dialog: string;
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
 * ## Two maps, and why they are not one
 *
 * The card carries an INERT thumbnail; «اعرض على الخريطة» opens a full-screen one that
 * pans and zooms, the arrangement Bashar asked for by screenshot (2026-09-17). They are
 * separate MapLibre instances rather than one canvas moved between containers: moving a
 * React-owned node between trees to keep a WebGL context alive is the kind of cleverness
 * that survives until the next render. The second instance is nearly free — the tiles,
 * glyphs and sprite it needs are already in the browser's cache from the first.
 *
 * The thumbnail never becomes interactive. A live map inside a scrolling page steals the
 * wheel on a laptop and the finger on a phone, and a reader trying to scroll past a
 * listing should not have to escape a map to do it.
 *
 * ## MapLibre is pinned to v5, deliberately
 *
 * `maplibre-gl@6` does not work with `pmtiles@4`'s protocol handler, and the failure has
 * no error attached to it: the style loads, the canvas gets a drawing surface, WebGL
 * reports itself healthy, and the source simply never leaves `isSourceLoaded: false`, so
 * `load` never fires and the map stays blank. v6.10 now throws before it creates a canvas.
 *
 * Verified by swapping only the major — v6 blank, v5.24.0 draws. Anybody raising this to 6
 * needs to check that a tile actually renders, not that the build passes. It is also why
 * `package.json` carries an audit exemption; `map-sanitiser-reach.test.ts` holds that
 * exemption to account.
 *
 * ## Why the library is not in the page bundle
 *
 * MapLibre and its RTL text plugin are around 300 KB gzipped, which is not a price a
 * reader should pay for a listing they scroll half of. Everything is behind a dynamic
 * `import()` fired by an `IntersectionObserver`, so the map costs exactly nothing until
 * «الموقع» comes into view, and nothing at all to somebody who never reaches it.
 */
export function PropertyMap({
  latitude,
  longitude,
  locale,
  labels,
  card,
}: {
  readonly latitude: string;
  readonly longitude: string;
  readonly locale: string;
  readonly labels: PropertyMapLabels;
  /** The listing, for the panel beside the full-screen map. */
  readonly card: PropertyMapCardData;
}) {
  const thumbnail = useRef<HTMLDivElement | null>(null);
  const full = useRef<HTMLDivElement | null>(null);
  const overlay = useRef<HTMLDivElement | null>(null);
  /** Where focus was before the overlay opened, so it can be put back. */
  const opener = useRef<HTMLElement | null>(null);

  const [near, setNear] = useState(false);
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  /** Set once the thumbnail has drawn, so the placeholder can step out from under it. */
  const [drawn, setDrawn] = useState(false);
  /*
    Read from the document rather than passed down from the server. The theme toggle is
    client-side — it sets `data-theme` and a cookie without a navigation — so a prop
    rendered on the server is correct exactly until somebody uses the toggle, and then it
    is a light map on a dark page until the next reload.
  */
  const [theme, setTheme] = useState<'light' | 'dark'>('light');
  /**
   * A section to reach once the overlay is out of the way.
   *
   * Held in state rather than scrolled to inside the click handler, because the scroll
   * LOCK is released by the overlay effect's cleanup. Scrolling in the handler runs while
   * `body { overflow: hidden }` is still on, which does nothing, and the reader is left
   * looking at a map that did not react. An effect keyed on `open` runs after that cleanup
   * by construction, so the ordering is a guarantee rather than a guess about frames.
   */
  const [pending, setPending] = useState<string | null>(null);

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
    const element = thumbnail.current;
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

  /**
   * Builds one map into a container.
   *
   * Shared by the thumbnail and the full-screen view so there is ONE description of the
   * style, the centre and the area disc. Two copies would agree right up until somebody
   * changed the disc in one of them.
   */
  const mount = useCallback(
    async (
      container: HTMLDivElement,
      options: { interactive: boolean },
    ): Promise<{
      instance: MapLibreMap;
      library: typeof MapLibre;
      dispose: () => void;
    } | null> => {
      if (!BASEMAP) return null;

      const [maplibre, pmtiles, basemaps] = await Promise.all([
        import('maplibre-gl'),
        import('pmtiles'),
        import('@protomaps/basemaps'),
      ]);

      if (maplibre.getRTLTextPluginStatus() === 'unavailable') {
        /*
          Eager AND awaited, and both halves matter.

          The style's label expressions gate on `is-supported-script`, which answers false
          for Arabic until the plugin is in memory — so loading it LAZILY produces a map
          with no labels at all and nothing in the console. And starting the download
          without WAITING lets the first tiles parse before it lands; those tiles keep the
          layout they were parsed with, and «محطة قطار الحجاز» comes out as «زاجحلا راطق
          ةطحم», letter for letter backwards.

          The plugin is WebAssembly, so the CSP needs `'wasm-unsafe-eval'` — see `wasm` in
          `@safra/session`'s `buildCsp`, which is deliberately NOT `'unsafe-eval'`.
        */
        await maplibre.setRTLTextPlugin('/map/mapbox-gl-rtl-text.js', false);
      }

      const protocol = new pmtiles.Protocol();
      maplibre.addProtocol('pmtiles', protocol.tile);

      const flavour = basemaps.namedFlavor(theme === 'dark' ? 'dark' : 'light');

      const instance = new maplibre.Map({
        container,
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
                range restates what the archive's own header says; `pmtiles extract` built
                it with `--maxzoom=14`, and the map overzooms from there.
              */
              tiles: [`pmtiles://${BASEMAP}/tiles.pmtiles/{z}/{x}/{y}`],
              minzoom: 0,
              maxzoom: 14,
              /* ODbL: this must stay visible, so it is a permanent control below. */
              attribution: '© OpenStreetMap contributors',
            },
          },
          layers: basemaps.layers('protomaps', flavour, {
            lang: locale,
          }) as MapLibre.LayerSpecification[],
        },
        center: [Number(longitude), Number(latitude)],
        zoom: PUBLIC_MAP_ZOOM,
        maxZoom: PUBLIC_MAP_MAX_ZOOM,
        attributionControl: false,
        interactive: options.interactive,
      });

      instance.addControl(
        new maplibre.AttributionControl({ compact: false }),
        'bottom-right',
      );

      /*
        A missing glyph range must not blank the card — a word renders as boxes and the
        rest of the map is still useful. A style or source that cannot load means there is
        no map at all, and the card is better off without an empty canvas.
      */
      instance.on('error', (event: { error?: unknown }) => {
        const message = event.error instanceof Error ? event.error.message : '';
        if (/style|source|sprite/i.test(message)) setFailed(true);
      });

      instance.on('load', () => {
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
      });

      /*
        MapLibre measures its container ONCE, at construction, and then only listens for
        window resizes. That is not enough here: the full-screen map is built into a
        container React has just mounted, and it came up as a 1440x300 canvas — MapLibre's
        fallback size for a container it could not measure — leaving the middle of the
        screen showing the backdrop rather than the map. Dragging there hit the dialog and
        moved nothing, which is how this was found.

        A `ResizeObserver` fixes the mount case and every later one for free: the panel
        turning from a bottom sheet into a side column changes the map's box too.
      */
      const resizer = new ResizeObserver(() => instance.resize());
      resizer.observe(container);

      return {
        instance,
        library: maplibre,
        dispose: () => {
          resizer.disconnect();
          instance.remove();
        },
      };
    },
    [latitude, longitude, locale, theme],
  );

  /* The thumbnail: inert, and only once the section is nearly in view. */
  useEffect(() => {
    if (!near || !thumbnail.current || !BASEMAP) return;

    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const container = thumbnail.current;
        const built = container ? await mount(container, { interactive: false }) : null;

        if (!built) return;

        if (cancelled) {
          built.dispose();

          return;
        }

        dispose = built.dispose;
        built.instance.on('load', () => {
          if (!cancelled) setDrawn(true);
        });
      } catch {
        /*
          WebGL refused, or a chunk did not arrive. Either way the reader keeps the
          address above and loses only a picture.
        */
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [near, mount]);

  /* The full-screen map: built when it opens, destroyed when it closes. */
  useEffect(() => {
    if (!open || !full.current || !BASEMAP) return;

    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const container = full.current;
        const built = container ? await mount(container, { interactive: true }) : null;

        if (!built) return;

        if (cancelled) {
          built.dispose();

          return;
        }

        dispose = built.dispose;
        built.instance.addControl(
          new built.library.NavigationControl({ showCompass: false }),
          'bottom-right',
        );
      } catch {
        if (!cancelled) setOpen(false);
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
  }, [open, mount]);

  const close = useCallback(() => {
    setOpen(false);
    /* Back to the button that opened it, not to the top of the document. */
    opener.current?.focus();
  }, []);

  /*
    Escape leaves, Tab stays inside, and the page underneath does not scroll. A full-screen
    layer the keyboard can walk out of is modal in appearance only.
  */
  useEffect(() => {
    if (!open) return;

    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();

        return;
      }

      if (event.key !== 'Tab') return;

      const root = overlay.current;
      if (!root) return;

      const focusable = root.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!first || !last) return;

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  useEffect(() => {
    if (open || !pending) return;

    const target = document.getElementById(pending);
    setPending(null);

    if (!target) return;

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    target.scrollIntoView({ behavior: still ? 'auto' : 'smooth', block: 'start' });
  }, [open, pending]);

  /* Focus moves into the layer, so a keyboard reader is not left on the page behind it. */
  useEffect(() => {
    if (!open) return;

    overlay.current?.querySelector<HTMLElement>('button')?.focus();
  }, [open]);

  if (!BASEMAP || failed) return null;

  return (
    <figure className="relative border-t border-line">
      <div
        ref={thumbnail}
        role="region"
        aria-label={labels.region}
        className="h-48 w-full sm:h-56 lg:h-64"
      />

      {!drawn ? (
        <div aria-hidden className="absolute inset-0 animate-pulse bg-field" />
      ) : null}

      <button
        type="button"
        onClick={(event) => {
          opener.current = event.currentTarget;
          setOpen(true);
        }}
        className="btn-gold absolute bottom-3 left-1/2 -translate-x-1/2 cursor-pointer rounded-full px-4 py-2 text-sm font-bold shadow-[var(--shadow-lift)] transition-[transform,box-shadow] duration-150 ease-out-strong hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-card active:scale-[0.97] motion-reduce:transition-none"
      >
        {labels.explore}
      </button>

      {open ? (
        <div
          ref={overlay}
          role="dialog"
          aria-modal="true"
          aria-label={labels.dialog}
          /*
            `z-[70]` is the slider's own layer, for the same reason: this has to cover the
            site header, which is sticky. Anything lower and the map opens underneath the
            navigation.
          */
          className="fixed inset-0 z-[70] bg-bg"
        >
          {/*
            `h-full w-full`, NOT `absolute inset-0`.

            MapLibre adds `maplibregl-map` to its container and its own stylesheet declares
            `.maplibregl-map { position: relative }` — one class beating one class, decided
            by stylesheet order, which it wins. So `absolute` was overridden, `inset-0`
            stopped sizing anything, the element collapsed to 1440x0, and MapLibre fell
            back to a 300px-tall canvas. The middle of the screen showed the backdrop and
            dragging there moved nothing.

            An explicit height cannot be argued with, and it is why the thumbnail above —
            which has always carried `h-48 sm:h-56 lg:h-64` — never showed this.
          */}
          <div ref={full} className="h-full w-full" />

          {/*
            Logical properties, so the close control sits opposite the panel in BOTH
            directions. On the Arabic screen that puts it physically left and the listing
            physically right, which is the arrangement in the reference.
          */}
          <button
            type="button"
            onClick={close}
            className="absolute end-4 top-4 z-10 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-bold text-text shadow-[var(--shadow-lift)] transition-[transform,box-shadow] duration-150 ease-out-strong hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.97] motion-reduce:transition-none lg:min-h-0 lg:py-2"
          >
            <CloseIcon />
            {labels.close}
          </button>

          {/*
            A sheet at the foot of a phone, a column beside the map from `lg` up. The panel
            is the CONTENT, so it takes the start side — physically right in Arabic.

            `bottom-7` rather than `bottom-3`, and the 16px is not taste: MapLibre draws its
            attribution across the bottom 20px, the full-width sheet covered the top 8px of
            it, and ODbL requires that line to be legible rather than «hidden beneath UI».
            Measured, not eyeballed — the sheet's own rectangle against the attribution's.
          */}
          <div className="absolute inset-x-3 bottom-7 z-10 lg:inset-x-auto lg:bottom-auto lg:start-4 lg:top-4 lg:w-[22rem]">
            <PropertyMapCard
              data={card}
              onView={(event) => {
                event.preventDefault();
                setPending(card.viewHref.replace(/^#/, ''));
                close();
              }}
            />
          </div>
        </div>
      ) : null}
    </figure>
  );
}

/** A cross, in the stroke weight the rest of the product's icons are drawn at. */
function CloseIcon() {
  return (
    <svg
      aria-hidden
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      className="shrink-0"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
