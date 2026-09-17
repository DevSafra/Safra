import { describe, expect, it } from 'vitest';

import {
  areaCircle,
  AREA_RADIUS_METRES,
  PUBLIC_COORDINATE_DECIMALS,
  PUBLIC_MAP_MAX_ZOOM,
  PUBLIC_MAP_ZOOM,
} from './location.js';

const DAMASCUS = { lat: 33.513, lon: 36.277 };

const ring = (lat: number, lon: number) => {
  const first = areaCircle(lat, lon).geometry.coordinates[0];
  if (!first) throw new Error('areaCircle produced no ring');

  return first;
};

describe('areaCircle', () => {
  it('closes, so the fill has a boundary to be inside of', () => {
    const points = ring(DAMASCUS.lat, DAMASCUS.lon);

    expect(points.length).toBeGreaterThan(8);
    expect(points[0]).toEqual(points[points.length - 1]);
  });

  it('is centred on the listing', () => {
    const points = ring(DAMASCUS.lat, DAMASCUS.lon);
    const meanLon = points.reduce((sum, p) => sum + p[0], 0) / points.length;
    const meanLat = points.reduce((sum, p) => sum + p[1], 0) / points.length;

    expect(meanLon).toBeCloseTo(DAMASCUS.lon, 3);
    expect(meanLat).toBeCloseTo(DAMASCUS.lat, 3);
  });

  it('emits GeoJSON order — [lon, lat], not [lat, lon]', () => {
    /*
      Reversed, this still renders: a valid polygon, drawn in the Indian Ocean, and every
      test that only checked "36 points, closed" would stay green. Damascus is the useful
      fixture precisely because its two numbers are far apart.
    */
    const points = ring(DAMASCUS.lat, DAMASCUS.lon);

    for (const [lon, lat] of points) {
      expect(lon).toBeCloseTo(DAMASCUS.lon, 1);
      expect(lat).toBeCloseTo(DAMASCUS.lat, 1);
    }
  });

  it('draws a circle on the ground rather than an ellipse, by widening with latitude', () => {
    /*
      Dividing the east-west radius by cos(latitude) is easy to omit, and the result still
      renders — as a disc squashed by 17% in Damascus and by half in Oslo. Comparing two
      latitudes is what makes the omission visible; one alone looks plausible either way.
    */
    const spread = (lat: number) => {
      const points = ring(lat, 0);
      const lons = points.map((p) => p[0]);
      const lats = points.map((p) => p[1]);

      return {
        lon: Math.max(...lons) - Math.min(...lons),
        lat: Math.max(...lats) - Math.min(...lats),
      };
    };

    const equator = spread(0);
    const damascus = spread(33.513);
    const oslo = spread(59.91);

    // North-south never changes: a degree of latitude is a degree of latitude.
    expect(damascus.lat).toBeCloseTo(equator.lat, 9);
    expect(oslo.lat).toBeCloseTo(equator.lat, 9);

    // East-west must GROW in degrees to cover the same metres.
    expect(damascus.lon).toBeGreaterThan(equator.lon * 1.15);
    expect(oslo.lon).toBeGreaterThan(damascus.lon);
    expect(damascus.lon / equator.lon).toBeCloseTo(
      1 / Math.cos((33.513 * Math.PI) / 180),
      3,
    );
  });

  it('is WIDER than the rounding it stands for, so it never implies more precision than we have', () => {
    /*
      The disc must cover at least the cell the rounding leaves. At three decimals a
      latitude is pinned to ~111 m, so half-cell is ~56 m; a disc smaller than that would
      draw a confident circle INSIDE the real uncertainty, which is the exact inversion of
      what it is for.
    */
    const halfCellMetres = (10 ** -PUBLIC_COORDINATE_DECIMALS * 111_320) / 2;

    expect(AREA_RADIUS_METRES).toBeGreaterThan(halfCellMetres);
  });

  it('opens below the zoom it caps at, so the cap is reachable but not the default', () => {
    expect(PUBLIC_MAP_ZOOM).toBeLessThan(PUBLIC_MAP_MAX_ZOOM);
  });
});
