'use client';

import { useEffect, useRef, useState } from 'react';
import { PUBLIC_MAP_MAX_ZOOM } from '@safra/contracts';
import { BASEMAP, basemapStyle, boundsOf, loadMapLibre } from '@/lib/basemap';
import { OrnamentField } from '@/components/ornament';
import type { NearbyStay } from './map-price-markers';

/**
 * The sidebar card: the real map of the results, behind the button that opens the full one.
 *
 * It was SAFRA's ornament until Bashar asked to see the map there (2026-10-01). What keeps that
 * affordable on every results page:
 *
 * - **Loaded only when the card nears the viewport.** On a phone the card lives in the closed filter
 *   sheet, so it costs nothing until the sheet opens; the ornament holds the place until then and
 *   stays as the answer if WebGL refuses.
 * - **A picture, not a second map to drive.** `interactive: false`: dragging belongs to the dialog,
 *   and a card that pans under a scrolling thumb would steal the page's scroll.
 * - **The stays are dots in a layer, not DOM markers.** Price pills at this size would overlap into a
 *   smear; the dialog is where they are read.
 * - **Hover speaks the result cards' language** (Bashar, 2026-10-01): the frame turns gold and lifts,
 *   the map eases in by 3% like a stay's photograph, and the button lifts too. A SOLID gold line,
 *   where the cards use a tint: a translucent hairline over a street map dissolves into the streets.
 * - **The licence notice is printed, not a control.** ODbL needs it visible on every map, and
 *   MapLibre's own attribution control is a button, which cannot sit inside this one.
 */
