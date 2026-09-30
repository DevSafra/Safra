import { describe, expect, it } from 'vitest';

import { ADMIN_LOCALES, adminMessages } from './admin.js';
import { CONTENT_CATALOGUES } from './content.js';
import { EMAIL_CATALOGUES } from './email.js';
import { ERROR_CATALOGUES } from './errors.js';
import { PARTNER_LOCALES, partnerMessages } from './partner.js';
import { WEB_CATALOGUES } from './web.js';

/**
 * No copy a person reads uses «—» as punctuation (Bashar, 2026-09-30: «please never use the
 * dash»).
 *
 * Arabic joins a clause with «،» or «:», English and German with a comma, a colon, parentheses or
 * a full stop. The sweep that introduced this decided each of the 360 strings in context; this
 * test is what stops the 361st arriving in a new screen's copy, which is how a convention decays
 * between three apps without anyone deciding it should.
 *
 * ## The one allowance
 *
 * A value that is ONLY «—» is a placeholder, not punctuation: `admin.noData` and its kin stand
 * in an empty cell. Those are a separate decision, so they are exempt here BY SHAPE. A dash with
 * any other character beside it is prose and fails.
 *
 * The walk covers every string in every catalogue rather than a list of known offenders,
 * because a list only ever protects the strings it names.
 */
const PLACEHOLDER = /^\s*—\s*$/;

function strings(value: unknown, path: string[] = []): { path: string; text: string }[] {
  if (typeof value === 'string') return [{ path: path.join('.'), text: value }];
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => strings(child, [...path, key]));
}

const catalogues: [string, unknown][] = [
  ...ADMIN_LOCALES.map((l): [string, unknown] => [`admin/${l}`, adminMessages(l)]),
  ...PARTNER_LOCALES.map((l): [string, unknown] => [`partner/${l}`, partnerMessages(l)]),
  ...Object.entries(WEB_CATALOGUES).map(([l, c]): [string, unknown] => [`web/${l}`, c]),
  ...Object.entries(EMAIL_CATALOGUES).map(([l, c]): [string, unknown] => [
    `email/${l}`,
    c,
  ]),
  ...Object.entries(ERROR_CATALOGUES).map(([l, c]): [string, unknown] => [
    `errors/${l}`,
    c,
  ]),
  ...Object.entries(CONTENT_CATALOGUES).map(([l, c]): [string, unknown] => [
    `content/${l}`,
    c,
  ]),
];

describe('copy never punctuates with an em-dash', () => {
  it('walks real strings, so a green run means something', () => {
    const total = catalogues.reduce((n, [, c]) => n + strings(c).length, 0);
    expect(total).toBeGreaterThan(1000);
  });

  for (const [name, catalogue] of catalogues) {
    it(name, () => {
      const offenders = strings(catalogue)
        .filter(({ text }) => text.includes('—') && !PLACEHOLDER.test(text))
        .map(({ path, text }) => `${path}: ${text.slice(0, 80)}`);

      expect(offenders).toEqual([]);
    });
  }
});
