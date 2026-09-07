import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A field a person types into never carries `dir="ltr"`, and the class that replaces it exists.
 *
 * ## The rule, and why it needs a sweep
 *
 * Standing instruction from Bashar (2026-08-19): a field a person TYPES INTO follows the page's
 * direction. `dir="ltr"` sets the direction AND moves the element's own start edge, so on an Arabic
 * screen it put «رقم الوحدة» on the right of its own field and `101` on the far left of it. Where a
 * whole field genuinely must read left-to-right — an IBAN, a URL, a six-digit code — the remedy is
 * the `field-ltr` CLASS, which sets the direction and takes the ALIGNMENT from the document.
 *
 * The review of 2026-09-07 found ten typed fields still using the attribute, in the property
 * editor, the range editor, the unit editor, the sign-in code field and the 2FA enrolment. Every
 * one had a comment beside it arguing the case, which is what a rule looks like when it decays
 * one reasonable-sounding exception at a time.
 *
 * ## And the OTHER half, which is why this checks the stylesheets
 *
 * `field-ltr` was defined only in the customer app. The console used it on six fields and the class
 * did not exist there — confirmed against the BUILT stylesheet, where it was present in one app's
 * CSS and absent from the other's. A missing CSS class fails invisibly: the markup looks correct,
 * the review passes, and the field simply has no direction handling. So the remedy being AVAILABLE
 * is asserted here beside the attribute being absent, because half of this rule was silently
 * unenforceable for as long as both halves were not checked together.
 *
 * ## What is deliberately allowed
 *
 * `dir="ltr"` on anything that is not a field — a `<p>`, a `<span>`, an `<ol>` of recovery codes —
 * is correct and common: those are DISPLAYS of Latin runs. And a `readOnly` input is a display too,
 * which is why the check looks for an editable one.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

/** Every app that ships a stylesheet and therefore has to define the remedy for itself. */
const STYLESHEETS = [
  'apps/admin/src/app/globals.css',
  'apps/web/src/app/globals.css',
  'apps/partner/src/app/globals.css',
];

function sources(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) out.push(...sources(relative));
    else if (entry.endsWith('.tsx') && !entry.includes('.test.')) out.push(relative);
  }

  return out;
}

/**
 * The source with comments removed.
 *
 * This codebase documents the rule heavily and the prose QUOTES the attribute, so a check that read
 * raw text would report the explanations as violations — and, worse, could be satisfied by them. A
 * sweep whose own documentation answers it is the shape recorded in `no-credential-in-url.test.ts`.
 */
function code(body: string): string {
  return body
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/[^\n]*/g, '$1');
}

describe('a typed field follows the page', () => {
  const files = APPS.flatMap(sources);

  it('finds the components it is meant to be checking', () => {
    expect(files.length).toBeGreaterThan(100);
  });

  it('defines field-ltr in every app that ships a stylesheet', () => {
    const missing = STYLESHEETS.filter(
      (sheet) => !/^\.field-ltr\s*\{/m.test(readFileSync(join(ROOT, sheet), 'utf8')),
    );

    expect(
      missing,
      'the remedy for an LTR field must exist in the app that uses it — a missing class fails silently',
    ).toEqual([]);
  });

  it('puts dir="ltr" on no editable field', () => {
    const offenders: string[] = [];

    for (const file of files) {
      const body = code(readFileSync(join(ROOT, file), 'utf8'));

      for (const match of body.matchAll(/<(input|textarea|select)\b([^>]*)>/gi)) {
        const attributes = match[2] ?? '';

        if (!/dir=\{?['"]ltr['"]\}?/.test(attributes)) continue;
        /* A read-only input is a display of a value, not a field. */
        if (/\breadOnly\b|\bdisabled\b/.test(attributes)) continue;

        offenders.push(`${file}  <${match[1]}>`);
      }
    }

    expect(
      offenders,
      'use the field-ltr class: dir="ltr" also moves the field\'s start edge',
    ).toEqual([]);
  });
});