export function MapThumbnail({
  stays,
  theme,
  label,
  onOpen,
}: {
  readonly stays: readonly NearbyStay[];
  readonly theme: 'light' | 'dark';
  readonly label: string;
  readonly onOpen: (button: HTMLButtonElement) => void;
}) {
  const card = useRef<HTMLDivElement | null>(null);
  const canvas = useRef<HTMLDivElement | null>(null);
  const [near, setNear] = useState(false);
  const [ready, setReady] = useState(false);
  /* The drawn map as a picture: see the `idle` handler for why the card shows this, not a canvas. */
  const [picture, setPicture] = useState<string | null>(null);
  /* Read from the style it draws, so the notice cannot differ from the map's own licence. */
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    const element = card.current;
    if (!element || near) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNear(true);
      },
      { rootMargin: '200px' },
    );
    observer.observe(element);

    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    if (!near || !canvas.current || !BASEMAP) return;

    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const { maplibre, basemaps } = await loadMapLibre();
        if (cancelled || !canvas.current) return;

        const tokens = getComputedStyle(document.documentElement);
        const style = basemapStyle(basemaps, theme, 'ar');
        const source = style.sources['protomaps'];
        setNotice(
          source && 'attribution' in source ? (source.attribution ?? null) : null,
        );
        const instance = new maplibre.Map({
          container: canvas.current,
          style,
          bounds: boundsOf(stays),
          fitBoundsOptions: { padding: 20, maxZoom: PUBLIC_MAP_MAX_ZOOM },
          maxZoom: PUBLIC_MAP_MAX_ZOOM,
          interactive: false,
          attributionControl: false,
          /* Kept readable after it is presented, so the `idle` handler can copy the frame. */
          canvasContextAttributes: { preserveDrawingBuffer: true },
        });

        instance.on('load', () => {
          instance.addSource('stays', {
            type: 'geojson',
            data: {
              type: 'FeatureCollection',
              features: stays
                .map((stay) => [Number(stay.longitude), Number(stay.latitude)] as const)
                .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat))
                .map(([lon, lat]) => ({
                  type: 'Feature' as const,
                  properties: {},
                  geometry: { type: 'Point' as const, coordinates: [lon, lat] },
                })),
            },
          });
          instance.addLayer({
            id: 'stays',
            type: 'circle',
            source: 'stays',
            paint: {
              'circle-radius': 4.5,
              'circle-color': tokens.getPropertyValue('--color-gold').trim(),
              'circle-stroke-width': 1.5,
              'circle-stroke-color': tokens.getPropertyValue('--color-card').trim(),
            },
          });
        });
        /*
          Once the tiles and the stays are drawn, the frame is copied into an `<img>` and the map is
          closed (Bashar, 2026-10-02, twice: «It is not rounded»). A live WebGL canvas is a layer
          the GPU composites on its own, and his browser drew its square corners over the card's
          rounded ones whatever clipped it: `overflow` + `border-radius`, then a `clip-path` on a
          layer of its own. Every engine available here clipped it correctly, so the fault could not
          be reproduced, only removed. An image is clipped the same way by every browser.

          It costs nothing the card needs: the thumbnail is never panned or zoomed, it is a picture
          of the results with a button on it, which is what booking.com's is. And it hands the
          WebGL context back, which a page that also opens the full map is short of.

          If the frame cannot be read, the live canvas stays: a square corner beats no map.
        */
        void instance.once('idle', () => {
          if (cancelled) return;
          try {
            setPicture(instance.getCanvas().toDataURL('image/jpeg', 0.9));
            resizer.disconnect();
            instance.remove();
            dispose = null;
          } catch {
            /* Kept live: see above. */
          }
          setReady(true);
        });

        const resizer = new ResizeObserver(() => instance.resize());
        resizer.observe(canvas.current);

        dispose = () => {
          resizer.disconnect();
          instance.remove();
        };
      } catch {
        /* WebGL refused, or a chunk did not arrive: the ornament stays, and the button still works. */
      }
    })();

    return () => {
      cancelled = true;
      setReady(false);
      setPicture(null);
      dispose?.();
    };
  }, [near, theme, stays]);

  return (
    <div
      ref={card}
      data-map-thumbnail
      className="group/map relative h-32 w-full overflow-hidden rounded-card border border-line bg-band transition-[border-color,box-shadow] duration-200 ease-out-strong hover:border-gold hover:shadow-[var(--shadow-lift)]"
    >
      {/*
        The map zooms a little on hover, inside its OWN clip (Bashar, 2026-10-02, screenshot
        «15.20.53»: the map's square corners showed past the card's rounded ones). The map is a
        WebGL canvas, which the GPU composites as a layer of its own, and Safari does not clip such
        a layer to an ancestor's `overflow: hidden` + `border-radius`. A `clip-path` it does
        honour, so this layer clips at the border's INNER curve (the card radius less the 1px
        border) with one, sitting inside the border so the zoom can never paint over it.
        Chromium, Firefox and headless WebKit all clipped correctly before, so the fault was only
        visible in a real Safari.
      */}
      <div
        aria-hidden
        data-map-thumbnail-clip
        className="absolute inset-0 isolate overflow-hidden rounded-[calc(var(--radius-card)-1px)] [clip-path:inset(0_round_calc(var(--radius-card)-1px))]"
      >
        <OrnamentField
          id="ornament-map-thumbnail"
          className="text-gold-read opacity-25"
        />
        <div
          ref={canvas}
          data-ready={ready}
          className={`absolute inset-0 transition-[opacity,transform] duration-500 ease-out-strong group-hover/map:scale-[1.03] motion-reduce:transition-opacity ${ready && !picture ? 'opacity-100' : 'opacity-0'}`}
        />
        {picture ? (
          <img
            src={picture}
            alt=""
            data-map-picture
            className="absolute inset-0 h-full w-full rounded-[inherit] object-cover transition-transform duration-500 ease-out-strong group-hover/map:scale-[1.03] motion-reduce:transition-none"
          />
        ) : null}
      </div>
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        className="group absolute inset-0 grid cursor-pointer place-items-center rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
      >
        <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-indigo px-4 text-14 font-bold text-bg shadow-[var(--shadow-lift)] transition-[filter,transform,box-shadow] duration-150 ease-out group-hover:shadow-[var(--shadow-lift-hover)] group-hover:brightness-110 group-active:scale-[0.97] motion-reduce:transition-none">
          <MapGlyph />
          {label}
        </span>
      </button>
      {ready && notice ? (
        <span
          dir="ltr"
          className="pointer-events-none absolute bottom-1 end-1.5 rounded bg-card/80 px-1 text-[10px] leading-4 text-muted"
        >
          {notice}
        </span>
      ) : null}
    </div>
  );
}

export function MapGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.1rem"
      height="1.1rem"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5z" />
      <path d="M9 4v13M15 6.5v13" />
    </svg>
  );
}
