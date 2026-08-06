import { describe, expect, it } from 'vitest';

import {
  DEFAULT_TABLE_PAGE_SIZE,
  TABLE_SECTIONS,
  TABLE_SECTION_PARAMS,
  TABLE_SECTION_PATHS,
  storedPageSize,
  tablePageSizeSchema,
} from './table-preferences.js';

/**
 * A saved page size is written into a `jsonb` column on `users` — a row read on every
 * authenticated request — and the endpoint that writes it also REDIRECTS. Both make this a
 * boundary worth attacking rather than a display preference worth trusting.
 */
describe('tablePageSizeSchema', () => {
  it('accepts a real section and a size in range', () => {
    expect(tablePageSizeSchema.parse({ section: 'bookings', size: 50 })).toStrictEqual({
      section: 'bookings',
      size: 50,
    });
  });

  /** The form sends strings; `z.coerce` is what makes that safe rather than a `Number()` call. */
  it('coerces the string a form actually sends', () => {
    expect(tablePageSizeSchema.parse({ section: 'audit', size: '100' }).size).toBe(100);
  });

  /**
   * Every one of these must be rejected. A section that is not on the list is the important
   * case: it would become a KEY in a `jsonb` column, so the allow-list is what stops a caller
   * writing arbitrary structure into a row on the users table.
   */
  it.each([
    [{ section: 'settings', size: 10 }],
    [{ section: '__proto__', size: 10 }],
    [{ section: 'constructor', size: 10 }],
    [{ section: '../bookings', size: 10 }],
    [{ section: 'bookings', size: 0 }],
    [{ section: 'bookings', size: -5 }],
    [{ section: 'bookings', size: 101 }],
    [{ section: 'bookings', size: 10.5 }],
    [{ section: 'bookings', size: 'lots' }],
    [{ section: 'bookings' }],
    [{ size: 10 }],
    // `.strict()`: an unknown field is a request meaning something the server does not understand.
    [{ section: 'bookings', size: 10, userId: 'someone-else' }],
  ])('rejects %j', (input) => {
    expect(tablePageSizeSchema.safeParse(input).success).toBe(false);
  });
});

describe('storedPageSize', () => {
  it('reads a size somebody saved', () => {
    expect(storedPageSize({ bookings: 50 }, 'bookings')).toBe(50);
  });

  /** An absent key is the normal state — it means "never changed it". */
  it('falls back to ten when the section was never changed', () => {
    expect(storedPageSize({ audit: 100 }, 'bookings')).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(storedPageSize({}, 'bookings')).toBe(DEFAULT_TABLE_PAGE_SIZE);
  });

  /**
   * `jsonb` has no schema at rest. A row touched by a fixture, a migration or an older build can
   * hold anything, and this value decides a `LIMIT` — so everything unusable becomes the default
   * rather than reaching the database.
   */
  it.each([
    [null],
    [undefined],
    ['not an object'],
    [42],
    [[10]],
    [{ bookings: '50' }],
    [{ bookings: 10.5 }],
    [{ bookings: 0 }],
    [{ bookings: -1 }],
    [{ bookings: 5000 }],
    [{ bookings: null }],
    [{ bookings: Number.NaN }],
    [{ bookings: Number.POSITIVE_INFINITY }],
  ])('ignores %j', (stored) => {
    expect(storedPageSize(stored, 'bookings')).toBe(DEFAULT_TABLE_PAGE_SIZE);
  });

  /** Inherited properties are not saved preferences. */
  it('does not read a size off the prototype', () => {
    expect(storedPageSize({}, 'constructor' as never)).toBe(DEFAULT_TABLE_PAGE_SIZE);
    expect(storedPageSize({}, 'toString' as never)).toBe(DEFAULT_TABLE_PAGE_SIZE);
  });
});

/**
 * The maps the save endpoint redirects from. Incomplete entries would mean `undefined` reaching
 * `new URL()`, so they are checked rather than assumed to have been kept in step.
 */
describe('the section maps', () => {
  it('has a path and parameter names for every section', () => {
    for (const section of TABLE_SECTIONS) {
      expect(TABLE_SECTION_PATHS[section], section).toMatch(/^\/[a-z]*$/);
      expect(TABLE_SECTION_PARAMS[section]?.page, section).toBeTruthy();
      expect(TABLE_SECTION_PARAMS[section]?.size, section).toBeTruthy();
    }
  });

  /** One route, two tables: the scope map must not share the staff registry's parameters. */
  it('namespaces the second table on /staff', () => {
    expect(TABLE_SECTION_PATHS.staffScope).toBe(TABLE_SECTION_PATHS.staff);
    expect(TABLE_SECTION_PARAMS.staffScope).not.toStrictEqual(TABLE_SECTION_PARAMS.staff);
  });

  /** Every path is same-origin and single-segment — never `//evil.test`. */
  it('cannot redirect off the console', () => {
    for (const path of Object.values(TABLE_SECTION_PATHS)) {
      expect(path.startsWith('/')).toBe(true);
      expect(path.startsWith('//')).toBe(false);
    }
  });
});
