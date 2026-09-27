import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every popup says what it is — once.
 *
 * ## The defect
 *
 * `Modal`'s `title` docblock read «The accessible name. Rendered as the heading unless the caller
 * draws its own», and the component rendered it NOWHERE: it became an `aria-label` and nothing
 * else. So a caller that trusted the sentence got a popup with no heading at all. Bashar
 * screenshotted one on 2026-09-27 — the customer site's language picker, a white box holding a
 * list and a close button with nothing naming it — and the console's landmark and landmark-kind
 * editors had the same hole.
 *
 * It is the shape this codebase keeps rediscovering: a comment describing an intention, read and
 * believed, while the code does something else. Nothing could catch it — the popup rendered, the
 * accessible name was correct, and every test passed.
 *
 * ## Why a sweep and not a render test
 *
 * A render test of `Modal` would prove `Modal` draws a heading and say nothing about the eight
 * places that use it. The failure was distributed: the shell's behaviour and each caller's
 * expectation of it, drifting apart. So this asserts the CONTRACT both sides depend on:
 *
 * - The shell draws the title when the caller has not said it draws its own.
 * - «has not said» is `labelledBy`, and a caller that draws its own heading passes it — otherwise
 *   the same words render twice, once seen and once announced.
 *
 * The three geography editors were in exactly that state before this: a visible `Panel` heading AND
 * a duplicate `title` as the dialog's accessible name.
 */
const UI = join(process.cwd(), 'packages/ui/src');

const MODAL = readFileSync(join(UI, 'modal.tsx'), 'utf8');

/** Every file in the three apps and the shared packages that mounts a `Modal`. */
function callers(): { path: string; source: string }[] {
  const roots = ['apps/web/src', 'apps/admin/src', 'apps/partner/src', 'packages/ui/src'];
  const found: { path: string; source: string }[] = [];

  const walk = (at: string): void => {
    for (const entry of readdirSync(at, { withFileTypes: true })) {
      const path = join(at, entry.name);

      if (entry.isDirectory()) {
        walk(path);
        continue;
      }

      if (!entry.name.endsWith('.tsx') || entry.name.includes('.test.')) continue;

      const source = readFileSync(path, 'utf8');

      /* The definition itself is not a caller. */
      if (source.includes('<Modal') && !source.includes('export function Modal(')) {
        found.push({ path: path.replace(`${process.cwd()}/`, ''), source });
      }
    }
  };

  for (const root of roots) walk(join(process.cwd(), root));

  return found;
}

describe('the shared popup', () => {
  /**
   * The shell draws the heading, and it is a HEADING.
   *
   * `<h2>`, not a styled paragraph: a dialog's name belongs in the document outline, which is how
   * somebody navigating by heading finds the top of a long one.
   */
  it('renders the title as a heading', () => {
    expect(MODAL).toMatch(/<h2\s+id=\{headingId\}/);
    expect(MODAL, 'and the accessible name is that heading').toContain(
      "{ 'aria-labelledby': headingId }",
    );
  });

  /**
   * A SHEET never gets one, and that is the one carve-out.
   *
   * It drops from the bar it belongs to and that bar stays visible above it, so a heading inside
   * repeats the control the reader has just pressed. The phone menu is the only sheet today.
   */
  it('draws no heading on a sheet', () => {
    expect(MODAL).toContain('const ownHeading = !sheet && !labelledBy;');
  });

  /**
   * THE sweep. A caller that draws its own heading says so, or the words render twice.
   *
   * The heuristic is deliberately blunt — a `<Panel heading=` or an `<h1>`/`<h2>`/`<h3>` anywhere
   * in a file that mounts a `Modal`. A false positive costs one `labelledBy`; a false negative is
   * a popup announcing its name twice, which nobody notices by looking.
   */
  it('has no caller that draws a heading without claiming it', () => {
    const offenders = callers()
      .filter(({ source }) => {
        if (source.includes('labelledBy')) return false;

        const at = source.indexOf('<Modal');
        const within = source.slice(at, at + 2600);

        return /<h[123]\b|<Panel\b|heading=/.test(within);
      })
      .map(({ path }) => path);

    expect(
      offenders,
      'a popup that draws its own heading must pass `labelledBy` at it, or `Modal` draws a second one',
    ).toEqual([]);
  });

  /** And every caller names its popup. A dialog with no `title` has no accessible name at all. */
  it('has no caller that opens a popup with no title', () => {
    const offenders = callers()
      .filter(({ source }) => {
        const at = source.indexOf('<Modal');
        const within = source.slice(at, at + 900);

        return !/\btitle=/.test(within);
      })
      .map(({ path }) => path);

    expect(offenders, 'every popup names itself').toEqual([]);
  });
});
