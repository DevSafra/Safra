import { describe, expect, it } from 'vitest';

import { PUBLIC_COORDINATE_DECIMALS, distanceMetres } from '@safra/contracts';

import {
  METRES_PER_DEGREE,
  guestAreaData,
  guestRadiusMetres,
  ringAround,
  roundLikePostgres,
} from './guest-area.js';

/**
 * The circle a partner is shown is a CLAIM, and these hold it to it.
 *
 * The picker draws it beside the sentence «this is all a guest ever sees». If the shape were
 * decorative — a fixed radius, a circle around the true point, a rounding that disagreed with the
 * database — then the control would be reassuring somebody with a picture that is not true, which
 * is worse than not reassuring them at all.
 *
 * So the property under test is not «it draws a circle». It is: **the real position is always
 * inside the circle, and the circle is centred where the guest is actually shown.**
 */
describe('the guest area', () => {
  describe('rounding', () => {
    /*
      Postgres `round(numeric)` is half AWAY FROM ZERO. JavaScript's `Math.round` is half toward
      +∞, so the two agree everywhere except exact halves below zero — and `toFixed` has its own
      binary-representation quirks on top. The picker must agree with the generated column, so
      this pins the rule rather than the implementation.
    */
    it.each([
      [33.5125, 33.513],
      [33.5124, 33.512],
      [36.29949, 36.299],
      [0, 0],
    ])('rounds %s to %s the way the database does', (input, expected) => {
      expect(roundLikePostgres(input, PUBLIC_COORDINATE_DECIMALS)).toBeCloseTo(
        expected,
        9,
      );
    });

    it('rounds a negative half away from zero, where Math.round does not', () => {
      /* `Math.round(-0.5)` is -0; Postgres gives -1. The southern hemisphere is the reason. */
      expect(roundLikePostgres(-0.0005, PUBLIC_COORDINATE_DECIMALS)).toBeCloseTo(
        -0.001,
        9,
      );
      expect(roundLikePostgres(-33.5125, PUBLIC_COORDINATE_DECIMALS)).toBeCloseTo(
        -33.513,
        9,
      );
    });
  });

  describe('the radius', () => {
    it('is the half-diagonal of one rounding cell, not a round number somebody liked', () => {
      const half = 0.5 * 10 ** -PUBLIC_COORDINATE_DECIMALS;
      const northSouth = half * METRES_PER_DEGREE;
      const eastWest = half * METRES_PER_DEGREE * Math.cos((33.5 * Math.PI) / 180);

      expect(guestRadiusMetres(33.5)).toBeCloseTo(Math.hypot(northSouth, eastWest), 6);
    });

    it('narrows toward the pole, because a degree of longitude does', () => {
      expect(guestRadiusMetres(60)).toBeLessThan(guestRadiusMetres(0));
    });

    /**
     * The claim, stated as a property rather than a number.
     *
     * Wherever inside a cell the true point sits, the distance from the published point to it is
     * at most the radius drawn. Walked over the corners and the edges of the cell, which is where
     * the bound is tight — a test using only the centre would pass against any radius above zero.
     */
    it('always contains the true position, wherever in the cell it falls', () => {
      const step = 10 ** -PUBLIC_COORDINATE_DECIMALS;
      const shownLat = 33.512;
      const shownLon = 36.299;
      const radius = guestRadiusMetres(shownLat);

      for (const dLat of [-0.5, -0.25, 0, 0.25, 0.5]) {
        for (const dLon of [-0.5, -0.25, 0, 0.25, 0.5]) {
          const trueLat = shownLat + dLat * step;
          const trueLon = shownLon + dLon * step;
          const away = distanceMetres(shownLat, shownLon, trueLat, trueLon);

          expect(
            away,
            `a true point at ${dLat}/${dLon} of a cell is ${away.toFixed(1)} m from the published one, outside a ${radius.toFixed(1)} m circle`,
          ).toBeLessThanOrEqual(radius + 0.5);
        }
      }
    });
  });

  describe('the ring', () => {
    it('closes, so the polygon is valid', () => {
      const ring = ringAround(33.5, 36.3, 72);

      expect(ring[0]).toEqual(ring[ring.length - 1]);
    });

    it('sits the drawn radius away from its centre, in every direction', () => {
      const radius = 72;
      const ring = ringAround(33.5, 36.3, radius);

      for (const [lon, lat] of ring) {
        expect(distanceMetres(33.5, 36.3, lat, lon)).toBeCloseTo(radius, 0);
      }
    });
  });

  describe('the payload', () => {
    it('is centred on the ROUNDED point, never the one the partner typed', () => {
      /* 33.512700 rounds to 33.513 — a circle drawn at 33.5127 would be the wrong claim. */
      const data = guestAreaData('33.512700', '36.299400');
      const ring = data.features[0]?.geometry.coordinates[0];

      expect(ring).toBeDefined();

      const lons = ring!.map(([lon]) => lon);
      const lats = ring!.map(([, lat]) => lat);
      const centreLon = (Math.min(...lons) + Math.max(...lons)) / 2;
      const centreLat = (Math.min(...lats) + Math.max(...lats)) / 2;

      expect(centreLat).toBeCloseTo(33.513, 6);
      expect(centreLon).toBeCloseTo(36.299, 6);
    });

    /*
      An unplaced listing draws nothing. An empty collection rather than a circle at 0,0 — which
      is in the Gulf of Guinea, and is the shape of every coordinate bug this codebase has had.
    */
    it.each([
      ['both blank', '', ''],
      ['latitude only', '33.5', ''],
      ['longitude only', '', '36.3'],
      ['not a number', 'x', 'y'],
      ['whitespace', '  ', '  '],
    ])('draws nothing for %s', (_name, lat, lon) => {
      expect(guestAreaData(lat, lon).features).toHaveLength(0);
    });
  });
});
