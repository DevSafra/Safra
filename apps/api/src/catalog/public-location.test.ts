import { describe, expect, it } from 'vitest';

import {
  areaPolygon,
  fuzzCoordinate,
  PUBLIC_COORDINATE_DECIMALS,
  PUBLIC_MAP_ZOOM,
} from './public-location.js';

/**
 * What a listing's public location is allowed to be.
 *
 * These are the arithmetic behind a promise the product makes in words — «الموقع الدقيق
 * يظهر بعد تأكيد الحجز» — so they are asserted rather than trusted. Every one was watched
 * to fail: the rounding against `PUBLIC_COORDINATE_DECIMALS = 6`, the closure against a
 * loop ending at `AREA_POINTS - 1`, and the cosine against dropping the divisor.
 */
describe('fuzzCoordinate', () => {
  it('rounds to about 100 m, discarding the metres that would find a door', () => {
    expect(fuzzCoordinate('33.5138192')).toBe('33.514');
    expect(fuzzCoordinate('36.2765401')).toBe('36.277');
  });

  it('keeps three decimals even when they are zeros, so the precision is not readable from the string', () => {
    /*
      `33.5` and `33.500` are the same number and a DIFFERENT disclosure: a bare `33.5`
      tells a reader the value was never more precise, and `toFixed` is what stops the
      payload leaking how much was thrown away.
    */
    expect(fuzzCoordinate('33.5')).toBe('33.500');
    expect(fuzzCoordinate(33)).toBe('33.000');
  });

  it('is three decimals, which is the ~100 m the copy promises', () => {
    expect(PUBLIC_COORDINATE_DECIMALS).toBe(3);
  });

  it('answers null for anything that is not a coordinate, rather than inventing one', () => {
    for (const value of [
      null,
      undefined,
      'somewhere',
      {},
      [],
      true,
      Number.NaN,
      Infinity,
    ]) {
      expect(fuzzCoordinate(value)).toBeNull();
    }
  });

  it('answers null for a BLANK string rather than the Gulf of Guinea', () => {
    /*
      `Number('')` is 0, so a blank column used to round to "0.000" — a real pair of
      coordinates, 600 km off the coast of Ghana. Two numbers nobody rendered hid it;
      a map card of open ocean would not have.
    */
    for (const value of ['', '   ', '\n']) {
      expect(fuzzCoordinate(value)).toBeNull();
    }
  });
});

describe('areaPolygon', () => {
  const DAMASCUS = { lat: 33.513, lon: 36.277 };

  const points = (polygon: string) =>
    polygon.split('|').map((pair) => {
      const [lon, lat] = pair.split(',').map(Number);
      return { lon: lon ?? 0, lat: lat ?? 0 };
    });

  it('closes, so the fill has a boundary to be inside of', () => {
    const p = points(areaPolygon(DAMASCUS.lat, DAMASCUS.lon));
    expect(p.length).toBeGreaterThan(8);
    expect(p[0]).toEqual(p[p.length - 1]);
  });

  it('is centred on the listing', () => {
    const p = points(areaPolygon(DAMASCUS.lat, DAMASCUS.lon));
    const meanLon = p.reduce((sum, q) => sum + q.lon, 0) / p.length;
    const meanLat = p.reduce((sum, q) => sum + q.lat, 0) / p.length;

    expect(meanLon).toBeCloseTo(DAMASCUS.lon, 3);
    expect(meanLat).toBeCloseTo(DAMASCUS.lat, 3);
  });

  it('draws a circle on the ground rather than an ellipse, by widening with latitude', () => {
    /*
      The defect this catches: dividing the east-west radius by cos(latitude) is easy to
      omit, and the result still renders — as a disc squashed by 17% in Damascus and by
      half in Oslo. Comparing two latitudes is what makes the omission visible, because a
      single one looks plausible whatever the maths.
    */
    const spread = (lat: number) => {
      const p = points(areaPolygon(lat, 0));
      const lons = p.map((q) => q.lon);
      const lats = p.map((q) => q.lat);
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

    // And the ratio is cos(latitude), not something that merely increases.
    expect(damascus.lon / equator.lon).toBeCloseTo(
      1 / Math.cos((33.513 * Math.PI) / 180),
      3,
    );
  });

  it('stays well inside the frame at the zoom the map is drawn at', () => {
    /*
      A disc wider than the picture is not a disc, it is a tint over the whole map. At
      z14 on 512px tiles a metre is about four pixels wide, so the 150 m radius lands near
      38px — comfortably inside the 320px-tall card.
    */
    const metresPerPixel =
      (78_271.5 * Math.cos((DAMASCUS.lat * Math.PI) / 180)) / 2 ** PUBLIC_MAP_ZOOM;
    const p = points(areaPolygon(DAMASCUS.lat, DAMASCUS.lon));
    const radiusDegreesLat = Math.max(...p.map((q) => q.lat)) - DAMASCUS.lat;
    const radiusPixels = (radiusDegreesLat * 111_320) / metresPerPixel;

    expect(radiusPixels).toBeGreaterThan(20);
    expect(radiusPixels).toBeLessThan(80);
  });

  it('emits no character that would break out of the path parameter', () => {
    /*
      The polygon is interpolated into a MapTiler query string beside our key. `|` and `:`
      are the parameter's own separators, so a coordinate formatter that ever produced
      one — an exponent, a locale's comma, a NaN — would change the meaning of the request
      rather than just the picture.
    */
    const polygon = areaPolygon(DAMASCUS.lat, DAMASCUS.lon);
    expect(polygon).toMatch(/^-?\d+\.\d+,-?\d+\.\d+(\|-?\d+\.\d+,-?\d+\.\d+)+$/);
    expect(polygon).not.toMatch(/[eE:&?#%]/);
  });
});
