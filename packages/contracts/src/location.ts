/**
 * What a listing's location is allowed to say before a booking exists.
 *
 * Shared because two sides now read the same promise: the API rounds the coordinates it
 * publishes, and the customer app draws the area they describe. A map drawn from one
 * radius beside a payload rounded to another would claim a precision nobody decided on,
 * and the drift would be invisible — both halves would look right on their own.
 *
 * The promise itself is a sentence on the page: «الموقع الدقيق يظهر بعد تأكيد الحجز».
 */

/**
 * Coordinate precision for PUBLIC display.
 *
 * Three decimal places is roughly 100 m — enough to show the right neighbourhood without
 * publishing the front door of somebody's home to anonymous visitors.
 *
 * This is the ONLY thing protecting the exact location, and it protects it by never
 * sending it. That matters for the map: an interactive map cannot leak what the browser
 * was never given, so panning and zooming reveal nothing beyond this rounding. The zoom
 * cap below is about not MISLEADING a reader, not about keeping a secret.
 */
export const PUBLIC_COORDINATE_DECIMALS = 3;

/**
 * Where the map opens.
 *
 * 15, not 14, and the reason is legibility rather than closeness: the basemap's
 * `roads_labels_minor` layer starts at zoom 15, so a map opened at 14 draws streets,
 * parks and water with NOT ONE NAME on them. It looked like a rendering fault and was
 * one zoom level away from being a map somebody could orient themselves on.
 *
 * Still nowhere near the building. The disc below is 150 m, which at this zoom is a
 * conspicuous blob rather than a point — it reads as an area, which is what it is.
 */
export const PUBLIC_MAP_ZOOM = 15;

/**
 * How far in a reader may go.
 *
 * Not a security boundary — the rounded pair is in the payload and can be typed into any
 * map on earth. It is an honesty boundary. At z19 a 150 m disc sits over a handful of
 * roofs and invites «it must be one of those», which is a confidence the data does not
 * support. Stopping at 16 keeps the picture as vague as the number behind it.
 */
export const PUBLIC_MAP_MAX_ZOOM = 16;

/**
 * The radius of the disc drawn over the listing.
 *
 * Larger than the ~100 m the rounding discards, deliberately: a circle drawn at exactly
 * the error bound reads as a measurement, and this is not one. 150 m says "this
 * neighbourhood", which is the true statement.
 */
export const AREA_RADIUS_METRES = 150;

/** How many points approximate the circle. 36 is smooth at every size we draw. */
const AREA_POINTS = 36;

/** A GeoJSON polygon approximating the area circle, for a map layer to fill. */
export interface AreaCircle {
  readonly type: 'Feature';
  readonly geometry: {
    readonly type: 'Polygon';
    /** One closed ring of `[lon, lat]` pairs — GeoJSON's order, not `lat,lon`. */
    readonly coordinates: readonly (readonly [number, number])[][];
  };
  readonly properties: Record<string, never>;
}

/**
 * The area disc as GeoJSON, centred on an already-rounded pair.
 *
 * Callers must pass the PUBLIC coordinates. Handing this the raw column would draw an
 * honest-looking circle around the exact building, which is the one thing the rounding
 * exists to prevent — and it would look identical.
 */
export function areaCircle(latitude: number, longitude: number): AreaCircle {
  const metresPerDegreeLat = 111_320;
  const dLat = AREA_RADIUS_METRES / metresPerDegreeLat;
  /*
    Longitude degrees shorten toward the poles, so the east-west radius has to be divided
    by cos(latitude) or the "circle" renders as an ellipse — visibly squashed by about
    17% at Damascus, and worse the further north a listing is.
  */
  const dLon = dLat / Math.cos((latitude * Math.PI) / 180);

  const ring: [number, number][] = [];
  for (let i = 0; i <= AREA_POINTS; i += 1) {
    const angle = (i / AREA_POINTS) * 2 * Math.PI;
    ring.push([longitude + dLon * Math.cos(angle), latitude + dLat * Math.sin(angle)]);
  }

  return {
    type: 'Feature',
    geometry: { type: 'Polygon', coordinates: [ring] },
    properties: {},
  };
}
