import { describe, expect, it } from 'vitest';

import { SettingsService } from './settings.service.js';

/**
 * How a boolean setting behaves when the stored value is not one.
 *
 * `getBoolean` exists because the same-day cutoff became switchable (Bashar, 2026-09-04), and a
 * rule that can be turned off is only as safe as what it does with a value it cannot read. The
 * integration suite covers the ABSENT row; this covers the WRONG one, which no fixture in a
 * seeded database can produce and which a hand-edited row or a bad migration can.
 *
 * The direction is the whole point: every unreadable value must fall back, and the caller's
 * fallback for the cutoff is `true`. *"Existing behaviour should remain the safe default unless
 * the administrator explicitly changes it."* A `Boolean(value)` coercion would read `'false'` as
 * TRUE and `0` as false — the second of those silently opens same-day booking platform-wide.
 */
describe('SettingsService.getBoolean', () => {
  /**
   * The database stands in as a stub. `get()` reaches it only on a cache MISS, and seeding the
   * cache directly is what lets this test name a stored value without a table — the alternative
   * is an integration test that cannot express `{}` as a setting value at all.
   */
  const withStored = (value: unknown): SettingsService => {
    const service = new SettingsService({} as never);

    (service as unknown as { cache: Map<string, unknown> }).cache.set('k', {
      value,
      expiresAt: Date.now() + 60_000,
    });

    return service;
  };

  it.each([
    ['a real boolean true', true, true],
    ['a real boolean false', false, false],
    /* `jsonb` round-trips booleans, but a value written as text by hand arrives as a string. */
    ['the string "true"', 'true', true],
    ['the string "false"', 'false', false],
  ])('reads %s', async (_name, stored, expected) => {
    expect(await withStored(stored).getBoolean('k', true)).toBe(expected);
    expect(await withStored(stored).getBoolean('k', false)).toBe(expected);
  });

  /**
   * Everything else falls back — and falls back to the CALLER's value, not to `false`.
   *
   * `0`, `''` and `null` are the ones a coercion gets wrong in the dangerous direction: each is
   * falsy, so `Boolean(stored)` would answer "the cutoff is off" for a row nobody meant to change.
   */
  it.each([
    ['a number', 1],
    ['zero', 0],
    ['an empty string', ''],
    ['an unrelated string', 'yes'],
    ['null', null],
    ['an object', {}],
  ])(
    'falls back on %s, in whichever direction the caller asked for',
    async (_name, stored) => {
      expect(await withStored(stored).getBoolean('k', true)).toBe(true);
      expect(await withStored(stored).getBoolean('k', false)).toBe(false);
    },
  );
});
