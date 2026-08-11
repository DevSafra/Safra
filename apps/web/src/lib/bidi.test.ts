import { describe, expect, it } from 'vitest';

import { ltrIsolate } from './bidi';

/**
 * The isolate that keeps an ISO date the right way round in Arabic.
 *
 * The bug these guard was invisible to every string assertion in the suite: the DOM held
 * `'2026-08-08'` and the browser DREW `08-08-2026`, because hyphens are bidi-neutral and an RTL
 * paragraph therefore lays the three numeric runs out right to left. It was found by generating the
 * receipt PDF and reading it.
 *
 * So these tests check the CHARACTERS, which is the only part a test can see. What they cannot prove is
 * that the browser then draws it correctly — `e2e/customer-invoices.spec.ts` covers that end.
 */
const LRI = '⁦';
const PDI = '⁩';

describe('ltrIsolate', () => {
  it('wraps a value in the isolate pair', () => {
    expect(ltrIsolate('2026-08-08')).toBe(`${LRI}2026-08-08${PDI}`);
  });

  /**
   * An ISOLATE, not a mark or an embedding.
   *
   * `U+200E LRM` and `U+202A LRE` also force direction, and both leak: they influence how the text
   * AROUND them is ordered. `U+2066`/`U+2069` are the pair designed to contain their effect.
   */
  it('uses U+2066 and U+2069 specifically', () => {
    const wrapped = ltrIsolate('x');

    expect(wrapped.codePointAt(0)).toBe(0x2066);
    expect(wrapped.codePointAt(wrapped.length - 1)).toBe(0x2069);
    expect(wrapped).not.toContain('‎');
    expect(wrapped).not.toContain('‪');
  });

  it('leaves the value itself untouched', () => {
    for (const value of ['2026-08-08', 'BKG-2026-000123', '+963900000001', '$381.99']) {
      expect(ltrIsolate(value).slice(1, -1)).toBe(value);
    }
  });

  /* Two invisible control characters around nothing would make an empty string stop being falsy. */
  it('returns an empty string unchanged', () => {
    expect(ltrIsolate('')).toBe('');
  });

  it('is idempotent in effect when applied to an already-isolated value', () => {
    const once = ltrIsolate('2026-08-08');
    const twice = ltrIsolate(once);

    /* Nesting is legal in the algorithm — the inner pair simply has no further work to do. */
    expect(twice.replaceAll(LRI, '').replaceAll(PDI, '')).toBe('2026-08-08');
  });

  /* The wrapped value adds exactly two characters, so nothing downstream needs to budget for more. */
  it('adds exactly two characters', () => {
    expect(ltrIsolate('2026-08-08')).toHaveLength('2026-08-08'.length + 2);
  });
});
