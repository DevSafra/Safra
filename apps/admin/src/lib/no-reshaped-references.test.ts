import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * The console never reshapes a booking reference it is going to navigate to.
 *
 * ## The bug this holds shut, twice
 *
 * `booking-verification.tsx` upper-cased the reference the agent typed. That broke the lookup
 * first — no fixture matched — and after the input was fixed the SAME transformation survived on
 * the success path, so «فتح الحجز» linked to `BKG-TEST-2BC2C0D7` for a booking called
 * `BKG-TEST-2bc2c0d7` and every verified caller landed on a 404 (Bashar, 2026-08-25).
 *
 * A reference is an OPAQUE identifier. Production ones are `BKG-2026-000123`, where case does not
 * matter and the mistake is invisible; every fixture is `BKG-TEST-<lowercase hex>`, where it is
 * fatal. That gap between the two shapes is exactly why this needs a sweep rather than a memory:
 * the defect cannot be seen on the data most people look at.
 *
 * The fix at the root is that the value now comes off the API response, so there is nothing left
 * to reshape. This stops the transformation being reintroduced anywhere else.
 *
 * A floor, not a ceiling: it looks for a case transform on the same LINE as the word reference, so
 * a rename or a value passed through two variables first would slip past. That is a worse problem
 * than the one being prevented, and it is not the one that has happened twice.
 */
const ROOT = join(import.meta.dirname, '..', '..', '..', '..');

/** `.toUpperCase()` / `.toLowerCase()` applied on a line that also mentions a reference. */
const RESHAPED = /\bto(?:Upper|Lower)Case\s*\(\s*\)/i;

describe('booking references in the console', () => {
  it('are never case-shifted before being navigated to', () => {
    const offenders: string[] = [];

    for (const path of sourceFiles()) {
      const lines = readFileSync(join(ROOT, path), 'utf8').split('\n');

      lines.forEach((line, index) => {
        if (!RESHAPED.test(line)) return;
        if (!/reference/i.test(line)) return;
        /*
          Comments describing the defect are not the defect. Skipped by SHAPE rather than by
          matching their words, so the note explaining this rule does not trip it.
        */
        if (/^\s*(?:\/\/|\*|\/\*)/.test(line)) return;

        offenders.push(`${path}:${index + 1}  ${line.trim()}`);
      });
    }

    expect(
      offenders,
      'A booking reference is opaque. Use the value the API returned, not a reshaped one.',
    ).toStrictEqual([]);
  });

  /** The control: the sweep is actually reading files, so an empty result means something. */
  it('reads the console source it is meant to be checking', () => {
    const files = sourceFiles();

    expect(files.length, 'source files found').toBeGreaterThan(20);
    expect(
      files.some((path) => path.includes('booking-verification')),
      'including the screen this rule came from',
    ).toBe(true);
  });
});

function sourceFiles(): string[] {
  return execFileSync(
    'git',
    ['ls-files', 'apps/admin/src/**/*.ts', 'apps/admin/src/**/*.tsx'],
    {
      cwd: ROOT,
      encoding: 'utf8',
    },
  )
    .split('\n')
    .filter((path) => path !== '' && !path.includes('.test.'));
}
