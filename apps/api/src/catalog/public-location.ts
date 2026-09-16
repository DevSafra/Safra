/**
 * What a listing's location is allowed to say before a booking exists.
 *
 * Extracted when the property page grew a map (O-web-12). The rounding lived beside the
 * detail payload, and the map is a SECOND reader of the same coordinates — a map drawn
 * from the raw column while the payload printed a rounded one would publish the front
 * door through the picture and withhold it in the text, which is the withholding failing
 * silently in the direction nobody checks.
 *
 * One helper, both callers. See `PropertyDetailService.bySlug` and `PropertyMapService`.
 */

/**
 * Coordinate precision for PUBLIC display.
 *
 * The approved prototype states it explicitly: "الموقع الدقيق يظهر بعد تأكيد الحجز"
 * — the exact location appears only after the booking is confirmed. Three decimal
 * places is roughly 100 m, enough to show the right neighbourhood on a map without
 * publishing the front door of someone's home to anonymous visitors.
 */
export const PUBLIC_COORDINATE_DECIMALS = 3;

/**
 * The zoom the public map is drawn at.
 *
 * Tied to the rounding above rather than chosen for looks. At z14 one pixel is about
 * 7 m in Damascus, so the ~100 m the rounding discards is a dozen pixels — the marker
 * sits honestly inside the area it claims. Zooming in further would draw a confident
 * point on a coordinate that is deliberately imprecise, which is the same leak as
 * printing the address: it LOOKS exact, and a reader would believe it.
 */
export const PUBLIC_MAP_ZOOM = 14;

/**
 * Rounds a coordinate to roughly 100 m for public display.
 *
 * The blank check is not defensive tidying. `latitude` and `longitude` are nullable TEXT
 * columns, and `Number('')` is `0` — so an empty string used to round to `"0.000"` and
 * publish the listing at null island in the Gulf of Guinea. Nothing showed it while the
 * payload only carried two numbers nobody rendered; the map turned it into a card of the
 * Atlantic, which is how the test that found it came to be written.
 */
export function fuzzCoordinate(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  if (typeof value === 'string' && value.trim() === '') return null;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;

  return parsed.toFixed(PUBLIC_COORDINATE_DECIMALS);
}

/**
 * The radius, in metres, of the disc drawn over the listing.
 *
 * Larger than the ~100 m the rounding discards, and deliberately so: a circle drawn at
 * exactly the error bound reads as a measurement, and this is not one. 150 m says
 * "this neighbourhood" to a reader, which is the true statement.
 */
const AREA_RADIUS_METRES = 150;

/** How many points approximate the circle. 36 is smooth at every size we render. */
const AREA_POINTS = 36;

/**
 * The area disc, as a closed polygon MapTiler can draw into the image.
 *
 * Burned into the picture rather than laid over it in CSS, because the enlarged view
 * goes through `ImageSliderFrame`, which renders the image and has no slot for an
 * overlay — and a shared component used by three apps should not grow one for this.
 * An overlay would therefore have appeared on the card and vanished in the enlargement,
 * so pressing «اعرض على الخريطة» would lose the only thing it exists to show.
 *
 * Points are `lon,lat`, which is the order MapTiler reads by default.
 */
export function areaPolygon(latitude: number, longitude: number): string {
  const metresPerDegreeLat = 111_320;
  const dLat = AREA_RADIUS_METRES / metresPerDegreeLat;
  /*
    Longitude degrees shorten toward the poles, so the east-west radius has to be divided
    by cos(latitude) or the "circle" renders as an ellipse — visibly squashed by about
    17% at Damascus, and worse the further north a listing is.
  */
  const dLon = dLat / Math.cos((latitude * Math.PI) / 180);

  const points: string[] = [];
  for (let i = 0; i <= AREA_POINTS; i += 1) {
    const angle = (i / AREA_POINTS) * 2 * Math.PI;
    const lon = longitude + dLon * Math.cos(angle);
    const lat = latitude + dLat * Math.sin(angle);
    points.push(`${lon.toFixed(6)},${lat.toFixed(6)}`);
  }

  return points.join('|');
}
