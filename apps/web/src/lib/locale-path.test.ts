import { describe, expect, it } from 'vitest';

import { localeOfPath, swapLocale } from './locale-path';

/**
 * The language switcher's arithmetic.
 *
 * Worth its own tests because every failure mode is a 404 or a lost page, and both look like the
 * site being broken rather than like a helper being wrong: `/en/ar/search`, `/en`, or the reader
 * dumped on a home page they did not ask for.
 */
describe('swapLocale', () => {
  it('keeps the page and changes only the language', () => {
    expect(swapLocale('/ar/search', 'en')).toBe('/en/search');
    expect(swapLocale('/en/property/damascus-loft', 'de')).toBe(
      '/de/property/damascus-loft',
    );
  });

  it('handles the locale root', () => {
    expect(swapLocale('/ar', 'de')).toBe('/de');
  });

  it('handles a deep path', () => {
    expect(swapLocale('/ar/account/invoices/INV-000012', 'en')).toBe(
      '/en/account/invoices/INV-000012',
    );
  });

  /**
   * `/en/ar/search` is the bug this shape exists to prevent — a prefix where a replacement was
   * needed. It 404s, which is worse than any wrong-but-valid page.
   */
  it('replaces the locale segment rather than prefixing it', () => {
    expect(swapLocale('/ar/search', 'en')).not.toContain('/ar/');
  });

  /** Nothing routes this way today; prefixing is the safe answer if anything ever does. */
  it('prefixes a path that names no locale', () => {
    expect(swapLocale('/search', 'en')).toBe('/en/search');
  });

  /** Trailing and doubled slashes come from hand-edited URLs and must not produce empty segments. */
  it('tolerates untidy input', () => {
    expect(swapLocale('/ar/search/', 'en')).toBe('/en/search');
    expect(swapLocale('//ar//search', 'en')).toBe('/en/search');
    expect(swapLocale('/', 'en')).toBe('/en');
  });
});

describe('localeOfPath', () => {
  it('reads the locale from the first segment', () => {
    expect(localeOfPath('/de/search')).toBe('de');
  });

  it('falls back to the default when there is none', () => {
    expect(localeOfPath('/search')).toBe('ar');
    expect(localeOfPath('/')).toBe('ar');
  });
});
