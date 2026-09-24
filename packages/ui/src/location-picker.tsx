'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type * as MapLibre from 'maplibre-gl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { guestAreaData, type GuestArea } from './guest-area.js';

import 'maplibre-gl/dist/maplibre-gl.css';

export interface LocationPickerCopy {
  readonly heading: string;
  readonly help: string;
  readonly missing: string;
  readonly set: string;
  readonly clear: string;
  readonly coordinates: string;
  readonly unavailable: string;
  /**
   * What the guest-facing area is called, and what it promises.
   *
   * Optional, because the console's landmark picker has nothing to reassure anybody about — a
   * landmark's position is a published fact stored exactly. Both are required together by
   * `guestArea` below: a shaded circle with no sentence beside it is a mystery, not a promise.
   */
  readonly guestArea?: string;
  readonly guestAreaHelp?: string;
  /** The heading over the landmark shortcuts. Absent when no landmarks are passed. */
  readonly startFrom?: string;
}

/** A place a partner recognises, to open the map somewhere other than a grey rectangle. */
export interface LocationPickerLandmark {
  readonly slug: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

const GUEST_SOURCE = 'safra-guest-area';

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
  guestArea = false,
  landmarks,
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
  /**
   * Draw the area a GUEST will see, around the rounded point.
   *
   * ## Why this is the feature and not decoration
   *
   * The reason 97% of listings are unplaced is very unlikely to be that partners could not work
   * the form — it is that «put my building on a public map» sounds like publishing an address.
   * SAFRA's answer has been true since the generated columns landed and has never once been shown
   * to the person it protects: the published pair is ROUNDED, and the exact one is unreachable
   * from any public query.
   *
   * So this draws it. The circle is centred on the rounded point, not the real one, and its radius
   * is the furthest the real point can be from it — which makes the picture a statement of the
   * guarantee rather than an illustration of it.
   *
   * Off by default: a landmark has nothing to hide and its position is stored exactly.
   */
  readonly guestArea?: boolean;
  /**
   * Places to jump to, offered as shortcuts before the partner starts panning.
   *
   * «near the Umayyad Mosque» is how somebody describes where their guest house is; a city centred
   * at zoom 12 is not. Choosing one MOVES the map and sets nothing — the partner still has to place
   * their own building, and a shortcut that silently claimed the listing sits on a mosque would be
   * worse than no shortcut.
   */
  readonly landmarks?: readonly LocationPickerLandmark[];
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
  const latest = useRef({ onChange, latitude, longitude });
  useEffect(() => {
    latest.current = { onChange, latitude, longitude };
  }, [onChange, latitude, longitude]);

  /** Reads the centre back out and hands it up, at the precision a building needs. */
  const publish = useCallback(() => {
    const map = instance.current;
    if (!map) return;

    const centre = map.getCenter();
    /*
      Six decimals is about 0.1 m — more than a building needs and less than a float64
      argues about. The PUBLIC value is rounded to three by the database on the way out.
    */
    latest.current.onChange({
      latitude: centre.lat.toFixed(6),
      longitude: centre.lng.toFixed(6),
    });
  }, []);

  /*
    Redraw the circle whenever the pair changes — and ONLY the circle.

    Separate from the effect that builds the map, because that one must run exactly once: listing
    the coordinates as its dependencies would tear the map down and rebuild it at the opening
    centre every time the partner finished a pan, which is the single behaviour that makes a
    picker unusable. `setData` moves the polygon without touching anything else.
  */
  useEffect(() => {
    const map = instance.current;

    if (!guestArea || !map) return;

    const source = map.getSource(GUEST_SOURCE) as
      { setData: (data: GuestArea) => void } | undefined;

    source?.setData(guestAreaData(latitude, longitude));
  }, [guestArea, latitude, longitude]);

  /**
   * Move the map to a place the partner recognises. It sets nothing.
   *
   * `flyTo` is the honest animation here: the reader needs to understand that the map TRAVELLED
   * rather than that a different map appeared, and a cut between two city blocks is disorienting
   * in a way a 700 ms flight is not. Under `prefers-reduced-motion` it jumps instead — the
   * information is the destination, and nobody needs the journey to get it.
   */
  const goTo = useCallback((landmark: LocationPickerLandmark) => {
    const map = instance.current;

    if (!map) return;

    const reduced =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const view = {
      center: [landmark.longitude, landmark.latitude] as [number, number],
      zoom: 15,
    };

    if (reduced) map.jumpTo(view);
    else map.flyTo({ ...view, duration: 700, essential: true });
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

        /*
          The guest area, as a SOURCE and two LAYERS rather than an overlay element.

          A circle drawn in HTML would have to be re-sized from `map.project()` on every frame of
          every pan; a polygon in metres is correct at every zoom for free. It is also the one
          shape on this map that must not drift — the whole claim is «this is exactly what a guest
          sees», and a circle that lagged the pin by a frame would undermine it.

          Layers, not a `Marker`: the CVE exemption in `package.json` forbids MapLibre's marker and
          popup paths, and `map-sanitiser-reach.test.ts` fails the build if one appears here.
        */
        if (guestArea) {
          map.on('load', () => {
            if (map.getSource(GUEST_SOURCE)) return;

            map.addSource(GUEST_SOURCE, {
              type: 'geojson',
              data: guestAreaData(latest.current.latitude, latest.current.longitude),
            });
            map.addLayer({
              id: `${GUEST_SOURCE}-fill`,
              type: 'fill',
              source: GUEST_SOURCE,
              paint: { 'fill-color': '#c9a227', 'fill-opacity': 0.18 },
            });
            map.addLayer({
              id: `${GUEST_SOURCE}-line`,
              type: 'line',
              source: GUEST_SOURCE,
              paint: {
                'line-color': '#c9a227',
                'line-width': 2,
                'line-opacity': 0.9,
                'line-dasharray': [2, 2],
              },
            });
          });
        }

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
  }, [publish, basemapUrl, guestArea]);

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

      {/*
        Shortcuts to somewhere recognisable, ABOVE the map rather than below it.

        A partner who has never used a map control meets the hard part first otherwise: a city at
        zoom 12 is a grey rectangle, and «pan until you find your street» is the instruction that
        produced 3% coverage. «قرب الجامع الأموي» is how the same person would describe the place
        out loud.
      */}
      {landmarks && landmarks.length > 0 && copy.startFrom ? (
        <div className="mt-3">
          <p className="text-12 text-faint">{copy.startFrom}</p>
          <ul className="mt-1.5 flex flex-wrap gap-1.5">
            {landmarks.map((landmark) => (
              <li key={landmark.slug}>
                <button
                  type="button"
                  onClick={() => goTo(landmark)}
                  className="inline-flex min-h-10 cursor-pointer items-center rounded-full border border-line bg-card px-3 text-12 text-muted transition-colors hover:border-gold hover:text-text active:scale-[0.98] lg:min-h-0 lg:py-1.5"
                >
                  {landmark.name}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

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

      {/*
        The circle needs its sentence or it is just a shape. Shown only once something is placed,
        because there is nothing to promise about a location that does not exist yet.
      */}
      {guestArea && placed && copy.guestArea && copy.guestAreaHelp ? (
        <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5 text-12">
          <span
            aria-hidden="true"
            className="inline-block h-2.5 w-2.5 rounded-full border border-dashed border-gold bg-gold/15"
          />
          <span className="font-bold text-text">{copy.guestArea}</span>
          <span className="text-faint">{copy.guestAreaHelp}</span>
        </p>
      ) : null}

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
