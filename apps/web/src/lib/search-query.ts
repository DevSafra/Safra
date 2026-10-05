import {
  DEFAULT_SEARCH_RADIUS_KM,
  MAX_SEARCH_RADIUS_KM,
  TRIP_ATTRIBUTES,
} from '@safra/contracts';

import type { SearchParams } from '@/lib/api';
import { addDays, todayInDamascus } from '@/lib/settings';

/**
 * What a search URL means, decided in ONE place (Bashar, 2026-10-01).
 *
 * The results page parses its query string and the scroll-loading route parses the same one for
 * the next batch. Two parsers would drift, and the symptom of drift here is the worst kind: the
 * second batch of an infinite list quietly answering a different question from the first — a
 * «٥ نجوم» search whose cards turn into three-star hotels once the reader scrolls.
 *
 * ## Parsed and clamped, never forwarded
 *
 * Every value is validated by shape and bounded here, and the URLs this page writes are rebuilt
 * from the PARSED values rather than the request. A parameter nobody here understands is dropped,
 * so a crafted `?evil=…` cannot be reflected into a link on our own page, and an out-of-range
 * number becomes a sensible default rather than a 400 that replaces somebody's search with an
 * error. The API validates again; this is the half that keeps the page standing.
 */
export type RawQuery = Record<string, string | string[] | undefined>;

export const SORTS = [
  'recommended',
  'price_asc',
  'price_desc',
  'rating_desc',
  'distance_asc',
] as const;
export type Sort = (typeof SORTS)[number];

/** The floors the sidebar offers, on SAFRA's 1-5 guest score. */
export const RATING_FLOORS = [4.5, 4, 3.5, 3] as const;
export const BATHROOM_FLOORS = [1, 2, 3, 4] as const;
/** Kilometres from the city centre. */
export const CENTRE_CEILINGS = [1, 3, 5] as const;
export const BED_TYPES = ['single', 'double'] as const;
export const RADII_KM = [1, 2, 5, 10, 25, 50] as const;

/** How many results one batch holds. Under the contract's 60 ceiling. */
export const PAGE_SIZE = 20;

export interface ParsedSearch {
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  infants: number;
  bedrooms: number;
  citySlug: string | undefined;
  propertyTypeCode: string | undefined;
  attributes: string[];
  amenityCodes: string[];
  starRatings: number[];
  minPrice: number | undefined;
  maxPrice: number | undefined;
  freeCancellationOnly: boolean;
  minRating: number | undefined;
  minBathrooms: number;
  bedType: 'single' | 'double' | undefined;
  maxCentreKm: number | undefined;
  nearLandmark: string | undefined;
  nearKind: string | undefined;
  withinKm: number;
  bbox: string | undefined;
  sort: Sort;
}

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function many(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

/** A whole number inside its bounds, or the fallback — never NaN, never negative. */
function whole(raw: string | undefined, fallback: number, max: number): number {
  const value = Number(raw);
  if (raw === undefined || raw.trim() === '' || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 0), max);
}

/**
 * A price bound, or nothing at all. Absence is meaningful — no floor — and coercing an empty box
 * to 0 would turn it into a filter.
 */
function money(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === '') return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) return undefined;
  return Math.min(Math.trunc(value), 1_000_000);
}

/** One of an allowed set, or nothing — a crafted value cannot become a filter nobody can see. */
function oneOf<T extends number | string>(
  raw: string | undefined,
  allowed: readonly T[],
): T | undefined {
  if (raw === undefined) return undefined;
  return allowed.find((value) => String(value) === raw);
}

/**
 * The amenity codes a search may filter on: every filterable amenity, whatever its catalogue count.
 *
 * ONE definition for the results page and the two routes behind it (the next batch and the full
 * map), because they drifted (audit 2026-10-04): the routes still kept only amenities whose
 * \`propertyCount\` was above zero, and that count covers room-level links only. A pool declared on
 * the BUILDING was therefore honoured on the first twenty results and silently dropped from every
 * batch loaded by scrolling and from the map, which showed stays without one.
 */
export function allowedAmenityCodes(amenities: readonly { code: string }[]): Set<string> {
  return new Set(amenities.map((one) => one.code));
}

/**
 * A date, or nothing. `??` alone could not tell an EMPTY string from an absent one, and `?checkIn=`
 * once put '' into every date path: a 500 on the server and a blank «Application error» in the
 * browser. Validated by shape, which is an allow-list; the API stays the authority on whether the
 * date is bookable.
 */
function asDate(value: string | undefined): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined;
}

const BBOX = /^-?\d{1,3}(\.\d{1,8})?(,-?\d{1,3}(\.\d{1,8})?){3}$/;

