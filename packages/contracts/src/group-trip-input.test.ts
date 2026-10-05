import { describe, expect, it } from 'vitest';

import { westernDigits } from './digits.js';
import { ERROR } from './error-codes.js';
import { groupTripUpdateSchema } from './group-trip.js';

/*
  What an Arabic keyboard types into the group-trip form (audit 2026-10-04).

  The schema matched ASCII digits only, so «٢٠٢٦-١٠-٠٤» and «٤٥٠» were refused with an error that
  named no field, and an impossible date such as 2026-02-30 passed the shape check and came back
  from Postgres as a 500.
*/
describe('the group-trip input', () => {
  it('reads dates typed in Arabic-Indic digits as the dates they show', () => {
    const parsed = groupTripUpdateSchema.parse({
      startsOn: '٢٠٢٦-١٠-٠٤',
      endsOn: '٢٠٢٦-١٠-٠٧',
    });

    expect(parsed.startsOn).toBe('2026-10-04');
    expect(parsed.endsOn).toBe('2026-10-07');
  });

  it('reads a price typed with Arabic digits and the Arabic decimal mark', () => {
    const parsed = groupTripUpdateSchema.parse({
      priceFrom: '٤٥٠٫٥',
      currencyCode: 'usd',
    });

    expect(parsed.priceFrom).toBe('450.5');
  });

  it('refuses a date that does not exist, with a code rather than a database error', () => {
    const parsed = groupTripUpdateSchema.safeParse({ startsOn: '2026-02-30' });

    expect(parsed.success).toBe(false);
    expect(parsed.error?.issues[0]?.message).toBe(ERROR.VALIDATION_DATE_UNREAL);
  });

  /* The opposite control: ASCII input is unchanged. */
  it('leaves an ASCII date and price exactly as typed', () => {
    const parsed = groupTripUpdateSchema.parse({
      startsOn: '2026-10-04',
      priceFrom: '450.50',
      currencyCode: 'USD',
    });

    expect(parsed.startsOn).toBe('2026-10-04');
    expect(parsed.priceFrom).toBe('450.50');
  });
});

describe('westernDigits', () => {
  it('converts both Arabic digit sets and the decimal mark, and nothing else', () => {
    expect(westernDigits('٠١٢٣٤٥٦٧٨٩')).toBe('0123456789');
    expect(westernDigits('۰۱۲۳۴۵۶۷۸۹')).toBe('0123456789');
    expect(westernDigits('٤٥٠٫٥')).toBe('450.5');
    expect(westernDigits('SY12 ab')).toBe('SY12 ab');
  });
});
