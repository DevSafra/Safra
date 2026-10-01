import { describe, expect, it } from 'vitest';

import { withoutOverlaps } from './map-declutter';

const at = (x: number, y: number, price = '$100') => ({
  stay: { price, staysHere: 1 },
  x,
  y,
});

describe('the search map draws a pill only where it fits', () => {
  it('keeps the first of two pills that would overlap, and makes the second a dot', () => {
    const placed = withoutOverlaps([at(100, 100), at(110, 105)]);

    expect(placed.map((one) => one.dot)).toEqual([false, true]);
  });

  it('draws every pill when they are apart', () => {
    const placed = withoutOverlaps([at(100, 100), at(300, 100), at(100, 300)]);

    expect(placed.every((one) => !one.dot)).toBe(true);
  });

  it('judges a dot against the pills drawn, not against other dots', () => {
    /* B is covered by A; C overlaps only B, which is a dot, so C still gets its pill. */
    const placed = withoutOverlaps([at(100, 100), at(150, 100), at(205, 100)]);

    expect(placed.map((one) => one.dot)).toEqual([false, true, false]);
  });

  it('gives a wider price more room', () => {
    const narrow = withoutOverlaps([at(100, 100, '$9'), at(150, 100, '$9')]);
    const wide = withoutOverlaps([at(100, 100, '١٬٢٥٠٬٠٠٠ ل.س'), at(150, 100, '$9')]);

    expect(narrow[1]?.dot).toBe(false);
    expect(wide[1]?.dot).toBe(true);
  });
});
