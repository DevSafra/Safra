'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import type { Map as MapLibreMap } from 'maplibre-gl';

import { PUBLIC_MAP_MAX_ZOOM } from '@safra/contracts';

import {
  BASEMAP,
  BBOX_PLACEHOLDER,
  basemapStyle,
  boundsOf,
  loadMapLibre,
} from '@/lib/basemap';
import type { MapStay } from '@/lib/search-cards';
import { MapStayCard } from '@/components/search/map-stay-card';
import { MapPriceMarkers, type NearbyStay } from './map-price-markers';

import 'maplibre-gl/dist/maplibre-gl.css';
import { SearchIcon } from '@/components/icons';
import { MapGlyph, MapThumbnail } from '@/components/map-thumbnail';

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
  hrefSuffix,
  mapFeedUrl,
  pageBbox,
  bboxActive,
  bboxUrlTemplate,
  urlWithoutBbox,
  filtersSlot = null,
  signInHref,
  variant = 'default',
}: {
  /** The page's own results: the opening view is fitted to them before the map's own arrive. */
  readonly stays: readonly NearbyStay[];
  readonly hrefPrefix: string;
  /** The reader's dates and party, appended to every pill's link. */
  readonly hrefSuffix: string;
  /**
   * The map's own feed for this search, WITHOUT a box: `/ar/api/search/map?…`. The map adds the
   * box it is showing each time it settles. Built by the server from the parsed view, so the
   * browser never assembles a query of its own.
   */
  readonly mapFeedUrl: string;
  /** The box the LIST is limited to, if any: the map opens on it. */
  readonly pageBbox: string | undefined;
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
  /** The sidebar's filters as one column, drawn beside the map on a wide screen. */
  readonly filtersSlot?: ReactNode;
  /** Where a signed-out reader is sent to save a stay from the map's list, built by the server. */
  readonly signInHref: string;
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
  const closer = useRef<HTMLButtonElement | null>(null);

  const [open, setOpen] = useState(false);
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [moved, setMoved] = useState(false);
  const [theme, setTheme] = useState<'light' | 'dark'>('light');

  /* What the map's own feed answered for the area on screen; null until it first answers. */
  const [feed, setFeed] = useState<{ stays: MapStay[]; capped: boolean } | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);

  /*
    The opening view is fitted to the page's results ONCE, when the map is made. Read through a ref
    so a filter changed from inside the map, which hands this component a new page of results,
    does not tear the map down and throw the reader's view away.
  */
  const openingStays = useRef(stays);
  openingStays.current = stays;
  const feedUrl = useRef(mapFeedUrl);
  feedUrl.current = mapFeedUrl;

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
    /* Into the dialog, so a keyboard reader is not left on a control the dialog now covers. */
    closer.current?.focus();

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previous;
    };
  }, [open, close]);

  /*
    The map's own stays for a box. The previous request is cancelled rather than raced: a reader
    who pans twice must see the second area, never whichever answer happened to land last.
  */
  const inflight = useRef<AbortController | null>(null);
  const load = useCallback(
    async (bbox: string | undefined): Promise<MapStay[] | null> => {
      inflight.current?.abort();
      const controller = new AbortController();
      inflight.current = controller;
      setLoading(true);

      try {
        const response = await fetch(
          bbox ? `${feedUrl.current}&bbox=${encodeURIComponent(bbox)}` : feedUrl.current,
          { signal: controller.signal, headers: { accept: 'application/json' } },
        );
        if (!response.ok) throw new Error(`map feed answered ${response.status}`);
        const body = (await response.json()) as { stays: MapStay[]; capped: boolean };
        if (controller.signal.aborted) return null;
        setFeed(body);
        setFailed(false);
        return body.stays;
      } catch {
        if (controller.signal.aborted) return null;
        setFailed(true);
        return null;
      } finally {
        if (inflight.current === controller) setLoading(false);
      }
    },
    [],
  );

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
          bounds: pageBbox ? boxBounds(pageBbox) : boundsOf(openingStays.current),
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
          Each settled move asks for the stays in the new area, after a pause: a drag fires many
          moves and one request per pause is what the reader is waiting for.
        */
        let pause: ReturnType<typeof setTimeout> | undefined;
        /*
          Only the READER's move offers «ابحث في هذه المنطقة»: a resize settles the camera too, and
          an offer to search an area nobody chose reads as «your results are wrong». Read from the
          reader's own input on the map, because MapLibre's wheel zoom reports no original event
          at any stage. Every settled view still refreshes the list: the list is whatever is on
          screen.
        */
        let byReader = false;
        const onInput = () => {
          byReader = true;
        };
        const surface = container.current;
        for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
          surface.addEventListener(type, onInput, { passive: true });
        }
        const onMove = () => {
          if (byReader) setMoved(true);
          byReader = false;
          clearTimeout(pause);
          pause = setTimeout(() => void load(boxOf(instance)), 300);
        };

        const onLoad = async () => {
          /*
            First the whole search (or the list's own box), then the view fitted to what came
            back: the page's twenty cards are a poor guess at where a city's stays are.
          */
          const first = await load(pageBbox);
          if (cancelled) return;
          if (!pageBbox && first && first.length > 0) {
            instance.fitBounds(boundsOf(first), {
              padding: 64,
              maxZoom: PUBLIC_MAP_MAX_ZOOM,
              animate: false,
            });
          }
          /*
            Armed only ONCE THE MAP HAS SETTLED, and that is the whole subtlety. `fitBounds` is
            itself a camera move, so `moveend` fires as the map opens — the offer to «search this
            area» appeared immediately, over the exact result set the reader already had, which
            reads as «your results are wrong». Anything after `idle` is the reader's doing.
          */
          void instance.once('idle', () => {
            if (cancelled) return;
            instance.on('moveend', onMove);
          });
        };
        void instance.once('load', () => void onLoad());

        setMap(instance);
        dispose = () => {
          clearTimeout(pause);
          resizer.disconnect();
          for (const type of ['pointerdown', 'wheel', 'keydown'] as const) {
            surface.removeEventListener(type, onInput);
          }
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
      inflight.current?.abort();
      setMap(null);
      setMoved(false);
      setFeed(null);
      dispose?.();
    };
  }, [open, theme, pageBbox, load]);

  /*
    A filter changed from inside the map navigates the page, which hands this component a new feed
    URL: the same area is asked again under the new filters, without moving the reader's view.
  */
  /*
    Keyed on the URL ALONE. It once ran whenever the map appeared too, and that request for the
    opening view's small box cancelled the first request for the whole search: the list showed the
    two stays near the page's results instead of all of them, and the view was never fitted.
  */
  const askedFor = useRef(mapFeedUrl);
  useEffect(() => {
    if (askedFor.current === mapFeedUrl) return;
    askedFor.current = mapFeedUrl;
    if (map && open) void load(boxOf(map));
  }, [mapFeedUrl, map, open, load]);

  function searchHere(): void {
    if (!map) return;

    router.push(
      bboxUrlTemplate.replace(BBOX_PLACEHOLDER, encodeURIComponent(boxOf(map))),
    );
    setOpen(false);
  }

  /*
    One pill per published POINT, in the search's order, so the first stay at a point speaks for
    it and the count says how many share it. Before the feed answers, the page's own results.
  */
  const { pins, leaderOf } = useMemo(
    () => pinsFor(feed?.stays ?? null, stays),
    [feed, stays],
  );
  const listed = feed?.stays ?? [];

  if (!BASEMAP) return null;

  const wide = filtersSlot !== null;

  const dialog = open ? (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('mapTitle')}
      /* `z-[70]` is the slider's layer: this has to cover the sticky site header. */
      className={`fixed inset-0 z-[70] grid grid-rows-[minmax(0,1fr)] bg-bg lg:grid-cols-[23rem_minmax(0,1fr)] ${
        wide ? 'xl:grid-cols-[18rem_23rem_minmax(0,1fr)]' : ''
      }`}
    >
      {/* Reading order on an RTL screen: filters, the list, then the map, as booking.com sets it. */}
      {wide ? (
        <aside
          aria-label={t('mapFiltersLabel')}
          className="hidden overflow-y-auto overscroll-contain border-e border-line p-3 xl:block"
        >
          {filtersSlot}
        </aside>
      ) : null}

      <section
        aria-label={t('mapListLabel')}
        aria-busy={loading}
        className="hidden min-h-0 flex-col border-e border-line lg:flex"
      >
        <div className="border-b border-line px-4 py-3">
          <p className="text-16 font-bold text-text" aria-live="polite">
            {feed ? t('mapInView', { count: listed.length }) : t('mapLoading')}
          </p>
          {feed?.capped ? (
            <p className="mt-1 text-13 text-muted">{t('mapCapped')}</p>
          ) : null}
          {failed ? (
            <p role="alert" className="mt-1 text-13 text-bad">
              {t('mapFailed')}
            </p>
          ) : null}
        </div>
        <ul
          className={`grid flex-1 content-start gap-2.5 overflow-y-auto overscroll-contain p-3 transition-opacity duration-200 ease-out ${
            loading && feed ? 'opacity-60' : ''
          }`}
        >
          {listed.map((stay) => (
            <li key={stay.key}>
              <MapStayCard
                stay={stay}
                lit={
                  highlight !== null &&
                  leaderOf.get(stay.slug) === leaderOf.get(highlight)
                }
                onHighlight={setHighlight}
                newTabLabel={t('opensInNewTab')}
                signInHref={signInHref}
              />
            </li>
          ))}
        </ul>
      </section>

      <div className="relative min-h-0 min-w-0">
        {/*
          `h-full w-full`, NOT `absolute inset-0`. MapLibre's own stylesheet declares
          `.maplibregl-map { position: relative }`, which beats an `absolute` of equal
          specificity by source order — the element then collapses and MapLibre falls back to
          a 300px canvas with the backdrop showing through.
        */}
        <div ref={container} className="h-full w-full" />

        <MapPriceMarkers
          map={map}
          stays={pins}
          hrefPrefix={hrefPrefix}
          hrefSuffix={hrefSuffix}
          declutter
          highlight={highlight === null ? null : (leaderOf.get(highlight) ?? highlight)}
          onHighlight={setHighlight}
          newTab={{ label: t('opensInNewTab') }}
        />

        <button
          ref={closer}
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
            className="btn-gold absolute start-1/2 top-16 z-20 inline-flex min-h-10 -translate-x-1/2 cursor-pointer items-center gap-2 rounded-full px-5 text-14 font-bold whitespace-nowrap rtl:translate-x-1/2 lg:top-4"
          >
            <SearchIcon />
            {t('mapSearchArea')}
          </button>
        ) : null}

        {/*
          The phone has no list column, so the count rides on the map: in the top row opposite the
          close control, where it covers sky rather than the pins a reader came to see.
        */}
        {feed ? (
          <p
            aria-live="polite"
            className="absolute start-4 top-4 z-20 inline-flex min-h-10 items-center rounded-full bg-card px-4 text-13 font-semibold text-text shadow-[var(--shadow-lift)] lg:hidden"
          >
            {listed.length === 0
              ? t('mapEmpty')
              : t('mapInView', { count: listed.length })}
          </p>
        ) : null}

        {feed && listed.length === 0 ? (
          <p className="absolute start-1/2 bottom-8 z-20 hidden -translate-x-1/2 rounded-full bg-card px-4 py-2 text-13 text-muted shadow-[var(--shadow-lift)] rtl:translate-x-1/2 lg:block">
            {t('mapEmpty')}
          </p>
        ) : null}
      </div>
    </div>
  ) : null;

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

      {/*
        Into <body>: the phone's opener sits in a sticky bar with a backdrop filter, and a filter
        makes its element the containing block for `position: fixed`, so the full-screen map would
        have been drawn inside a 56px bar.
      */}
      {dialog ? createPortal(dialog, document.body) : null}
    </>
  );
}

