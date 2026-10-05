import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  Every map labels places in the PAGE's language (audit 2026-10-04).

  The results map and its thumbnail passed a literal 'ar' to basemapStyle, so /en and /de readers
  saw streets and towns in Arabic while a stay's own map used the page's language. The floor: no
  call to basemapStyle names a language as a string literal.
*/
const SRC = new URL('../', import.meta.url).pathname;

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry) ? [path] : [];
  });
}

describe('map labels', () => {
  it('never hard-codes the language a map is labelled in', () => {
    const offenders = sources(SRC).filter((file) =>
      /basemapStyle\([^)]*['"][a-z]{2}['"]\s*\)/.test(readFileSync(file, 'utf8')),
    );

    expect(offenders).toEqual([]);
  });

  /* A sweep that read nothing would pass a codebase it never saw. */
  it('reads the files that draw maps', () => {
    const files = sources(SRC).map((file) => file.slice(SRC.length));

    expect(files).toContain('components/search-map.tsx');
    expect(files).toContain('components/map-thumbnail.tsx');
  });
});
