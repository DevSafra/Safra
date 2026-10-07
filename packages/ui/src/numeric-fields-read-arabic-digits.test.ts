import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every numeric field in the console and the portal reads «١٢» as 12 (audit 2026-10-06).
 *
 * Operators type on an Arabic keyboard, and a dozen controls checked what they typed with an ASCII
 * regex or `Number()`: a gift card, a coupon, an ad price, a fine, a six-digit code, a numeric
 * setting, a payout account. Each stayed dark or was refused with nothing on screen saying why. The
 * fix is `typedDigits` from `@safra/contracts`, called in the field's own `onChange`.
 *
 * Two shapes are swept, because each one is the defect wherever it appears:
 *
 * 1. **A field with an `inputMode`** that never calls `typedDigits`. The number pad is the field
 *    announcing it takes digits; a field that says so and then refuses Arabic ones is the bug.
 *    The console's `Field` from `geo-form`, and a file's own `Field` that normalises inside itself,
 *    cover their call sites through the component.
 * 2. **`type="number"`**, which cannot be fixed at the call site at all: Chromium DROPS «١٢٣» from
 *    a number field, reporting an empty value with no `badInput` (measured with Playwright 1.62).
 *    The partner's price, guests and quantity fields were all of this kind.
 *
 * The customer app is not swept here: its forms belong to a different area of the audit.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/partner/src'];

/**
 * A known open instance, with the reason and the shape it must still have.
 *
 * Asserted below to still be `type="number"`, so an entry cannot outlive the defect it excuses.
 * Empty since the pager's page box became `PageNumberInput` (2026-10-06).
 */
const OPEN: Readonly<Record<string, string>> = {};

function sources(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) {
      out.push(...sources(relative));
    } else if (entry.endsWith('.tsx') && !entry.endsWith('.test.tsx')) {
      out.push(relative);
    }
  }

  return out;
}

/** Each `<input …/>` or `<Field …/>` element in a file, as written. */
function tags(text: string): string[] {
  return [...text.matchAll(/<(?:input|Field)\s[\s\S]*?\/>/g)].map((match) => match[0]);
}

function offenders(): string[] {
  return APPS.flatMap(sources).flatMap((file) => {
    if (Object.hasOwn(OPEN, file)) return [];

    const text = readFileSync(join(ROOT, file), 'utf8');
    /* The console's shared `Field`, or a file's own `Field` that normalises inside itself. */
    const normalisingField =
      text.includes("from '@/components/geo-form'") ||
      /function Field\b[\s\S]*?typedDigits\(/.test(text);

    return tags(text)
      .filter((tag) => {
        if (tag.includes('type="number"')) return true;
        if (!tag.includes('inputMode')) return false;
        if (normalisingField && tag.startsWith('<Field')) return false;

        return !tag.includes('typedDigits(');
      })
      .map((tag) => `${file}: ${tag.slice(0, 80).replace(/\s+/g, ' ')}`);
  });
}

describe('numeric fields read Arabic and Persian digits', () => {
  it('every numeric field normalises what was typed', () => {
    expect(
      offenders(),
      'A numeric field must call `typedDigits(event.currentTarget)` in its onChange, and must not ' +
        'be `type="number"`, which drops Arabic digits before any code can see them.',
    ).toEqual([]);
  });

  it('the console Field normalises inside itself, which is what exempts its call sites', () => {
    const text = readFileSync(
      join(ROOT, 'apps/admin/src/components/geo-form.tsx'),
      'utf8',
    );

    expect(text).toContain('typedDigits(event.currentTarget)');
  });

  it('each open instance still is what its entry says', () => {
    for (const file of Object.keys(OPEN)) {
      expect(readFileSync(join(ROOT, file), 'utf8'), file).toContain('type="number"');
    }
  });

  /** A sweep whose corpus is empty reports a clean bill of health for code it never read. */
  it('actually reads both apps and finds their numeric fields', () => {
    const files = APPS.flatMap(sources);
    const numeric = files.flatMap((file) =>
      tags(readFileSync(join(ROOT, file), 'utf8')).filter((tag) =>
        tag.includes('inputMode'),
      ),
    );

    expect(files.some((file) => file.startsWith('apps/partner/src'))).toBe(true);
    expect(numeric.length).toBeGreaterThan(20);
  });
});
