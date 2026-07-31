import { describe, expect, it } from 'vitest';

import { safeRedirect } from './redirect';

/**
 * Open-redirect guard for the sign-in form's `?next=`.
 *
 * This is the highest-value few lines in the auth flow to get wrong: the page around
 * the redirect is SAFRA's real login form on SAFRA's real domain, so a customer has
 * every reason to trust it right up to the moment it hands them somewhere else.
 */
describe('safeRedirect', () => {
  it('keeps a same-site path', () => {
    expect(safeRedirect('/ar/account', 'ar')).toBe('/ar/account');
  });

  it('keeps the query string', () => {
    expect(safeRedirect('/en/search?city=damascus', 'en')).toBe(
      '/en/search?city=damascus',
    );
  });

  it('falls back to the locale home when absent', () => {
    expect(safeRedirect(undefined, 'de')).toBe('/de');
    expect(safeRedirect('', 'de')).toBe('/de');
  });

  it('rejects an absolute URL to another origin', () => {
    expect(safeRedirect('https://evil.example/steal', 'ar')).toBe('/ar');
    expect(safeRedirect('http://evil.example', 'ar')).toBe('/ar');
  });

  /**
   * The one a "starts with /" check waves straight through, and the reason this
   * function exists rather than an inline conditional. `//evil.example` is a
   * protocol-relative URL: the browser reads it as another origin entirely.
   */
  it('rejects a protocol-relative URL', () => {
    expect(safeRedirect('//evil.example', 'ar')).toBe('/ar');
    expect(safeRedirect('//evil.example/path', 'ar')).toBe('/ar');
  });

  /** Some browsers normalise backslashes to slashes, making this equivalent to //. */
  it('rejects backslash smuggling', () => {
    expect(safeRedirect('/\\evil.example', 'ar')).toBe('/ar');
    expect(safeRedirect('\\\\evil.example', 'ar')).toBe('/ar');
  });

  it('rejects a scheme-only or relative path', () => {
    expect(safeRedirect('javascript:alert(1)', 'ar')).toBe('/ar');
    expect(safeRedirect('account', 'ar')).toBe('/ar');
    expect(safeRedirect('../admin', 'ar')).toBe('/ar');
  });

  it('takes the first value when the parameter is repeated', () => {
    expect(safeRedirect(['/ar/account', 'https://evil.example'], 'ar')).toBe(
      '/ar/account',
    );
  });

  /** A repeated parameter must not become a way to smuggle the hostile one in. */
  it('rejects a repeated parameter whose first value is hostile', () => {
    expect(safeRedirect(['https://evil.example', '/ar/account'], 'ar')).toBe('/ar');
  });

  it('drops a fragment rather than carrying it through', () => {
    expect(safeRedirect('/ar/account#token', 'ar')).toBe('/ar/account');
  });
});
