import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * There is ONE image previewer, and this is what stops a second one appearing.
 *
 * Standing instruction from Bashar (2026-08-30). Four surfaces showed photographs four ways before
 * `ImageSlider` — a real lightbox on the console's property review, a raw file in a new tab for
 * dispute evidence, a bare tile in the partner's image manager, and three-of-fourteen on the
 * customer's property page. Each had learnt the keyboard and focus lessons separately, or not at
 * all, and nothing would have stopped a fifth.
 *
 * ## What it looks for
 *
 * A file that draws a `role="dialog"` around an `<img>` and does NOT import the slider. That is
 * the shape of a hand-rolled previewer, and phrasing it as «must import the shared one» rather
 * than «must not contain a dialog» is what keeps it free of an exemption list — an exemption list
 * decays in the direction of hiding things, and the first entry would have been the ad creative's
 * EDIT dialog, which merely happens to contain a thumbnail.
 *
 * It is a FLOOR, not a ceiling: a previewer built out of a `<details>`, one whose picture is a
 * background style, or one that imports the slider and then ignores it, all walk past. What it
 * catches is the shape somebody actually reaches for.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

/** The slider itself: it IS the dialog, so it cannot be asked to import one. */
const SLIDER = 'packages/ui/src/image-slider.tsx';

function sources(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) {
      out.push(...sources(relative));
    } else if (entry.endsWith('.tsx')) {
      out.push(relative);
    }
  }

  return out;
}

describe('one image previewer, used everywhere', () => {
  it('has no hand-rolled lightbox outside @safra/ui', () => {
    const offenders = APPS.flatMap(sources).filter((file) => {
      if (file === SLIDER) return false;

      const text = readFileSync(join(ROOT, file), 'utf8');

      if (!text.includes('role="dialog"') || !text.includes('<img')) return false;

      /*
        The IMPORT, not a mention.

        This read `text.includes('ImageSlider')` first, and a mutation that replaced the frame with
        a hand-rolled dialog walked straight past it — the file still had the word in a COMMENT
        explaining which component it used. A sweep satisfied by prose is not a sweep.
      */
      return !/import\s*\{[^}]*ImageSlider[^}]*\}\s*from\s*'@safra\/ui'/.test(text);
    });

    expect(
      offenders,
      'These files draw a dialog around an image. Use `ImageSlider` or `ImageSliderFrame` from ' +
        '`@safra/ui` — see the rule in .claude/CLAUDE.md.',
    ).toEqual([]);
  });

  /**
   * The sweep has to be able to FAIL, and a list of files it never reads cannot.
   *
   * `no-bare-amounts` learnt this the hard way: a sweep whose corpus is empty reports a clean bill
   * of health for a codebase it never opened.
   */
  it('actually reads the three apps', () => {
    const files = APPS.flatMap(sources);

    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('packages/ui/src/image-slider.tsx');
    expect(files.some((file) => file.startsWith('apps/web/src'))).toBe(true);
    expect(files.some((file) => file.startsWith('apps/partner/src'))).toBe(true);
  });
});
