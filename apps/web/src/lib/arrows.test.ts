import { describe, expect, it } from 'vitest';

import { backArrow, rangeArrow } from './arrows';
import { LOCALES } from '@safra/i18n';

/**
 * The bug these functions exist to prevent.
 *
 * Every date range was written `{from} → {to}` with a hard-coded right arrow. On an Arabic line the
 * bidi algorithm puts check-in on the RIGHT — correctly — and the arrow then ran from check-out back
 * to check-in. Reported from a screenshot, and it was in nine places.
 */
describe('rangeArrow', () => {
  it('points left on an RTL page, so it follows the reading direction', () => {
    expect(rangeArrow('ar')).toBe('←');
  });

  it.each(['en', 'de'] as const)('points right on %s', (locale) => {
    expect(rangeArrow(locale)).toBe('→');
  });
});

describe('backArrow', () => {
  /* Back means "the way I came", which on an RTL page is rightward. */
  it('points right on an RTL page', () => {
    expect(backArrow('ar')).toBe('→');
  });

  it.each(['en', 'de'] as const)('points left on %s', (locale) => {
    expect(backArrow(locale)).toBe('←');
  });
});

/**
 * The two must always disagree.
 *
 * This is the property that actually matters, and it holds for every locale the app serves — including
 * one added later, which is the case a pair of hand-written assertions would miss.
 */
describe('the two arrows', () => {
  it.each(LOCALES)('oppose each other in %s', (locale) => {
    expect(rangeArrow(locale)).not.toBe(backArrow(locale));
  });

  it('only ever produces the two horizontal arrows', () => {
    const produced = new Set(LOCALES.flatMap((l) => [rangeArrow(l), backArrow(l)]));

    expect([...produced].sort()).toStrictEqual(['←', '→']);
  });
});
