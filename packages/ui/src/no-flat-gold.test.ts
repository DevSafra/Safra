import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A gold button is the gradient primary, `.btn-gold`, and it is the same button in all three apps.
 *
 * ## What Bashar saw
 *
 * A screenshot, 2026-10-04: «تأكيد», a flat `#a87a1f` block under near-black text — the confirm of
 * the shared popup — and «I never want to see same as it on the entire system». He had rejected
 * the flat fill once already (2026-09-10: every gold button carries the gradient); three buttons
 * kept it because they painted with Tailwind's `bg-gold` utility instead of the class, and nothing
 * looked at the utility.
 *
 * ## The two floors
 *
 * 1. **No flat gold behind text.** A class string holding the bare `bg-gold` token together with a
 *    text colour meant to sit on it (`text-ink`, `text-bg`) is that button. `rounded-full` is let
 *    through, because a pill of that shape is a count badge or a dot, not a control; `bg-gold/10`
 *    and `hover:bg-gold/…` are tints and never match the bare token.
 * 2. **One finish.** The rules that paint `.btn-gold` are written into each app's `globals.css`,
 *    and the console and the partner portal had only the gradient while the customer site had the
 *    bevel, the shadow, the lift and the press. The popup lives in `@safra/ui` and is drawn by all
 *    three, so «تأكيد» looked different depending on which app opened it. The rule sets must now
 *    match, declaration for declaration.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

const STYLESHEETS = [
  'apps/web/src/app/globals.css',
  'apps/admin/src/app/globals.css',
  'apps/partner/src/app/globals.css',
];

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

/** Every quoted or back-ticked run in a file — the places a class list can live. */
function strings(text: string): string[] {
  return [...text.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`/g)].map((match) => match[0]);
}

/** `bg-gold` as a whole class, not `bg-gold/10`, `bg-gold-read` or `hover:bg-gold`. */
const FLAT_GOLD = /(?<![\w:/-])bg-gold(?![\w/-])/;
const TEXT_ON_GOLD = /(?<![\w:/-])text-(?:ink|bg)(?![\w/-])/;

/**
 * The `.btn-gold` rules of one stylesheet, comments stripped and whitespace collapsed, so two files
 * that say the same thing compare equal however they are indented.
 */
function goldRules(file: string): string[] {
  const css = readFileSync(join(ROOT, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rules: string[] = [];

  /* Walk the braces so a rule inside `@media` keeps its at-rule as context. */
  let depth = 0;
  let start = 0;
  const context: string[] = [];

  for (let i = 0; i < css.length; i += 1) {
    if (css[i] === '{') {
      const prelude = css.slice(start, i).trim();

      context[depth] = prelude;
      depth += 1;
      start = i + 1;
    } else if (css[i] === '}') {
      depth -= 1;

      const selector = context[depth] ?? '';
      const body = css.slice(start, i).trim();

      if (/\.btn-gold(?![\w-])/.test(selector) && body !== '') {
        const at = context.slice(0, depth).join(' ');

        rules.push(`${at} ${selector} { ${body} }`.replace(/\s+/g, ' ').trim());
      }

      start = i + 1;
    }
  }

  return rules;
}

describe('one gold button', () => {
  it('paints no flat gold behind text anywhere', () => {
    const offenders = APPS.flatMap(sources).flatMap((file) => {
      if (file.endsWith('.test.ts') || file.endsWith('.test.tsx')) return [];

      return strings(readFileSync(join(ROOT, file), 'utf8'))
        .filter(
          (run) =>
            FLAT_GOLD.test(run) &&
            TEXT_ON_GOLD.test(run) &&
            !run.includes('rounded-full'),
        )
        .map((run) => `${file}: ${run.slice(0, 90)}`);
    });

    expect(
      offenders,
      'A flat `bg-gold` fill under text is the button Bashar rejected. Use `btn-gold`, the ' +
        'gradient primary each app defines in its globals.css.',
    ).toEqual([]);
  });

  it('gives `.btn-gold` the same finish in all three apps', () => {
    const [web, ...others] = STYLESHEETS.map(goldRules);

    /* The bevel, the hover lift, the press and the night shadow — not merely the gradient. */
    expect(
      web?.some((rule) => rule.includes(':active') && rule.includes('scale(0.97)')),
    ).toBe(true);

    for (const [index, rules] of others.entries()) {
      expect(rules, `${STYLESHEETS[index + 1]} paints .btn-gold differently`).toEqual(
        web,
      );
    }
  });

  /*
    The shared rules paint their shadow from two variables, because the apps disagree about which
    theme is the default (the site is light unless told otherwise, the console and the portal are
    night). Each app must set both, for its default theme AND its other one, or a theme falls back
    to no shadow at all, or to the other theme's glow.
  */
  it('sets the gold shadow for both themes in every app', () => {
    for (const sheet of STYLESHEETS) {
      const css = readFileSync(join(ROOT, sheet), 'utf8').replace(
        /\/\*[\s\S]*?\*\//g,
        '',
      );

      for (const name of ['--btn-gold-shadow:', '--btn-gold-shadow-hover:']) {
        expect(
          css.split(name).length - 1,
          `${sheet} sets ${name} for fewer than two themes`,
        ).toBe(2);
      }

      expect(css, `${sheet} sets no other-theme block`).toMatch(
        /:root\[data-theme='(?:light|dark)'\]\s*\{\s*--btn-gold-shadow:/,
      );
    }
  });

  /** A sweep whose corpus is empty reports a clean bill of health for a codebase it never read. */
  it('actually reads the three apps and their stylesheets', () => {
    const files = APPS.flatMap(sources);

    expect(files.length).toBeGreaterThan(200);
    expect(files).toContain('packages/ui/src/confirm-dialog.tsx');

    for (const sheet of STYLESHEETS) {
      expect(goldRules(sheet).length, `${sheet} defines no .btn-gold`).toBeGreaterThan(0);
    }
  });
});
