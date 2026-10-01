'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { PUBLIC_MAP_MAX_ZOOM } from '@safra/contracts';

import { BASEMAP, BBOX_PLACEHOLDER, basemapStyle, loadMapLibre } from '@/lib/basemap';
import { MapPriceMarkers, type NearbyStay } from './map-price-markers';

import 'maplibre-gl/dist/maplibre-gl.css';
import { OrnamentField } from '@/components/ornament';

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
  variant = 'default',
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
  /**
   * How the OPENER is drawn (2026-10-01). `thumbnail` is booking.com's map card at the top of the
   * filter column; `compact` is the phone bar's button. The dialog behind them is the same one.
   */
  readonly variant?: 'default' | 'thumbnail' | 'compact';
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
      <div
        className={
          variant === 'thumbnail' ? 'grid gap-2' : 'flex flex-wrap items-center gap-2'
        }
      >
        {variant === 'thumbnail' ? (
          <MapThumbnail
            stays={stays}
            theme={theme}
            label={t('mapShow')}
            onOpen={(button) => {
              opener.current = button;
              setOpen(true);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={(event) => {
              opener.current = event.currentTarget;
              setOpen(true);
            }}
            className={
              variant === 'compact'
                ? 'inline-flex min-h-10 shrink-0 cursor-pointer items-center gap-2 rounded-lg border border-line bg-card px-3 text-14 font-bold text-text transition-[transform,border-color] duration-150 ease-out hover:border-gold active:scale-[0.97] motion-reduce:transition-none'
                : 'inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-full border border-line bg-card px-4 text-13 font-bold text-text transition-colors hover:border-gold lg:min-h-0 lg:py-2'
            }
          >
            <MapGlyph />
            {variant === 'compact' ? t('results.mapButton') : t('mapShow')}
          </button>
        )}

        {/*
          The box, said out loud and removable. A filter the reader cannot see is a filter they
          cannot undo — and this one is set by dragging, so it is the easiest to acquire by
          accident and the hardest to notice afterwards.
        */}
        {bboxActive && variant !== 'compact' ? (
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
 * - **The licence notice is printed, not a control.** ODbL needs it visible on every map, and
 *   MapLibre's own attribution control is a button, which cannot sit inside this one.
 */
function MapThumbnail({
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
        /* Shown once the tiles are drawn, so the reader never watches an empty canvas fill in. */
        void instance.once('idle', () => {
          if (!cancelled) setReady(true);
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
      dispose?.();
    };
  }, [near, theme, stays]);

  return (
    <div
      ref={card}
      data-map-thumbnail
      className="relative h-32 w-full overflow-hidden rounded-card border border-line bg-band transition-[border-color,box-shadow] duration-200 ease-out hover:border-gold/60 hover:shadow-[var(--shadow-lift)]"
    >
      <OrnamentField id="ornament-map-thumbnail" className="text-gold-read opacity-25" />
      <div
        ref={canvas}
        aria-hidden
        data-ready={ready}
        className={`absolute inset-0 transition-opacity duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${ready ? 'opacity-100' : 'opacity-0'}`}
      />
      <button
        type="button"
        onClick={(event) => onOpen(event.currentTarget)}
        className="group absolute inset-0 grid cursor-pointer place-items-center rounded-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold"
      >
        <span className="inline-flex min-h-10 items-center gap-2 rounded-full bg-indigo px-4 text-14 font-bold text-bg shadow-[var(--shadow-lift)] transition-transform duration-150 ease-out group-active:scale-[0.97] motion-reduce:transition-none">
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
