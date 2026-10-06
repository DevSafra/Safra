import { describe, expect, it } from 'vitest';

import { firstAddressLine } from './property-detail.service.js';

/**
 * The «approximate» address a property page publishes before any booking exists (P-001).
 *
 * REGRESSION (2026-10-06): the split was on the Latin comma alone, and the platform's addresses are
 * Arabic. GET /api/v1/properties/qasr-al-sharq-malki returned «المالكي، دمشق», the full stored value,
 * on the page and in its structured data. Each separator here is one a partner types.
 */
describe('firstAddressLine', () => {
  it.each([
    ['an Arabic comma', 'المالكي، دمشق', 'المالكي'],
    ['a Latin comma', 'Bab Touma, Old City, Damascus', 'Bab Touma'],
    ['a full-width comma', 'Mezzeh，Damascus', 'Mezzeh'],
    ['an Arabic semicolon', 'باب توما؛ دمشق القديمة', 'باب توما'],
    ['a line break', 'Abu Rummaneh\nDamascus', 'Abu Rummaneh'],
    ['a spaced hyphen', 'Kafr Sousa - Damascus', 'Kafr Sousa'],
    ['an en dash', 'Kafr Sousa – Damascus', 'Kafr Sousa'],
    ['an em dash', 'القصاع—دمشق', 'القصاع'],
  ])('stops at %s', (_, address, expected) => {
    expect(firstAddressLine(address)).toBe(expected);
  });

  it('keeps a hyphen inside a word, which is a name rather than a separator', () => {
    expect(firstAddressLine('Al-Malki, Damascus')).toBe('Al-Malki');
  });

  it('keeps an address with no separator, which is a single area', () => {
    expect(firstAddressLine('المالكي')).toBe('المالكي');
  });

  /**
   * No separator at all is one component, and it may be the WHOLE street address. The numbers are
   * what locate the building, in whichever digits the partner typed them.
   */
  it.each([
    ['Western digits', 'شارع بغداد 12 بناء 3', 'شارع بغداد بناء'],
    ['Arabic-Indic digits', 'شارع بغداد ١٢ بناء ٣', 'شارع بغداد بناء'],
    ['Persian digits', 'شارع بغداد ۱۲', 'شارع بغداد'],
    ['a numbered first component', 'المزة 86، دمشق', 'المزة'],
  ])('drops a house number in %s', (_, address, expected) => {
    expect(firstAddressLine(address)).toBe(expected);
  });

  it('never returns more than the stored address said, for every separator at once', () => {
    const full = 'المالكي، شارع ٧؛ بناء 3\nدمشق, سوريا – 12';
    const approximate = firstAddressLine(full);

    expect(approximate).toBe('المالكي');
    expect(full.startsWith(approximate)).toBe(true);
  });

  it('answers an empty string for an empty address', () => {
    expect(firstAddressLine('')).toBe('');
  });
});
