import { describe, expect, it } from 'vitest';

import {
  backTarget,
  detailHref,
  oneOf,
  origin,
  resolveOrigin,
  returnHref,
  returnQuery,
  rowAnchor,
} from './search-params';

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

/**
 * `?from=` decides where the back control GOES, which makes it a redirect surface, which makes it
 * the one thing in this file worth attacking.
 *
 * The design is that a URL picks a KEY from a fixed map and supplies at most a reference; it never
 * supplies a path. These tests are written against that promise rather than against the
 * implementation, so they still mean something if the parsing is rewritten.
 */
describe('resolveOrigin', () => {
  it('resolves a record origin to that record', () => {
    expect(resolveOrigin('bookings:BKG-2026-000431')).toStrictEqual({
      path: '/bookings/BKG-2026-000431',
      key: 'bookings',
      record: true,
    });
  });

  it('resolves a bare key to that screen', () => {
    expect(resolveOrigin('properties')).toStrictEqual({
      path: '/properties',
      key: 'properties',
      record: false,
    });
    expect(resolveOrigin('dashboard')?.path).toBe('/');
  });

  /**
   * Every one of these must resolve to `null`, and the caller then falls back to its own registry.
   *
   * The `dashboard:` cases are the sharpest: its path is `/`, so a reference appended to it would
   * build `//PAR-000002` — which a browser reads as protocol-relative and resolves to
   * `https://PAR-000002`. That is a real open redirect, and it is refused because a screen with no
   * rows accepts no reference at all.
   */
  it.each([
    ['//evil.test'],
    ['https://evil.test'],
    ['http://evil.test/x'],
    ['javascript:alert(1)'],
    ['/settings'],
    ['bookings:../../settings'],
    ['bookings:..%2F..%2Fsettings'],
    ['bookings:%2F%2Fevil.test'],
    ['bookings://evil.test'],
    ['bookings:BKG-1/../../evil'],
    ['bookings:'],
    ['bookings:bkg-lowercase'],
    ['bookings:TOOLONG-' + 'x'.repeat(60)],
    ['dashboard:PAR-000002'],
    ['dashboard://evil.test'],
    ['disputes:DSP-000001'],
    ['constructor'],
    ['__proto__'],
    ['__proto__:BKG-000001'],
    ['toString'],
    ['settings'],
    [''],
  ])('refuses %s', (raw) => {
    expect(resolveOrigin(raw)).toBeNull();
  });

  it('refuses nothing at all', () => {
    expect(resolveOrigin(undefined)).toBeNull();
  });

  /**
   * Whatever it returns, the path is a same-origin absolute path — one leading slash, never two.
   * A second leading slash is the whole protocol-relative trick, so it is asserted directly.
   */
  it('never produces a path a browser could read as an absolute URL', () => {
    for (const key of [
      'bookings',
      'partners',
      'properties',
      'messages',
      'disputes',
      'dashboard',
    ]) {
      for (const raw of [key, `${key}:BKG-000001`, `${key}:PAR-000002`]) {
        const resolved = resolveOrigin(raw);

        if (resolved === null) continue;

        expect(resolved.path.startsWith('/')).toBe(true);
        expect(resolved.path.startsWith('//')).toBe(false);
        expect(resolved.path).not.toMatch(/^[a-z]+:/i);
      }
    }
  });
});

describe('backTarget', () => {
  /** The reported bug: a partner opened from a booking returned to the partners REGISTRY. */
  it('returns to the record the reader came from', () => {
    const target = backTarget('/partners', { from: 'bookings:BKG-000012' }, 'PAR-000002');

    expect(target.href).toBe('/bookings/BKG-000012');
    expect(target.origin).toStrictEqual({
      path: '/bookings/BKG-000012',
      key: 'bookings',
      record: true,
    });
  });

  /**
   * The trip composes: the original list position travels ON to the origin, so pressing back
   * twice reaches the right page of the right filtered registry rather than the top of it.
   */
  it('carries the original list position through to the origin', () => {
    const target = backTarget(
      '/partners',
      { from: 'bookings:BKG-000012', page: '4', size: '10', status: 'cancelled' },
      'PAR-000002',
    );

    expect(target.href).toBe('/bookings/BKG-000012?page=4&size=10&status=cancelled');
  });

  it('returns to a LIST origin, at the reader’s page', () => {
    expect(
      backTarget('/partners', { from: 'properties', page: '3' }, 'PAR-000002').href,
    ).toBe('/properties?page=3');
  });

  /** An origin this console did not issue is ignored entirely, not followed. */
  it('falls back to its own registry when the origin is not one of ours', () => {
    const target = backTarget('/partners', { from: '//evil.test' }, 'PAR-000002');

    expect(target.href).toBe('/partners#row-PAR-000002');
    expect(target.origin).toBeNull();
  });

  it('behaves as before when there is no origin at all', () => {
    expect(backTarget('/partners', { page: '2' }, 'PAR-000002').href).toBe(
      '/partners?page=2#row-PAR-000002',
    );
  });
});

