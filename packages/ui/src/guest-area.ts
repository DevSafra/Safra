import { PUBLIC_COORDINATE_DECIMALS } from '@safra/contracts';

/**
 * What a guest actually sees, expressed as a circle.
 *
 * The public pair is `round(latitude, PUBLIC_COORDINATE_DECIMALS)`, so the published point sits on
 * a grid whose cell is one unit of the last decimal across. The true point is somewhere inside the
 * cell centred on it, and the furthest it can be is the cell's half-diagonal.
 *
 * At three decimals and Damascus's latitude that is about 72 m — 0.0005° of latitude is 55.7 m,
 * 0.0005° of longitude is 46 m, and the diagonal of those two is what this returns. Derived from
 * the constant rather than written as a number, so a change to the rounding moves this circle with
 * it instead of leaving a picture that quietly stops being true.
 */
export const METRES_PER_DEGREE = 111_320;

export function guestRadiusMetres(latitude: number): number {
  const half = 0.5 * 10 ** -PUBLIC_COORDINATE_DECIMALS;
  const northSouth = half * METRES_PER_DEGREE;
  const eastWest = half * METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);

  return Math.hypot(northSouth, eastWest);
}

/**
 * The same rounding Postgres does, not the same rounding `toFixed` does.
 *
 * `round(numeric)` in Postgres is half AWAY FROM ZERO; JavaScript's `Math.round` is half toward
 * +∞, so the two disagree on every exact half below zero — `Math.round(-0.5)` is `-0`, Postgres
 * gives `-1`. SAFRA has southern-hemisphere nothing today and this is a picture rather than a
 * payload, but a circle drawn one cell away from where the guest is actually shown would be a lie
 * of exactly the kind this control exists to disprove, and matching costs one `Math.sign`.
 */
export function roundLikePostgres(value: number, decimals: number): number {
  const factor = 10 ** decimals;

  return (Math.sign(value) * Math.round(Math.abs(value) * factor)) / factor;
}

/** A closed ring approximating a circle of `metres` around a point, in GeoJSON order. */
export function ringAround(
  latitude: number,
  longitude: number,
  metres: number,
): [number, number][] {
  const points = 64;
  const dLat = metres / METRES_PER_DEGREE;
  const dLon = metres / (METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180));
  const ring: [number, number][] = [];

  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * 2 * Math.PI;

    ring.push([longitude + dLon * Math.cos(angle), latitude + dLat * Math.sin(angle)]);
  }

  return ring;
}

/** The circle as a source payload, or an empty collection while the listing is unplaced. */
export function guestAreaData(latitude: string, longitude: string): GuestArea {
  const lat = Number(latitude);
  const lon = Number(longitude);

  if (
    !latitude.trim() ||
    !longitude.trim() ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lon)
  ) {
    return { type: 'FeatureCollection', features: [] };
  }

  const shownLat = roundLikePostgres(lat, PUBLIC_COORDINATE_DECIMALS);
  const shownLon = roundLikePostgres(lon, PUBLIC_COORDINATE_DECIMALS);

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'Polygon',
          coordinates: [ringAround(shownLat, shownLon, guestRadiusMetres(shownLat))],
        },
      },
    ],
  };
}

/**
 * The circle's payload, declared structurally rather than imported.
 *
 * `@types/geojson` is in the tree as a transitive dependency of `maplibre-gl`, and depending on it
 * here to name two shapes would be a direct dependency taken for four lines of type. MapLibre's
 * `addSource` accepts anything structurally assignable to a feature collection, which this is.
 */
export type GuestArea = {
  readonly type: 'FeatureCollection';
  readonly features: readonly {
    readonly type: 'Feature';
    readonly properties: Record<string, never>;
    readonly geometry: {
      readonly type: 'Polygon';
      readonly coordinates: readonly (readonly [number, number])[][];
    };
  }[];
};
