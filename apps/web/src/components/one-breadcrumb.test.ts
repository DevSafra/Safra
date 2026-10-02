import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * There is ONE breadcrumb trail, and this is what stops a second one appearing.
 *
 * Bashar, 2026-10-01: «make it solid, so everywhere on the entire system it looks same». Five pages
 * had drawn their own trail in two looks, and nothing would have stopped a sixth. The shape somebody
 * reaches for is a `<nav>` named by a `breadcrumb` catalogue key, or the drawn chevron itself, so
 * either outside `breadcrumb.tsx` fails. A FLOOR, not a ceiling: a trail named by some other key
 * walks past.
 */
const ROOT = new URL('../../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

const TRAIL = 'apps/web/src/components/breadcrumb.tsx';
const ICONS = 'apps/web/src/components/icons.tsx';

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;
    if (statSync(join(ROOT, relative)).isDirectory()) out.push(...sources(relative));
    else if (entry.endsWith('.tsx')) out.push(relative);
  }
  return out;
}

const read = (file: string) => readFileSync(join(ROOT, file), 'utf8');

describe('one breadcrumb trail, used everywhere', () => {
  it('has no hand-rolled trail outside the shared component', () => {
    const offenders = APPS.flatMap(sources).filter((file) => {
      if (file === TRAIL || file === ICONS) return false;
      const text = read(file);
      return (
        text.includes('BreadcrumbChevron') ||
        /<nav[^>]*aria-label=\{\s*\w+\(\s*'breadcrumb'\s*\)/.test(text)
      );
    });

    expect(
      offenders,
      'These files draw their own breadcrumb. Use `Breadcrumb` from `@/components/breadcrumb`.',
    ).toEqual([]);
  });

  it('is the trail on every page that has one', () => {
    const pages = ['property', 'city', 'landmark', 'groups'].map((section) =>
      sources(`apps/web/src/app/[locale]/${section}`).filter((file) =>
        file.endsWith('page.tsx'),
      ),
    );
    /*
      «الإقامات» draws its trail in the results component it shares with the city pages, which
      render their own trail in the hero instead (the city is already the page's subject there).
    */
    const users = [
      ...pages.flat(),
      'apps/web/src/components/search/stay-results.tsx',
    ].filter((file) =>
      /import \{ Breadcrumb \} from '@\/components\/breadcrumb'/.test(read(file)),
    );

    /* The sweep has to be able to fail: a corpus it never opened reports a clean bill of health. */
    expect(users).toHaveLength(5);
  });

  it('marks the current page bold, not merely coloured', () => {
    expect(read(TRAIL)).toMatch(/aria-current="page" className="[^"]*\bfont-bold\b/);
  });
});