export function parseSearch(
  query: RawQuery,
  /**
   * The amenity codes that can actually return something — the same set the panel renders. A
   * bookmarked `?amenityCodes=wifi` for an amenity nothing carries would otherwise empty the page
   * while no checkbox on screen explained why.
   */
  offeredAmenities: ReadonlySet<string>,
): ParsedSearch {
  const checkIn = asDate(first(query['checkIn'])) ?? todayInDamascus();
  const checkOut = asDate(first(query['checkOut'])) ?? addDays(checkIn, 2);
  const adultsRaw = Number(first(query['adults']) ?? 2);
  const adults =
    Number.isFinite(adultsRaw) && adultsRaw > 0 ? Math.min(Math.trunc(adultsRaw), 30) : 2;
  const citySlug = first(query['citySlug']) || undefined;

  /* A landmark or kind belongs to a city, so one named without a city is dropped. */
  const nearLandmark = citySlug ? first(query['nearLandmark']) || undefined : undefined;
  /*
    One near criterion: a landmark, or failing that a type of place (audit 2026-10-04). The API takes
    one or the other, so a URL carrying both reads as the landmark and the panel shows the type as
    «any», rather than showing a choice the search is ignoring.
  */
  const nearKind =
    citySlug && !nearLandmark ? first(query['nearKind']) || undefined : undefined;
  const withinKm = Math.min(
    MAX_SEARCH_RADIUS_KM,
    Math.max(0.5, Number(first(query['withinKm'])) || DEFAULT_SEARCH_RADIUS_KM),
  );

  const bboxParam = first(query['bbox']);
  const bbox = bboxParam && BBOX.test(bboxParam) ? bboxParam : undefined;

  const requested = oneOf(first(query['sort']), SORTS) ?? 'recommended';
  /* «Nearest first» with nothing to be near is a stale link, not an error page. */
  const sort: Sort =
    requested === 'distance_asc' && !nearLandmark ? 'recommended' : requested;

  const minPrice = money(first(query['minPrice']));
  const maxPrice = money(first(query['maxPrice']));
  /* An inverted range is refused by the schema, so it is dropped here rather than sent. */
  const rangeOk =
    minPrice === undefined || maxPrice === undefined || minPrice <= maxPrice;

  return {
    checkIn,
    checkOut,
    adults,
    children: whole(first(query['children']), 0, 20),
    infants: whole(first(query['infants']), 0, 10),
    /* A requirement that floors at ONE (Bashar, 2026-09-03): «غرفة» rather than a zero. */
    bedrooms: Math.max(1, whole(first(query['bedrooms']), 1, 10)),
    citySlug,
    propertyTypeCode: first(query['propertyTypeCode']) || undefined,
    attributes: [
      ...new Set(
        many(query['attributes']).filter((code) =>
          (TRIP_ATTRIBUTES as readonly string[]).includes(code),
        ),
      ),
    ],
    amenityCodes: [
      ...new Set(
        many(query['amenityCodes']).filter((code) => offeredAmenities.has(code)),
      ),
    ],
    starRatings: [
      ...new Set(
        many(query['starRatings'])
          .map(Number)
          .filter((value) => Number.isInteger(value) && value >= 1 && value <= 5),
      ),
    ].sort((a, b) => a - b),
    minPrice: rangeOk ? minPrice : undefined,
    maxPrice: rangeOk ? maxPrice : undefined,
    freeCancellationOnly: first(query['freeCancellationOnly']) === 'true',
    minRating: oneOf(first(query['minRating']), RATING_FLOORS),
    minBathrooms: oneOf(first(query['minBathrooms']), BATHROOM_FLOORS) ?? 0,
    bedType: oneOf(first(query['bedType']), BED_TYPES),
    /* Only inside a city: «near the centre» of a search spanning three countries means nothing. */
    maxCentreKm: citySlug
      ? oneOf(first(query['maxCentreKm']), CENTRE_CEILINGS)
      : undefined,
    nearLandmark,
    nearKind,
    withinKm,
    bbox,
    sort,
  };
}

/** The API's parameters for one batch. */
export function toSearchParams(
  parsed: ParsedSearch,
  page: { limit?: number; cursor?: string | undefined } = {},
): SearchParams {
  return {
    checkIn: parsed.checkIn,
    checkOut: parsed.checkOut,
    adults: parsed.adults,
    children: parsed.children,
    infants: parsed.infants,
    bedrooms: parsed.bedrooms,
    citySlug: parsed.citySlug,
    propertyTypeCode: parsed.propertyTypeCode,
    attributes: parsed.attributes,
    amenityCodes: parsed.amenityCodes,
    starRatings: parsed.starRatings,
    minPrice: parsed.minPrice,
    maxPrice: parsed.maxPrice,
    /* Sent only when on: an absent flag cannot be misread, whatever the API's parser does with words. */
    freeCancellationOnly: parsed.freeCancellationOnly || undefined,
    minRating: parsed.minRating,
    minBathrooms: parsed.minBathrooms > 0 ? parsed.minBathrooms : undefined,
    bedType: parsed.bedType,
    maxCentreKm: parsed.maxCentreKm,
    nearLandmark: parsed.nearLandmark,
    nearKind: parsed.nearLandmark ? undefined : parsed.nearKind,
    withinKm: parsed.withinKm,
    bbox: parsed.bbox,
    sort: parsed.sort,
    limit: page.limit ?? PAGE_SIZE,
    cursor: page.cursor,
  };
}

