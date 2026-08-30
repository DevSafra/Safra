import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The browser's own popup is never used, anywhere.
 *
 * ## What Bashar saw
 *
 * A screenshot, 2026-08-30: a grey box reading **localhost:3001**, an Arabic question, and two
 * buttons saying **Cancel** and **OK**. That is `window.confirm`, and three things are wrong with
 * it at once — it shows the reader the ORIGIN, which is chrome no operator should meet; its buttons
 * are English and cannot be translated, which is the one thing `docs/i18n.md` exists to prevent;
 * and it looks like nothing else in the product. There were five, across the console and the
 * partner portal.
 *
 * `confirm`, `alert` and `prompt` also BLOCK the main thread, so nothing renders underneath them
 * and no state settles while they are open — a modal React cannot see.
 *
 * ## The floor
 *
 * A literal `window.confirm(`, `window.alert(` or `window.prompt(`. Somebody determined to call it
 * through an alias walks past; what this catches is what a person reaches for.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

const NATIVE = ['window.confirm(', 'window.alert(', 'window.prompt('];

function sources(dir: string): string[] {
  const out: string[] = [];

  for (const entry of readdirSync(join(ROOT, dir))) {
    const relative = `${dir}/${entry}`;

    if (statSync(join(ROOT, relative)).isDirectory()) {
      out.push(...sources(relative));
    } else if (entry.endsWith('.tsx') || entry.endsWith('.ts')) {
      out.push(relative);
    }
  }

  return out;
}

describe('one popup, and it is ours', () => {
  it('calls no native dialog anywhere', () => {
    const offenders = APPS.flatMap(sources).filter((file) => {
      /* A test may name them to prove they are gone; source may not call them. */
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return false;

      const text = readFileSync(join(ROOT, file), 'utf8');

      return NATIVE.some((call) => text.includes(call));
    });

    expect(
      offenders,
      'These call the browser popup, which shows the origin and answers in English. Use ' +
        '`useConfirm()` from `@safra/ui` — see the rule in .claude/CLAUDE.md.',
    ).toEqual([]);
  });

  /** A sweep whose corpus is empty reports a clean bill of health for a codebase it never read. */
  it('actually reads the three apps', () => {
    const files = APPS.flatMap(sources);

    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('packages/ui/src/confirm-dialog.tsx');
    expect(files.some((file) => file.startsWith('apps/partner/src'))).toBe(true);
  });
});
