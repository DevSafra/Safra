'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { PUBLIC_MAP_MAX_ZOOM } from '@safra/contracts';

import { BASEMAP, BBOX_PLACEHOLDER, basemapStyle, loadMapLibre } from '@/lib/basemap';
import { MapPriceMarkers, type NearbyStay } from './map-price-markers';

import 'maplibre-gl/dist/maplibre-gl.css';

/**
 * «اعرض على الخريطة» on the search results — the map as a way to SEARCH.
 *
 * ## The gap this closes
 *
 * Every ingredient existed and none of them were wired together: every result already carries
 * its published coordinates, the price pill component was built for the property page, and the
 * bounding-box index was added with the neighbours query. What was missing was the surface —
 * a reader could see where ONE listing was, and never where the CHOICES were relative to each
 * other. That is the comparison a map is for, and it is what every major platform leads with.
 *
 * ## «ابحث في هذه المنطقة» is a navigation, not a fetch
 *
 * Panning the map offers to re-run the search over what is on screen, and it does it by going
 * to the same URL with `bbox=`. So the view is shareable, reload-safe, and back works — the
 * same reasoning the filter panel already follows. A client-side fetch would have produced a
 * result set the URL could not describe.
 *
 * ## Why a caller-chosen box cannot become a proximity oracle
 *
 * The obvious worry about letting anybody name a rectangle is that a small one, walked across
 * a city, would trace out a listing's position. It cannot: the filter compares
 * `public_latitude`/`public_longitude`, the pair rounded to ~100 m, so a box finer than that
 * grid either contains the published point or does not — which is exactly what the published
 * coordinate already says. There is nothing further to learn, so no minimum box size is needed.
 *
 * ## No `maplibre.Marker`, here either
 *
 * A pill carries a partner-supplied name, and MapLibre v5's marker path runs through the
 * `DOM.sanitize()` that GHSA-jrc7-96c5-q579 bypasses. `map-sanitiser-reach.test.ts` fails the
 * build if one appears; `MapPriceMarkers` positions ordinary anchors from `map.project()`.
 */