/**
 * The page a view lives on, and its query (2026-10-02).
 *
 * `/search` carries the city in the query. A city's own page, `/city/damascus`, carries it in the
 * PATH, so its links drop `citySlug`: the path is the one thing that decides the city there, and a
 * `citySlug` in the query beside it would be a second answer that could disagree.
 */
export interface ResultsPage {
  readonly basePath: string;
  readonly pinnedCity: boolean;
}

export function pageHref(
  page: ResultsPage,
  parsed: ParsedSearch,
  overrides: Parameters<typeof toQueryString>[1] = {},
): string {
  const query = toQueryString(
    parsed,
    page.pinnedCity ? { ...overrides, citySlug: null } : overrides,
  );
  return query ? `${page.basePath}?${query}` : page.basePath;
}

/**
 * The query string for a view, rebuilt from parsed values. The allow-list IS this function.
 *
 * `overrides` changes one thing and keeps the rest; `null` clears a field. Default values are left
 * out, so a shared link stays short and a cleared filter disappears from the URL entirely.
 */
export function toQueryString(
  parsed: ParsedSearch,
  overrides: Partial<{ [K in keyof ParsedSearch]: ParsedSearch[K] | null }> = {},
): string {
  const view: ParsedSearch = { ...parsed };

  for (const [key, value] of Object.entries(overrides)) {
    (view as unknown as Record<string, unknown>)[key] =
      value === null ? undefined : value;
  }

  const next = new URLSearchParams({
    checkIn: view.checkIn,
    checkOut: view.checkOut,
    adults: String(view.adults),
    children: String(view.children ?? 0),
    infants: String(view.infants ?? 0),
  });

  if ((view.bedrooms ?? 1) > 1) next.set('bedrooms', String(view.bedrooms));
  if (view.citySlug) next.set('citySlug', view.citySlug);
  if (view.sort && view.sort !== 'recommended') next.set('sort', view.sort);
  if (view.propertyTypeCode) next.set('propertyTypeCode', view.propertyTypeCode);
  for (const code of view.attributes ?? []) next.append('attributes', code);
  for (const code of view.amenityCodes ?? []) next.append('amenityCodes', code);
  for (const value of view.starRatings ?? []) next.append('starRatings', String(value));
  if (view.minPrice !== undefined) next.set('minPrice', String(view.minPrice));
  if (view.maxPrice !== undefined) next.set('maxPrice', String(view.maxPrice));
  if (view.freeCancellationOnly) next.set('freeCancellationOnly', 'true');
  if (view.minRating !== undefined) next.set('minRating', String(view.minRating));
  if ((view.minBathrooms ?? 0) > 0) next.set('minBathrooms', String(view.minBathrooms));
  if (view.bedType) next.set('bedType', view.bedType);
  if (view.maxCentreKm !== undefined && view.citySlug)
    next.set('maxCentreKm', String(view.maxCentreKm));
  /* The radius rides with a landmark, because one without it silently widens to the default. */
  if (view.nearLandmark) {
    next.set('nearLandmark', view.nearLandmark);
    next.set('withinKm', String(view.withinKm));
  } else if (view.nearKind) {
    next.set('nearKind', view.nearKind);
    next.set('withinKm', String(view.withinKm));
  }
  if (view.bbox) next.set('bbox', view.bbox);

  return next.toString();
}

/**
 * How many sidebar filters are in use — for «امسح الكل (٣)» and the mobile «تصفية» badge. The
 * search itself (dates, party, city, bedrooms) is not a filter and is not counted.
 */
export function activeFilterCount(parsed: ParsedSearch): number {
  return (
    (parsed.propertyTypeCode ? 1 : 0) +
    parsed.attributes.length +
    parsed.amenityCodes.length +
    parsed.starRatings.length +
    (parsed.minPrice !== undefined || parsed.maxPrice !== undefined ? 1 : 0) +
    (parsed.freeCancellationOnly ? 1 : 0) +
    (parsed.minRating !== undefined ? 1 : 0) +
    (parsed.minBathrooms > 0 ? 1 : 0) +
    (parsed.bedType ? 1 : 0) +
    (parsed.maxCentreKm !== undefined ? 1 : 0) +
    (parsed.nearLandmark || parsed.nearKind ? 1 : 0)
  );
}

/** Everything a filter change keeps: the search, never the filters. */
export function clearedFilters(
  parsed: ParsedSearch,
  /** What the page itself fixes, kept out of the query; see `pageHref`. */
  page?: ResultsPage,
): string {
  return toQueryString(parsed, {
    ...(page?.pinnedCity ? { citySlug: null } : {}),
    propertyTypeCode: null,
    attributes: [],
    amenityCodes: [],
    starRatings: [],
    minPrice: null,
    maxPrice: null,
    freeCancellationOnly: false,
    minRating: null,
    minBathrooms: 0,
    bedType: null,
    maxCentreKm: null,
    nearLandmark: null,
    nearKind: null,
  });
}
