'use client';

import { useCallback, useEffect, useState } from 'react';

import { useTranslations } from 'next-intl';
import type { Map as MapLibreMap } from 'maplibre-gl';

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
