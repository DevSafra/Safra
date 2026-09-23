'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import 'maplibre-gl/dist/maplibre-gl.css';

export interface LocationPickerCopy {
  readonly heading: string;
  readonly help: string;
  readonly missing: string;
  readonly set: string;
  readonly clear: string;
  readonly coordinates: string;
  readonly unavailable: string;
}

/**
 * A map somebody pans under a fixed pin, to say where a thing is.
 *
 * ## One picker, two callers, and why it moved here
 *
 * Built for the partner portal on 2026-09-23; the console's landmark registry needed the same
 * control the same day. A second copy would have been a second set of MapLibre lifecycle bugs
 * to find — the RTL plugin, the ResizeObserver, the rebuild-on-every-render trap — which is
 * exactly the reasoning `ImageSlider` and `useConfirm` already record: built once, used
 * everywhere, never written again.
 *
 * The two callers differ only in their COPY and in what they do with the value:
 *
 * - a PARTNER places their own listing, and the public read path rounds it to ~100 m;
 * - an OPERATOR places a landmark, whose position is a published fact and is stored exactly.
 *
 * Neither difference belongs in here. This component answers «where», at full precision, and
 * the rounding lives where it belongs — in `properties.public_latitude`, a generated column.
 *
 * ## Why the two fields had to go
 *
 * `latitude` and `longitude` had been in the schema and on this form from the start, and on
 * 2026-09-23 **67 of 2,017 published listings had them** — 3%. Everything the guest-facing
 * map does is worth nothing to the other 97%, and the reason is not that partners refused:
 * «خط العرض (اختياري)» asks somebody who runs a guest house for a figure they have no way to
 * obtain. A map they can drag asks for something they know better than we ever will.
 *
 * ## This one is allowed full precision, and that is not a contradiction
 *
 * The public map rounds to ~100 m because the reader is anonymous. THIS map is inside an
 * authenticated session, showing the partner their own listing, and they are the one person
 * who is supposed to know exactly where it is — a picker that snapped to 100 m would make it
 * impossible to place a building accurately and would degrade every distance we publish. The
 * rounding stays where it belongs: on the way out, in `properties.public_latitude`, which is
 * a generated column no writer can reach.
 *
 * So the zoom cap is deliberately absent here too. `PUBLIC_MAP_MAX_ZOOM` exists to stop a
 * picture implying more precision than its number carries; this number carries all of it.
 *
 * ## No marker, for the reason the map card gives
 *
 * MapLibre v5's `Marker` runs through the `DOM.sanitize()` that GHSA-jrc7-96c5-q579
 * bypasses, and `map-sanitiser-reach.test.ts` fails the build if one appears. The pin here
 * is a plain element centred over the canvas — which also makes the interaction better: the
 * pin stays put and the MAP moves under it, so placing a building is a pan rather than a
 * drag-and-drop onto a moving target.
 */
