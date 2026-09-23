import { describe, expect, it } from 'vitest';

import { landmarkIconPathSchema, landmarkIconPathsSchema } from './landmark.js';

/**
 * The boundary that makes an operator-editable icon safe to render on the customer site.
 *
 * ## What changed, and why this test exists
 *
 * Landmark kinds were a `pgEnum` and their icons were drawn in code, so no operator input ever
 * reached an SVG. Making kinds manageable (Bashar, 2026-09-23) means a string somebody types
 * into the console is rendered on every property page in that city.
 *
 * The rendering is already safe on its own — React sets `d` as an ATTRIBUTE and parses no
 * markup — but «one call site is currently careful» is not a control. The schema restricts the
 * value to the characters an SVG path is made of, and that set contains no `<`, no quote, no
 * `&`, no `(` and no `:`. A string that obeys it cannot open an element, close an attribute,
 * start an entity, or form a `url(...)` or a `javascript:` — whatever a future caller does
 * with it.
 *
 * So these are not «bad input is rejected» cases. Each one is a payload that would matter if
 * the value ever reached markup, and the point is that the shape is unrepresentable rather
 * than merely filtered.
 */
describe('landmark icon paths cannot carry markup', () => {
  /** Real path data from the seeded marks — the control that the schema is not just `never`. */
  const REAL = [
    'M4 9h16M4 15h16M9 4v16M15 4v16',
    'M3.5 14.5 21 9l-1 3.5-7 2.5-2.5 5-2-1 .8-3.6-3.3.9z',
    'M7 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M4 12a8 8 0 0 1 16 0z',
    'M2.5 9 12 5l9.5 4L12 13z',
    'M1e2 2 L3 4',
  ];

  it('accepts the marks the product actually draws', () => {
    for (const path of REAL) {
      expect(landmarkIconPathSchema.safeParse(path).success, path).toBe(true);
    }
  });

  /**
   * The payloads. Every one is rejected by the ALPHABET rather than by a deny-list, which is
   * why this does not need to enumerate every escape somebody might invent.
   */
  const ATTACKS: ReadonlyArray<readonly [string, string]> = [
    [
      'closes the attribute and opens a tag',
      'M0 0" /><script>alert(1)</script><path d="',
    ],
    ['opens an element directly', '<svg onload=alert(1)>'],
    ['an event handler', 'M0 0 onload=alert(1)'],
    ['an HTML entity', 'M0 0 &lt;script&gt;'],
    ['a javascript: URL', 'javascript:alert(1)'],
    ['a CSS url()', 'url(https://evil.example/x)'],
    ['a data URI', 'data:text/html;base64,PHN2Zz4='],
    ['an external reference', 'M0 0 xlink:href=//evil.example'],
    ['a single quote break-out', "M0 0' onmouseover='alert(1)"],
    ['a newline-smuggled tag', 'M0 0\n<img src=x onerror=alert(1)>'],
    ['nothing but separators', '   . , -  '],
    ['empty', ''],
  ];

  it.each(ATTACKS)('refuses %s', (_name, payload) => {
    expect(landmarkIconPathSchema.safeParse(payload).success).toBe(false);
  });

  /**
   * The general property, stated once rather than per payload.
   *
   * A deny-list protects the strings it names; this asserts that NO accepted value can contain
   * any character that markup needs. That is the claim the security argument rests on, and it
   * survives an attack nobody thought of.
   */
  it('accepts no character that markup is built from', () => {
    const DANGEROUS = ['<', '>', '"', "'", '&', '(', ')', ':', ';', '\\', '`', '='];

    for (const character of DANGEROUS) {
      const probe = `M0 0 ${character} L1 1`;
      expect(
        landmarkIconPathSchema.safeParse(probe).success,
        `«${character}» must not be accepted inside path data`,
      ).toBe(false);
    }
  });

  it('bounds how much one kind can put on a page', () => {
    const one = REAL[0] ?? '';
    expect(landmarkIconPathsSchema.safeParse(Array(6).fill(one)).success).toBe(true);
    expect(landmarkIconPathsSchema.safeParse(Array(7).fill(one)).success).toBe(false);
    /* No icon at all is a kind that draws nothing, which is allowed. */
    expect(landmarkIconPathsSchema.safeParse([]).success).toBe(true);
  });

  it('refuses a path long enough to be a payload rather than a shape', () => {
    expect(landmarkIconPathSchema.safeParse(`M0 0 ${'L1 1 '.repeat(500)}`).success).toBe(
      false,
    );
  });
});
