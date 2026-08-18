import { getCountries, getCountryCallingCode, getExampleNumber } from 'libphonenumber-js';
import examples from 'libphonenumber-js/examples.mobile.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

import { DIAL_COUNTRIES, dialCountry, flagOf, toE164 } from './dial-codes.js';

/**
 * `dial-codes.ts` is GENERATED, and this is what stops it rotting.
 *
 * A committed copy of somebody else's data is only as good as the thing that notices it has
 * drifted. Dial plans change rarely, but "rarely" is exactly the interval over which nobody
 * remembers a table exists — and the failure is silent: a customer in a country whose plan moved
 * sees a counter that never reaches its total, which reads as "my number is wrong".
 *
 * `libphonenumber-js` is a devDependency, so this comparison costs the client nothing.
 *
 * To regenerate after a failure here, from `apps/web`:
 *
 * ```
 * node -e "…"   # see the git history of this file for the generator, or rebuild it from
 *               # getCountries() / getCountryCallingCode() / getExampleNumber()
 * ```
 */
describe('the generated dial-code table', () => {
  it('has every country the library knows', () => {
    expect(DIAL_COUNTRIES.map((c) => c.code)).toStrictEqual([...getCountries()]);
  });

  it('agrees with the library on every calling code and length', () => {
    const drifted = DIAL_COUNTRIES.filter((row) => {
      const example = getExampleNumber(row.code as never, examples);

      return (
        row.dial !== getCountryCallingCode(row.code as never) ||
        row.digits !== example?.nationalNumber.length
      );
    });

    expect(drifted).toStrictEqual([]);
  });

  /* The two the product actually launches into, asserted by value so a bad regen is loud. */
  it('knows Syria and its neighbours', () => {
    expect(dialCountry('SY')).toMatchObject({ dial: '963', digits: 9 });
    expect(dialCountry('JO')).toMatchObject({ dial: '962', digits: 9 });
    expect(dialCountry('LB')).toMatchObject({ dial: '961', digits: 8 });
  });
});

describe('flagOf', () => {
  /* Regional indicators, computed from the ISO code — no image, no request, no CSP exposure. */
  it('turns an ISO code into its flag', () => {
    expect(flagOf('SY')).toBe('🇸🇾');
    expect(flagOf('DE')).toBe('🇩🇪');
    expect(flagOf('US')).toBe('🇺🇸');
  });

  it('is defined for every country in the table', () => {
    for (const country of DIAL_COUNTRIES) {
      expect(flagOf(country.code), country.code).toHaveLength(4);
    }
  });
});

describe('toE164', () => {
  it('joins the dial code and the national number', () => {
    expect(toE164('963', '933123456')).toBe('+963933123456');
  });

  /*
    A person types what they see written down, and what is written down is often `0912…` — the
    trunk prefix. Sending `+9630912…` would fail the API's E.164 check with a format error the
    customer cannot act on, because the number they typed is the right number.
  */
  it('drops a leading trunk zero', () => {
    expect(toE164('963', '0933123456')).toBe('+963933123456');
  });

  /* Spaces, dashes and brackets are how humans write numbers; none of them are digits. */
  it('keeps only digits', () => {
    expect(toE164('49', '(0) 151-2345 6789')).toBe('+4915123456789');
  });

  /* An empty field must not submit a bare dial code, which would pass a naive regex. */
  it('is empty when no national number was typed', () => {
    expect(toE164('963', '')).toBe('');
    expect(toE164('963', '   ')).toBe('');
  });
});
