'use client';

import { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { LandmarkIcon } from './landmark-icon';

export interface NearbyStay {
  readonly slug: string;
  readonly name: string;
  readonly latitude: string;
  readonly longitude: string;
  /** The advertised nightly floor, already formatted for display, or null. */
  readonly price: string | null;
  /**
   * How many listings share this published point — 1 normally.
   *
   * Counted by the API rather than here, because the API's LIMIT is a budget of POINTS and
   * it therefore sends one entry per point. Grouping again in the browser would be grouping
   * an already-grouped list and would quietly disagree the day the API's rule changed.
   */
  readonly staysHere: number;
}

/**
 * The price pills for nearby listings, drawn OVER the map rather than by it.
 *
 * ## This is why they are not `maplibre.Marker`s
 *
 * `maplibre-gl@5` carries GHSA-jrc7-96c5-q579, a CRITICAL XSS bypass in its `DOM.sanitize()`
 * that cannot be patched here — the fix landed in 6.4.1 and v6 does not work with `pmtiles@4`.
 * `package.json` ignores the advisory on ONE ground: nothing attacker-controlled reaches that
 * sanitiser, because the map renders no markers, no popups and no HTML content, and
 * `map-sanitiser-reach.test.ts` fails the day that stops being true.
 *
 * A neighbour's pill carries a PARTNER-SUPPLIED name. Rendering it through `new Marker()`
 * would have walked a partner's text straight into the vulnerable path and made a critical
 * advisory live — through a feature that looks purely cosmetic. So the pills are ordinary
 * React elements in an overlay, positioned from `map.project()`: React sets text through
 * `textContent`, MapLibre's DOM helpers are never called, and the exemption stays honest.
 *
 * It is better UI for it, too. These are real anchors, so they are keyboard reachable, they
 * carry a focus ring, middle-click opens a tab, and they inherit the page's own type scale
 * instead of MapLibre's.
 *
 * ## Why co-located listings are a certainty, not an edge case
 *
 * Published coordinates are rounded to three decimals (~100 m), so two hotels on the same
 * street round to the SAME point and no amount of zooming will ever separate them. A map
 * that drew one pill per listing would stack them into an unreadable pile in exactly the
 * dense districts where the feature matters. They are grouped by published point instead,
 * and a group says how many it holds.
 */
export function MapPriceMarkers({
  map,
  stays,
  hrefPrefix,
}: {
  readonly map: MapLibreMap | null;
  readonly stays: readonly NearbyStay[];
  /** `/ar/property/` — the slug is appended. A prefix crosses the boundary; a builder cannot. */
  readonly hrefPrefix: string;
}) {
  /*
    Read HERE rather than passed down as props, which is what the other client components in
    this app do. Copy handed across the Server/Client boundary has to be plain strings —
    a `(count) => …` formatter is a 500 at request time — and reading the catalogue in the
    component that renders it sidesteps the question entirely.
  */
  const t = useTranslations('property');
  const [placed, setPlaced] = useState<
    ReadonlyArray<{ stay: NearbyStay; x: number; y: number }>
  >([]);

  const reproject = useCallback(() => {
    if (!map) return;

    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    setPlaced(
      stays
        .map((stay) => {
          const point = map.project([Number(stay.longitude), Number(stay.latitude)]);
          return { stay, x: point.x, y: point.y };
        })
        /*
          Only pills that can actually be SEEN. A pill parked off-screen is still a focusable
          anchor in the tab order, so a keyboard reader would tab through listings that are
          nowhere on their screen.

          The test is on the CENTRE against the canvas, with no cushion. A pill is centred on
          its point, so a centre on the canvas guarantees the middle of the pill is visible,
          and a centre off it guarantees at most a sliver. A generous margin was tried first
          and was wrong in the direction that matters: sized for the widest pill, it rendered
          a NARROW one — «$45», 60px — entirely off-screen at x = -96, because the margin
          assumed a width that pill did not have. The centre needs no width to reason about.
        */
        .filter(({ x, y }) => x >= 0 && y >= 0 && x <= width && y <= height),
    );
  }, [map, stays]);

  useEffect(() => {
    if (!map) return;

    reproject();
    /*
      `move` fires continuously through a drag and an animated zoom, which is what keeps a
      pill glued to its point. `setState` per frame is affordable at a dozen markers and is
      what MapLibre's own marker does internally.
    */
    map.on('move', reproject);
    map.on('resize', reproject);

    return () => {
      map.off('move', reproject);
      map.off('resize', reproject);
    };
  }, [map, reproject]);

  if (placed.length === 0) return null;

  return (
    /*
      `pointer-events-none` on the layer and `auto` on each pill, so the map still pans when
      the reader drags the gaps between them. Without it the overlay eats every gesture that
      begins anywhere in the viewport.
    */
    <div className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {placed.map(({ stay, x, y }) => {
        const many = stay.staysHere > 1;

        /*
          No advertised price draws a DOT, not a pill reading «لا يوجد سعر معلن».
          A map marker's whole job is a number a reader can compare at a glance, and a
          sentence where the number should be is both the widest thing on the map and the
          least useful — it shouted the one listing that had nothing to say. The dot still
          marks the place and still links to it; the name is in its `title`.
        */
        if (!stay.price) {
          return (
            <a
              key={stay.slug}
              href={`${hrefPrefix}${stay.slug}`}
              style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
              className="pointer-events-auto absolute top-0 left-0 block size-3.5 cursor-pointer rounded-full border-2 border-card bg-muted shadow-[var(--shadow-lift)] transition-[background-color,transform] duration-150 ease-out hover:scale-125 hover:bg-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-read"
              title={stay.name}
            >
              {/*
                A screen reader gets what the dot cannot draw. A priced marker announces its
                price as visible text; this one would otherwise announce nothing at all.
              */}
              <span className="sr-only">{`${stay.name} — ${t('noPrice')}`}</span>
            </a>
          );
        }

        const price = stay.price;

        return (
          <a
            key={stay.slug}
            href={`${hrefPrefix}${stay.slug}`}
            style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
            /*
              `top-0 left-0` plus a transform, rather than `left: x`: a transform is composited
              and does not invalidate layout, so dragging the map does not relayout the
              overlay once per frame.
            */
            className="pointer-events-auto absolute top-0 left-0 inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-full border border-line bg-card px-2.5 py-1 text-13 font-bold whitespace-nowrap text-text shadow-[var(--shadow-lift)] transition-[background-color,color,box-shadow] duration-150 ease-out hover:bg-gold hover:text-ink hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-read"
            title={stay.name}
          >
            <span className="tabular-nums">{price}</span>
            {/*
              The count rides BESIDE the price rather than replacing it. A pill that read
              «3 stays here» and nothing else made the map's one job — comparing prices at a
              glance — impossible at exactly the points where several listings compete.
            */}
            {many ? (
              <span className="text-11 font-normal opacity-70">
                {t('nearbyCount', { count: stay.staysHere })}
              </span>
            ) : null}
          </a>
        );
      })}
    </div>
  );
}

export interface MapLandmark {
  readonly slug: string;
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly iconPaths: readonly string[];
  readonly distanceLabel: string;
}

/**
 * The landmarks a listing is measured against, drawn ON the map.
 *
 * ## Why «800 م» was not enough
 *
 * The location card printed «الجامع الأموي — ٨٠٠ م» directly under a map that showed the area
 * disc and nothing else. So the number had a magnitude and no DIRECTION, and 800 m toward the
 * old city is a different stay from 800 m toward a motorway. The two halves of «where is this»
 * were not talking to each other.
 *
 * ## Landmark coordinates are exact, and that is not a leak
 *
 * These are published facts — a mosque, a station, an airport — stored and drawn at full
 * precision, exactly as the distance list already implies. The rounding protects a home; a
 * landmark is not one. What stays rounded is the LISTING's own disc, which is the only thing on
 * this map that anybody is trying to find.
 *
 * Positioned from `map.project()` like the price pills, and for the same reason: MapLibre v5's
 * marker path runs through the sanitiser GHSA-jrc7-96c5-q579 bypasses, and a landmark's name is
 * operator-supplied text.
 */
export function MapLandmarks({
  map,
  landmarks,
}: {
  readonly map: MapLibreMap | null;
  readonly landmarks: readonly MapLandmark[];
}) {
  const [placed, setPlaced] = useState<
    ReadonlyArray<{ mark: MapLandmark; x: number; y: number }>
  >([]);

  const reproject = useCallback(() => {
    if (!map) return;

    const canvas = map.getCanvas();
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    setPlaced(
      landmarks
        .map((mark) => {
          const point = map.project([mark.longitude, mark.latitude]);
          return { mark, x: point.x, y: point.y };
        })
        .filter(({ x, y }) => x >= 0 && y >= 0 && x <= width && y <= height),
    );
  }, [map, landmarks]);

  useEffect(() => {
    if (!map) return;

    reproject();
    /*
      `idle` as well as `move`, because the THUMBNAIL is inert and emits no `move` at all — so
      its first projection has to be right, and one taken at `load` can be against a canvas
      that has not been laid out yet. `idle` fires once the map has finished rendering, which
      is the first moment the canvas reliably has its real size.

      ## What the thumbnail can and cannot show, measured

      MapLibre uses 512px tiles, so `PUBLIC_MAP_ZOOM` of 15 is ~2 m per CSS pixel — not the
      ~4 the 256px-tile formula suggests. The thumbnail is a 256px strip, so its window is
      about ±255 m of the listing, and a landmark 400 m away is outside it by arithmetic
      rather than by any fault of this code.

      Left in place on both maps regardless: a listing genuinely beside a souq or a station
      will draw it, and the full-screen map — where a reader actually explores — shows them
      all. Zooming the thumbnail out to fit them would take it below 15, where the basemap
      stops drawing street names, which is the defect `PUBLIC_MAP_ZOOM` exists to prevent.
    */
    map.on('move', reproject);
    map.on('resize', reproject);
    map.on('idle', reproject);

    return () => {
      map.off('move', reproject);
      map.off('resize', reproject);
      map.off('idle', reproject);
    };
  }, [map, reproject]);

  if (placed.length === 0) return null;

  return (
    /*
      UNDER the price pills — `z-0` against their `z-10`. A landmark is the reference frame and
      a listing is the thing being chosen, so where the two collide the price wins.
    */
    <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden">
      {placed.map(({ mark, x, y }) => (
        <span
          key={mark.slug}
          style={{ transform: `translate(-50%, -50%) translate(${x}px, ${y}px)` }}
          className="absolute top-0 left-0 flex flex-col items-center gap-0.5"
        >
          <span className="flex size-7 items-center justify-center rounded-full border border-line bg-card/95 text-text shadow-[var(--shadow-lift)]">
            <LandmarkIcon paths={mark.iconPaths} size="1rem" />
          </span>
          {/*
            The name under the mark, capped and with a scrim behind it. Without one it lands on
            whatever the basemap drew there — a road name, a park — and both become unreadable.
          */}
          <span className="max-w-[7.5rem] truncate rounded bg-card/85 px-1 text-11 leading-tight font-bold text-text">
            {mark.name}
          </span>
        </span>
      ))}
    </div>
  );
}