export function SearchMap({
  stays,
  hrefPrefix,
  bboxActive,
  bboxUrlTemplate,
  urlWithoutBbox,
}: {
  readonly stays: readonly NearbyStay[];
  readonly hrefPrefix: string;
  /** Whether the current results are already limited to a box. */
  readonly bboxActive: boolean;
  /**
   * The URL for a new box, with `BBOX` standing in for it — a TEMPLATE, not a builder.
   *
   * A `(bbox: string) => string` was the obvious shape and it is a 500 at request time: React
   * refuses to serialise a function from a Server Component, and neither the typecheck nor the
   * build says so. The server still owns the allow-list of carried parameters, because it is
   * the server that wrote every other part of this string.
   */
  readonly bboxUrlTemplate: string;
  readonly urlWithoutBbox: string;
}) {
  const t = useTranslations('search');
  const router = useRouter();

  const container = useRef<HTMLDivElement | null>(null);
  const opener = useRef<HTMLElement | null>(null);

  const [open, setOpen] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [moved, setMoved] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  useEffect(() => {
    const root = document.documentElement;
    const read = () => setTheme(root.dataset['theme'] === 'dark' ? 'dark' : 'light');

    read();
    const observer = new MutationObserver(read);
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    return () => observer.disconnect();
  }, []);

  /* Escape closes it, and focus goes back to the control that opened it. */
  const close = useCallback(() => {
    setOpen(false);
    opener.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };

    document.addEventListener('keydown', onKey);
    /* A scroll lock, or the results scroll underneath a full-screen map. */
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  useEffect(() => {
    if (!open || !container.current || !BASEMAP) return;

    let cancelled = false;
    let dispose: (() => void) | null = null;

    void (async () => {
      try {
        const { maplibre, basemaps } = await loadMapLibre();
        if (cancelled || !container.current) return;

        const instance = new maplibre.Map({
          container: container.current,
          style: basemapStyle(basemaps, theme, 'ar'),
          /*
            FITTED to the results rather than centred on one of them, because the question this
            map answers is «where are my options», not «where is this». A single result falls
            back to a sensible zoom instead of MapLibre's default whole-world view.
          */
          bounds: boundsOf(stays),
          fitBoundsOptions: { padding: 64, maxZoom: PUBLIC_MAP_MAX_ZOOM },
          maxZoom: PUBLIC_MAP_MAX_ZOOM,
          attributionControl: false,
        });

        instance.addControl(
          new maplibre.AttributionControl({ compact: false }),
          'bottom-right',
        );
        instance.addControl(
          new maplibre.NavigationControl({ showCompass: false }),
          'bottom-right',
        );

        /*
          MapLibre measures its container once at construction and then only listens for window
          resizes, which is not enough for a container React has just mounted — the map came up
          as a short canvas with the backdrop showing through the middle.
        */
        const resizer = new ResizeObserver(() => instance.resize());
        resizer.observe(container.current);

        /*
          Armed only ONCE THE MAP HAS SETTLED, and that is the whole subtlety.

          `fitBounds` is itself a camera move, so `moveend` fires as the map opens — the offer
          to «search this area» appeared immediately, over the exact result set the reader
          already had, which reads as «your results are wrong». `once('idle')` is the first
          moment the opening animation is finished, so anything after it is the reader's doing.
        */
        const onMove = () => setMoved(true);
        /*
          `void`, because MapLibre types `once` as returning a promise when called WITHOUT a
          listener — the union leaks into this overload, and an unmarked call is a floating
          promise the build refuses. Nothing is awaited here: the listener is the whole point.
        */
        void instance.once('idle', () => instance.on('moveend', onMove));

        setMap(instance);
        dispose = () => {
          resizer.disconnect();
          instance.off('moveend', onMove);
          instance.remove();
        };
      } catch {
        /* WebGL refused, or a chunk did not arrive. The list is still the answer. */
        if (!cancelled) setOpen(false);
      }
    })();

    return () => {
      cancelled = true;
      setMap(null);
      setMoved(false);
      dispose?.();
    };
  }, [open, theme, stays]);

  function searchHere(): void {
    if (!map) return;

    const bounds = map.getBounds();
    const bbox = [
      bounds.getSouth().toFixed(5),
      bounds.getWest().toFixed(5),
      bounds.getNorth().toFixed(5),
      bounds.getEast().toFixed(5),
    ].join(',');

    router.push(bboxUrlTemplate.replace(BBOX_PLACEHOLDER, encodeURIComponent(bbox)));
    setOpen(false);
  }

  if (!BASEMAP) return null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={(event) => {
            opener.current = event.currentTarget;
            setOpen(true);
          }}
          className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-4 text-13 font-bold text-text transition-colors hover:border-gold lg:min-h-0 lg:py-2"
        >
          <MapGlyph />
          {t('mapShow')}
        </button>

        {/*
          The box, said out loud and removable. A filter the reader cannot see is a filter they
          cannot undo — and this one is set by dragging, so it is the easiest to acquire by
          accident and the hardest to notice afterwards.
        */}
        {bboxActive ? (
          <span className="inline-flex min-h-10 items-center gap-2 rounded-full border border-gold/50 bg-gold/10 px-3 text-13 text-gold-read lg:min-h-0 lg:py-1.5">
            {t('mapAreaActive')}
            <a
              href={urlWithoutBbox}
              className="cursor-pointer font-bold underline underline-offset-2"
            >
              {t('mapAreaClear')}
            </a>
          </span>
        ) : null}
      </div>

      {open ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={t('mapTitle')}
          /* `z-[70]` is the slider's layer: this has to cover the sticky site header. */
          className="fixed inset-0 z-[70] bg-bg"
        >
          {/*
            `h-full w-full`, NOT `absolute inset-0`. MapLibre's own stylesheet declares
            `.maplibregl-map { position: relative }`, which beats an `absolute` of equal
            specificity by source order — the element then collapses and MapLibre falls back to
            a 300px canvas with the backdrop showing through.
          */}
          <div ref={container} className="h-full w-full" />

          <MapPriceMarkers map={map} stays={stays} hrefPrefix={hrefPrefix} />

          <button
            type="button"
            onClick={close}
            className="absolute end-4 top-4 z-20 inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-4 text-sm font-bold text-text shadow-[var(--shadow-lift)] transition-[transform,box-shadow] duration-150 ease-out hover:shadow-[var(--shadow-lift-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold active:scale-[0.97] motion-reduce:transition-none lg:min-h-0 lg:py-2"
          >
            {t('mapClose')}
            <CloseGlyph />
          </button>

          {/*
            Offered only once the reader has actually MOVED the map. Shown from the start it
            would read as «your results are wrong», when the opening view is exactly the result
            set they already have.
          */}
          {moved ? (
            <button
              type="button"
              onClick={searchHere}
              className="absolute start-1/2 top-4 z-20 inline-flex min-h-10 -translate-x-1/2 cursor-pointer items-center rounded-full bg-gold px-5 text-13 font-extrabold text-ink shadow-[var(--shadow-lift)] transition-transform duration-150 ease-out active:scale-[0.97] motion-reduce:transition-none lg:min-h-0 lg:py-2"
            >
              {t('mapSearchArea')}
            </button>
          ) : null}

          {stays.length === 0 ? (
            <p className="absolute start-1/2 bottom-8 z-20 -translate-x-1/2 rounded-full bg-card px-4 py-2 text-13 text-muted shadow-[var(--shadow-lift)]">
              {t('mapEmpty')}
            </p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * A box around every placed result, with a small pad so nothing sits on the edge.
 *
 * Falls back to Damascus where nothing on the page has coordinates — 1,950 of 2,017 listings
 * had none before the partner picker shipped, so «no result can be placed» is a real state and
 * not a defensive nicety. An unfitted map opens on the whole world, which reads as broken.
 */
function boundsOf(stays: readonly NearbyStay[]): [[number, number], [number, number]] {
  const points = stays
    .map((stay) => [Number(stay.longitude), Number(stay.latitude)] as const)
    .filter(([lon, lat]) => Number.isFinite(lon) && Number.isFinite(lat));

  if (points.length === 0)
    return [
      [36.2, 33.46],
      [36.36, 33.57],
    ];

  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  /* A floor on the span, or a single result produces a zero-size box MapLibre cannot fit. */
  const pad = 0.004;

  return [
    [Math.min(...lons) - pad, Math.min(...lats) - pad],
    [Math.max(...lons) + pad, Math.max(...lats) + pad],
  ];
}

function MapGlyph() {
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

function CloseGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1.25rem"
      height="1.25rem"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