describe('detailHref', () => {
  it('names where the reader is now and keeps the list they came from', () => {
    const href = detailHref('/partners', 'PAR-000002', origin('bookings', 'BKG-000012'), {
      page: '4',
      size: '10',
      status: 'cancelled',
    });
    const url = new URL(href, 'https://console.test');

    expect(url.pathname).toBe('/partners/PAR-000002');
    expect(url.searchParams.get('from')).toBe('bookings:BKG-000012');
    expect(url.searchParams.get('page')).toBe('4');
    expect(url.searchParams.get('status')).toBe('cancelled');
  });

  /** The round trip, as one assertion: what `detailHref` writes, `backTarget` must resolve. */
  it('produces a link the back control can follow home', () => {
    const href = detailHref(
      '/properties',
      'PRO-000102',
      origin('bookings', 'BKG-000012'),
      {
        page: '4',
      },
    );
    const url = new URL(href, 'https://console.test');
    const params = Object.fromEntries(url.searchParams.entries());

    expect(backTarget('/properties', params, 'PRO-000102').href).toBe(
      '/bookings/BKG-000012?page=4',
    );
  });
});

/**
 * A closed vocabulary read from the URL — `?status=`.
 *
 * The registries used to forward whatever the URL said to the API, whose `.strict()` enum answers
 * 400, which the console renders as a screen with no table on it. A status is something a person
 * types or keeps in a bookmark after the vocabulary changes, so it degrades to "no filter".
 */
describe('oneOf', () => {
  const STATUSES = ['confirmed', 'cancelled'] as const;

  it('keeps a value the section actually has', () => {
    expect(oneOf('cancelled', STATUSES)).toBe('cancelled');
    expect(oneOf(['confirmed'], STATUSES)).toBe('confirmed');
    expect(oneOf('  cancelled  ', STATUSES)).toBe('cancelled');
  });

  /**
   * `open` is a real DISPUTE status and not a booking one, which is the case that actually
   * occurs: a status carried between two sections whose vocabularies differ.
   */
  it('drops a value from another section’s vocabulary', () => {
    expect(oneOf('open', STATUSES)).toBeUndefined();
  });

  it.each([['nonsense'], [''], ['   '], ['CONFIRMED'], ['constructor'], ['__proto__']])(
    'drops %s',
    (raw) => {
      expect(oneOf(raw, STATUSES)).toBeUndefined();
    },
  );

  it('drops nothing at all', () => {
    expect(oneOf(undefined, STATUSES)).toBeUndefined();
    expect(oneOf([], STATUSES)).toBeUndefined();
  });
});

/**
 * A reference reaching a URL PATH is encoded, matching what every `app/api/` route handler and the
 * الحجوزات lookup already do.
 *
 * References are database-generated and none needs encoding today. The value of the test is that
 * this function cannot quietly become the one place a reference reaches a path raw — which is what
 * it was until a review compared it against the rest of the codebase.
 */
describe('detailHref encodes the reference', () => {
  it('cannot be walked out of its own section', () => {
    const href = detailHref(
      '/partners',
      '../../settings',
      origin('bookings', 'BKG-1'),
      {},
    );
    const url = new URL(href, 'https://console.test');

    expect(url.pathname).toBe('/partners/..%2F..%2Fsettings');
    expect(url.pathname.startsWith('/partners/')).toBe(true);
  });

  it('leaves an ordinary reference readable', () => {
    expect(
      detailHref('/partners', 'PAR-000002', origin('bookings', 'BKG-1'), {}),
    ).toContain('/partners/PAR-000002?');
  });
});
