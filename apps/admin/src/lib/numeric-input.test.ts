import { describe, expect, it } from 'vitest';

import { wholeNumber } from './numeric-input';

/* Seats and positions typed on an Arabic keyboard (audit 2026-10-04). */
describe('wholeNumber', () => {
  it('reads Arabic-Indic digits as the number they show', () => {
    expect(wholeNumber('٢٠')).toBe(20);
    expect(wholeNumber(' ٣ ')).toBe(3);
  });

  it('reads ASCII digits unchanged', () => {
    expect(wholeNumber('20')).toBe(20);
  });

  it('is null when nothing was typed', () => {
    expect(wholeNumber('')).toBeNull();
    expect(wholeNumber('  ')).toBeNull();
  });

  /* Never a silent guess: what is not a number reaches the API as typed and is refused there. */
  it('passes anything else through as typed rather than inventing a number', () => {
    expect(wholeNumber('عشرون')).toBe('عشرون');
    expect(wholeNumber('2.5')).toBe('2.5');
  });
});