/** The map's current view as the API's `south,west,north,east`, clamped to the valid range. */
function boxOf(map: MapLibreMap): string {
  const bounds = map.getBounds();
  const clamp = (value: number, limit: number) =>
    Math.max(-limit, Math.min(limit, value));

  return [
    clamp(bounds.getSouth(), 90).toFixed(5),
    clamp(bounds.getWest(), 180).toFixed(5),
    clamp(bounds.getNorth(), 90).toFixed(5),
    clamp(bounds.getEast(), 180).toFixed(5),
  ].join(',');
}

/** A `south,west,north,east` box as MapLibre's `[[west, south], [east, north]]`. */
function boxBounds(bbox: string): [[number, number], [number, number]] {
  const [south = 0, west = 0, north = 0, east = 0] = bbox.split(',').map(Number);
  return [
    [west, south],
    [east, north],
  ];
}

/**
 * The pills for a set of stays: one per published point, and for every stay the slug of the pill
 * that stands for it, so a card and its pill light together even when the pill is a neighbour's.
 */
function pinsFor(
  fromFeed: readonly MapStay[] | null,
  fromPage: readonly NearbyStay[],
): { pins: NearbyStay[]; leaderOf: Map<string, string> } {
  if (!fromFeed) {
    return {
      pins: [...fromPage],
      leaderOf: new Map(fromPage.map((one) => [one.slug, one.slug])),
    };
  }

  const atPoint = new Map<string, { pin: NearbyStay; count: number }>();
  const leaderOf = new Map<string, string>();

  for (const stay of fromFeed) {
    const point = `${stay.latitude},${stay.longitude}`;
    const held = atPoint.get(point);
    if (held) {
      held.count += 1;
      leaderOf.set(stay.slug, held.pin.slug);
    } else {
      atPoint.set(point, {
        pin: {
          slug: stay.slug,
          name: stay.name,
          latitude: stay.latitude,
          longitude: stay.longitude,
          price: stay.nightly,
          staysHere: 1,
        },
        count: 1,
      });
      leaderOf.set(stay.slug, stay.slug);
    }
  }

  return {
    pins: [...atPoint.values()].map(({ pin, count }) => ({ ...pin, staysHere: count })),
    leaderOf,
  };
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
