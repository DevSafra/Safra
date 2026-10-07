import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { localeAlternates } from './alternates';

const PAGES = join(import.meta.dirname, '..', 'app', '[locale]');

function pages(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);

    if (statSync(path).isDirectory()) return pages(path);

    return entry === 'page.tsx' ? [path] : [];
  });
}

/** Canonical and hreflang (audit 2026-10-06). */
describe('localeAlternates', () => {
  it('names this locale as canonical and every locale plus x-default as alternates', () => {
    expect(localeAlternates('en', '/terms')).toStrictEqual({
      canonical: '/en/terms',
      languages: {
        ar: '/ar/terms',
        en: '/en/terms',
        de: '/de/terms',
        'x-default': '/ar/terms',
      },
    });
  });

  it('gives the home page its own address in each locale', () => {
    expect(localeAlternates('de', '')).toMatchObject({
      canonical: '/de',
      languages: { ar: '/ar', en: '/en', de: '/de', 'x-default': '/ar' },
    });
  });

  /* RELATIVE, so `metadataBase` (from NEXT_PUBLIC_SITE_URL) decides the origin: no domain in code. */
  it('writes no origin of its own', () => {
    const all = JSON.stringify(localeAlternates('ar', '/about'));

    expect(all).not.toMatch(/https?:/);
  });
});

/**
 * Every page meant to be found declares its own canonical and alternates through the helper.
 *
 * REGRESSION: the home page, the partner application, privacy and terms declared none and inherited
 * the layout's default, which named the HOME page as their alternates in three languages and gave
 * no canonical at all.
 */
describe('every indexable page', () => {
  const all = pages(PAGES);

  /*
    A page that is ALWAYS noindex, or an account screen, is not trying to be found. A page that is
    noindex only in one state (no trips yet, a trip that does not exist) still is, so only the
    unconditional shapes exempt one: a static `metadata` that says so, or a single `return` that
    sets the title and the noindex together.
  */
  const ALWAYS_NOINDEX =
    /ACCOUNT_METADATA|export const metadata[^;]*index:\s*false|return \{ title:[^\n]*robots: \{ index: false \} \}/;

  const indexable = all.filter(
    (path) => !ALWAYS_NOINDEX.test(readFileSync(path, 'utf8')),
  );

  it('finds the pages it is about, so an empty sweep cannot pass', () => {
    expect(indexable.length).toBeGreaterThanOrEqual(10);
  });

  it('declares its canonical and alternates through localeAlternates', () => {
    const missing = indexable.filter(
      (path) => !readFileSync(path, 'utf8').includes('localeAlternates('),
    );

    expect(missing.map((path) => path.replace(PAGES, ''))).toEqual([]);
  });

  it('never builds a canonical from the request slug', () => {
    const fromRequest = all.filter((path) =>
      /localeAlternates\([^)]*\$\{slug\}/.test(readFileSync(path, 'utf8')),
    );

    expect(fromRequest.map((path) => path.replace(PAGES, ''))).toEqual([]);
  });

  /* The default that leaked onto every page that forgot one. */
  it('inherits no alternates from the locale layout', () => {
    const layout = readFileSync(join(PAGES, 'layout.tsx'), 'utf8');

    expect(layout).not.toMatch(/alternates:\s*\{/);
  });
});
