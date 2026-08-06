import { describe, expect, it } from 'vitest';

import { returnHref, returnQuery, rowAnchor } from './search-params';

/**
 * The link a detail screen offers back to the list it was opened from.
 *
 * Three separate promises, and each one broke in a way the reader noticed before a test did: the
 * page and filter survive the round trip, the destination cannot be steered by the URL, and the
 * row the reader opened is scrolled back to rather than left somewhere below the fold.
 */
describe('returnQuery', () => {
  it('carries the page, size, search and filter', () => {
    const query = returnQuery({ page: 4, size: 10, q: 'BKG', status: 'cancelled' });
    const params = new URLSearchParams(query.slice(1));

    expect(params.get('page')).toBe('4');
    expect(params.get('size')).toBe('10');
    expect(params.get('q')).toBe('BKG');
    expect(params.get('status')).toBe('cancelled');
  });

  /**
   * A URL that states the default is noise, and two URLs for one view is two things to keep in
   * step. Page one and the default size are the view you get by asking for nothing.
   */
  it('says nothing when there is nothing worth saying', () => {
    expect(returnQuery({ page: 1, size: 25 })).toBe('');
    expect(returnQuery({})).toBe('');
  });
});

describe('returnHref', () => {
  /**
   * The base path is a LITERAL from the caller and the query cannot influence it. This is the
   * property that stops a crafted link turning the back control into a redirect off the console,
   * so it is asserted rather than trusted to the reading of the function.
   */
  it('ignores anything in the query that looks like a destination', () => {
    const href = returnHref('/bookings', {
      basePath: 'https://evil.test',
      next: '//evil.test',
      url: '/settings',
      page: '3',
    });

    expect(href.startsWith('/bookings?')).toBe(true);
    expect(href).not.toContain('evil.test');
    expect(href).not.toContain('settings');
  });

  /** A hand-edited `?page=0` should produce page one, not a link the API answers with a 400. */
  it('clamps a page and size that are out of range', () => {
    const params = new URLSearchParams(
      returnHref('/bookings', {
        page: '0',
        size: '5000',
      }).replace('/bookings?', ''),
    );

    expect(Number(params.get('page') ?? 1)).toBeGreaterThanOrEqual(1);
    expect(Number(params.get('size') ?? 25)).toBeLessThan(5000);
  });

  it('appends the row fragment after the query, not before it', () => {
    expect(returnHref('/bookings', { page: '4' }, 'BKG-000012')).toBe(
      '/bookings?page=4#row-BKG-000012',
    );
  });

  it('still anchors the row when there is no query at all', () => {
    expect(returnHref('/bookings', {}, 'BKG-000012')).toBe('/bookings#row-BKG-000012');
  });

  /** Reached without a list — a bookmark, the dashboard, the reference lookup. */
  it('is the plain registry when there is no row to return to', () => {
    expect(returnHref('/bookings', {})).toBe('/bookings');
  });
});

describe('rowAnchor', () => {
  it('prefixes the reference so the id cannot collide with another element', () => {
    expect(rowAnchor('BKG-TEST-44def3c9')).toBe('row-BKG-TEST-44def3c9');
  });

  /**
   * The fold exists so a reference format that one day contains a space or a `#` degrades to a
   * harmless no-scroll rather than to a broken URL. Both ends call this function, so whatever it
   * returns, the `id` and the `#fragment` still match.
   */
  it('folds anything that would not survive a URL fragment', () => {
    expect(rowAnchor('BKG 001#x')).toBe('row-BKG_001_x');
    expect(rowAnchor('a/b?c')).toBe('row-a_b_c');
  });
});
