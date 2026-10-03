import { describe, expect, it } from 'vitest';

import { boundsOf, cityBounds } from './basemap';

const ALEPPO = cityBounds('36.2021', '37.1343');

describe('where a results map opens', () => {
  it('fits the stays it can place', () => {
    const [[west, south], [east, north]] = boundsOf([
      { latitude: '36.20', longitude: '37.13' },
      { latitude: '36.22', longitude: '37.16' },
    ]);
    expect(south).toBeLessThan(36.2);
    expect(north).toBeGreaterThan(36.22);
    expect(west).toBeLessThan(37.13);
    expect(east).toBeGreaterThan(37.16);
  });

  /*
    Bashar, 2026-10-03: the Aleppo page's map opened on Damascus when it had nothing to place. A city
    page passes its own city; the stays, when there are any, still decide.
  */
  it('opens on the page city when nothing can be placed', () => {
    expect(ALEPPO).toBeDefined();
    const [[west, south], [east, north]] = boundsOf([], ALEPPO);
    expect(south).toBeLessThan(36.2021);
    expect(north).toBeGreaterThan(36.2021);
    expect(west).toBeLessThan(37.1343);
    expect(east).toBeGreaterThan(37.1343);
  });

  it('still fits the stays on a city page that has some', () => {
    const [[, south]] = boundsOf([{ latitude: '35.55', longitude: '35.79' }], ALEPPO);
    expect(south).toBeLessThan(35.6);
  });

  it('keeps Damascus as the default for a page that names no city', () => {
    const [[west, south], [east, north]] = boundsOf([]);
    expect(south).toBeLessThan(33.5138);
    expect(north).toBeGreaterThan(33.5138);
    expect(west).toBeLessThan(36.2765);
    expect(east).toBeGreaterThan(36.2765);
  });

  /* `Number('')` is 0: a blank centre must fall back, never open the map on the Gulf of Guinea. */
  it.each([
    [null, '37.1'],
    ['36.2', null],
    ['', '37.1'],
    ['  ', '37.1'],
    ['north', '37.1'],
    ['91', '37.1'],
    ['36.2', '181'],
  ])('gives no city box for an unusable centre (%s, %s)', (latitude, longitude) => {
    expect(cityBounds(latitude, longitude)).toBeUndefined();
  });
});
