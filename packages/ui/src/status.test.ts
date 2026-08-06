import { describe, expect, it } from 'vitest';

import { statusTone, VOCABULARIES, type Tone } from './status.js';

/**
 * The two rules a status colour has to satisfy at once (Bashar, 2026-08-06):
 *
 *  1. a status is the same colour on every screen, and
 *  2. no two statuses on ONE screen share a colour.
 *
 * Rule 1 is what the map being global gives you for free. Rule 2 is a CONSTRAINT ACROSS the map
 * that nobody can verify by reading it — thirteen payment statuses have to be thirteen colours,
 * and the person adding a fourteenth will not notice. So it is checked here, per vocabulary,
 * against the lists the map ships with.
 */
describe('no two statuses on one screen share a colour', () => {
  it.each(Object.keys(VOCABULARIES))('%s', (name) => {
    const values = VOCABULARIES[name] ?? [];
    const byTone = new Map<Tone, string[]>();

    for (const value of values) {
      const tone = statusTone(value);

      byTone.set(tone, [...(byTone.get(tone) ?? []), value]);
    }

    const clashes = [...byTone.entries()]
      .filter(([, statuses]) => statuses.length > 1)
      .map(([tone, statuses]) => `${tone}: ${statuses.join(', ')}`);

    expect(clashes).toStrictEqual([]);
  });

  /** A vocabulary that lost its values would pass the check above while proving nothing. */
  it('checks every vocabulary the project defines', () => {
    expect(Object.keys(VOCABULARIES).length).toBeGreaterThanOrEqual(11);

    for (const [name, values] of Object.entries(VOCABULARIES)) {
      expect(values.length, name).toBeGreaterThanOrEqual(3);
    }
  });

  /**
   * Every status in every vocabulary is actually IN the map.
   *
   * `statusTone` falls back to `faint` for an unknown value, which is the right behaviour at
   * runtime and would quietly satisfy the clash check for a vocabulary of one unmapped status.
   */
  it('has a colour for every status, not a fallback', () => {
    const unmapped: string[] = [];

    for (const [name, values] of Object.entries(VOCABULARIES)) {
      for (const value of values) {
        // `draft`, `refunded` and `used` are legitimately faint; they are mapped to it.
        if (
          statusTone(value) === 'faint' &&
          !['draft', 'refunded', 'used'].includes(value)
        ) {
          unmapped.push(`${name}.${value}`);
        }
      }
    }

    expect(unmapped).toStrictEqual([]);
  });
});

describe('statusTone', () => {
  /**
   * Purple, never gold — SRS §1 and §14 make this an explicit rule, and it is the one a
   * simplification keeps trying to undo. A paid booking waiting on a partner is not good news.
   */
  it('keeps pending_confirmation purple', () => {
    expect(statusTone('pending_confirmation')).toBe('pend');
    expect(statusTone('pending_confirmation')).not.toBe('gold');
  });

  /**
   * The distinctions that were lost when everything was collapsed onto seven tones, and that
   * Bashar asked for back. Each pair shares a screen, so each pair must differ.
   */
  it.each([
    ['confirmed', 'completed'],
    ['approved', 'published'],
    ['cancelled', 'disputed'],
    ['rejected', 'suspended'],
    ['draft', 'archived'],
    ['expired', 'failed'],
    ['captured', 'collected'],
    ['refunded', 'partially_refunded'],
    ['pending', 'processing'],
    ['superseded', 'terminated'],
  ])('tells %s apart from %s', (a, b) => {
    expect(statusTone(a)).not.toBe(statusTone(b));
  });

  it('gives an unknown status no signal at all', () => {
    expect(statusTone('some_future_status')).toBe('faint');
    expect(statusTone('')).toBe('faint');
    expect(statusTone(null)).toBe('faint');
    expect(statusTone(undefined)).toBe('faint');
  });

  /** Inherited object properties are not statuses — see the note on the lookup. */
  it.each([['constructor'], ['__proto__'], ['toString'], ['hasOwnProperty']])(
    'does not treat %s as a status',
    (key) => {
      expect(statusTone(key)).toBe('faint');
    },
  );
});