export function LocationPicker({
  basemapUrl,
  latitude,
  longitude,
  fallbackLatitude,
  fallbackLongitude,
  copy,
  onChange,
}: {
  /**
   * Where the self-hosted basemap lives, PASSED IN rather than read from the environment.
   *
   * Next inlines `process.env.NEXT_PUBLIC_*` at build time, and it only compiles the app — this
   * package is `tsc`-built to `dist` before Next ever sees it, so an env read in here would be
   * `undefined` in the browser and the picker would quietly render «الخريطة غير متاحة» on every
   * screen. Each app derives it with `basemapBase` in its own code, where the inlining happens.
   */
  readonly basemapUrl: string | undefined;
  readonly latitude: string;
  readonly longitude: string;
  /** Where to open when the listing has no coordinates — its city. */
  readonly fallbackLatitude: string | null;
  readonly fallbackLongitude: string | null;
  readonly copy: LocationPickerCopy;
  readonly onChange: (next: { latitude: string; longitude: string }) => void;
}) {
  const container = useRef<HTMLDivElement | null>(null);
  const instance = useRef<MapLibreMap | null>(null);
  const [failed, setFailed] = useState(false);

  const placed = latitude.trim() !== '' && longitude.trim() !== '';

  /*
    The opening view, captured ONCE.

    A ref rather than a computed value, because this effect must build the map exactly one
    time: recomputing the centre on every render and listing it as a dependency would tear
    the map down and rebuild it at the original point each time the partner dragged it,
    which is the single behaviour that makes a picker unusable.

    The listing's own point if it has one, then its city, then Damascus — each step is a
    worse guess than the last, but all three are somewhere a partner recognises, which an
    empty grey ocean at 0,0 is not.
  */
  const opening = useRef({
    centre: [
      Number(longitude) || Number(fallbackLongitude) || 36.2765,
      Number(latitude) || Number(fallbackLatitude) || 33.5138,
    ] as [number, number],
    zoom: placed ? 16 : 12,
  });

  /*
    The latest `onChange`, held in a ref.

    The parent passes an inline arrow, so a `useCallback` closing over it changes identity on
    every render — and an effect depending on that callback would rebuild the map on every
    keystroke elsewhere in the form. The ref keeps `publish` stable while still calling the
    current handler.
  */
  const latest = useRef(onChange);
  useEffect(() => {
    latest.current = onChange;
  }, [onChange]);

  /** Reads the centre back out and hands it up, at the precision a building needs. */
  const publish = useCallback(() => {
    const map = instance.current;
    if (!map) return;

    const centre = map.getCenter();
    /*
      Six decimals is about 0.1 m — more than a building needs and less than a float64
      argues about. The PUBLIC value is rounded to three by the database on the way out.
    */
    latest.current({
      latitude: centre.lat.toFixed(6),
      longitude: centre.lng.toFixed(6),
    });
  }, []);

  useEffect(() => {
    if (!container.current || !basemapUrl) return;

    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const [maplibre, pmtiles, basemaps] = await Promise.all([
          import('maplibre-gl'),
          import('pmtiles'),
          import('@protomaps/basemaps'),
        ]);

        /*
          Eager AND awaited. The style's label expressions gate on `is-supported-script`,
          which answers false for Arabic until the plugin is in memory — loaded lazily the
          map comes up with no labels at all, and not awaited the first tiles parse without
          it and Arabic renders backwards letter by letter.
        */
        if (maplibre.getRTLTextPluginStatus() === 'unavailable') {
          await maplibre.setRTLTextPlugin('/map/mapbox-gl-rtl-text.js', false);
        }

        if (cancelled || !container.current) return;

        const protocol = new pmtiles.Protocol();
        maplibre.addProtocol('pmtiles', protocol.tile);

        const map = new maplibre.Map({
          container: container.current,
          style: {
            version: 8,
            glyphs: `${basemapUrl}/fonts/{fontstack}/{range}.pbf`,
            sprite: `${basemapUrl}/sprites/light`,
            sources: {
              protomaps: {
                type: 'vector',
                tiles: [`pmtiles://${basemapUrl}/tiles.pmtiles/{z}/{x}/{y}`],
                minzoom: 0,
                maxzoom: 14,
                attribution: '© OpenStreetMap contributors',
              },
            },
            layers: basemaps.layers('protomaps', basemaps.namedFlavor('light'), {
              lang: 'ar',
            }) as MapLibre.LayerSpecification[],
          },
          center: opening.current.centre,
          zoom: opening.current.zoom,
          attributionControl: false,
        });

        map.addControl(
          new maplibre.AttributionControl({ compact: false }),
          'bottom-right',
        );
        map.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          'top-right',
        );

        map.on('error', (event: { error?: unknown }) => {
          const message = event.error instanceof Error ? event.error.message : '';
          if (/style|source|sprite/i.test(message)) setFailed(true);
        });

        /*
          `moveend`, not `move`. Publishing on every frame of a drag would rewrite the form
          state sixty times a second and mark the form dirty before the partner has finished
          deciding — the value is what they LAND on, not what they passed over.
        */
        map.on('moveend', publish);

        /* MapLibre measures once at construction; this container is inside a form that grows. */
        const resizer = new ResizeObserver(() => map.resize());
        resizer.observe(container.current);

        instance.current = map;
        dispose = () => {
          resizer.disconnect();
          map.off('moveend', publish);
          map.remove();
          instance.current = null;
        };
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      dispose?.();
    };
    /*
      `publish` is stable by construction (see the ref above) and the opening view is a ref,
      so this list is genuinely complete — the map is built once and survives every later
      render. No lint suppression, because there is nothing to suppress.
    */
  }, [publish, basemapUrl]);

  if (!basemapUrl || failed) {
    return (
      <div className="rounded-lg border border-line bg-field p-4">
        <p className="text-13 text-muted">{copy.unavailable}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-14 font-bold text-text">{copy.heading}</h3>
        {placed ? (
          <button
            type="button"
            onClick={() => onChange({ latitude: '', longitude: '' })}
            className="inline-flex min-h-10 cursor-pointer items-center text-12 font-bold text-muted underline-offset-4 transition-colors hover:text-text hover:underline lg:min-h-0"
          >
            {copy.clear}
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-12 text-faint">{copy.help}</p>

      <div className="relative mt-3 overflow-hidden rounded-lg border border-line">
        <div ref={container} className="h-64 w-full sm:h-72" />

        {/*
          The pin is FIXED at the centre and the map moves beneath it. Dragging a pin means
          chasing a target that moves with your finger on a phone; panning a map under a
          crosshair is the interaction every mapping app settled on, and it needs no
          hit-testing, no drag state and no marker.
        */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center"
        >
          <PinMark />
        </div>
      </div>

      <p
        className="mt-2 text-12 tabular-nums text-faint"
        /* Decimal degrees are a Latin run; isolate the VALUE so RTL does not reorder it. */
        dir="ltr"
      >
        {placed ? `${latitude}, ${longitude}` : ''}
      </p>
      {!placed ? <p className="mt-2 text-12 text-warn-ink">{copy.missing}</p> : null}

      <button
        type="button"
        onClick={publish}
        className="mt-2 inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-line bg-card px-4 text-13 font-bold text-text transition-colors hover:border-gold lg:min-h-0 lg:py-2"
      >
        {copy.set}
      </button>
    </div>
  );
}

/** The crosshair over the map's centre. Drawn, at the stroke weight the rest of the app uses. */
function PinMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="2.25rem"
      height="2.25rem"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="-mt-4 text-gold-read drop-shadow-[0_1px_2px_rgba(0,0,0,0.4)]"
    >
      <path d="M12 21s7-6.5 7-11a7 7 0 1 0-14 0c0 4.5 7 11 7 11z" />
      <circle cx="12" cy="10" r="2.6" />
    </svg>
  );
}
