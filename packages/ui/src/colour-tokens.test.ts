import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every colour class names a colour that exists.
 *
 * ## What went wrong
 *
 * `bg-gold text-ink` on the confirm dialog's «تأكيد» button — in `packages/ui`, so on every
 * non-danger confirmation in all three apps. **There is no `--color-ink`.** Tailwind v4 generates
 * a colour utility only when the theme variable backing it exists, so `.text-ink` was never in any
 * stylesheet and the button had no ink colour of its own: it inherited `--color-text`, which in the
 * dark theme is cream on light gold at **1.54:1**. Seven buttons across the three apps said it —
 * the console's «ابدأ محادثة» and geo form, the partner's payout-account save and coupon decision,
 * the customer's 404 call to action and «ابحث عن حجزك», and every confirm dialog.
 *
 * Nothing could see it. Typescript does not read class strings, the linter has no palette, the
 * class LOOKED like a decision, and the contrast sweep walks static screens so it never opened a
 * dialog. It rendered as «the same colour as the surrounding text», which on most screens is
 * plausible enough to survive review.
 *
 * ## What this holds
 *
 * A colour utility whose value is a bare word — `text-gold`, `bg-bad`, `border-line` — must name a
 * token some app declares, or a colour keyword the framework defines. `text-ink` is neither, and
 * neither is a token that was renamed in one app and left behind in another.
 *
 * The token set is the UNION across the three apps rather than per-app, deliberately: `packages/ui`
 * is shared and cannot know which app renders it, so a class that resolves in one and not another
 * is a real defect this cannot distinguish from a correct one. What it does catch is a name that
 * exists NOWHERE, which is the whole of the failure above.
 *
 * ## The floor
 *
 * Bare words only. `text-[#abc]`, `bg-gold/40` and `text-red-500` are the framework's business and
 * are skipped, as is anything built by string concatenation — a class assembled from a variable is
 * invisible here, the same way it is invisible to Tailwind's own scanner.
 *
 * **Comments and arbitrary values are stripped before matching**, and both had to be: a CSS
 * property name is spelt exactly like a colour class. `transition-[color,border-color]` offered
 * `border-color` seven times, `[transform-box:fill-box]` offered `fill-box`, and prose about a
 * «from-state» offered that — enough noise to bury the eight real ones underneath, which is how an
 * assertion stops being read.
 */
const ROOT = new URL('../../../', import.meta.url).pathname;

const APPS = ['apps/admin/src', 'apps/web/src', 'apps/partner/src', 'packages/ui/src'];

const STYLESHEETS = [
  'apps/admin/src/app/globals.css',
  'apps/web/src/app/globals.css',
  'apps/partner/src/app/globals.css',
];

/**
 * The prefixes that take a COLOUR, and only those.
 *
 * `shadow-` and `ring-` are left out on purpose: both take a size as readily as a colour
 * (`shadow-sm`, `ring-2`), so including them would mean listing the size scale to avoid drowning
 * this in false positives, and neither has ever carried a palette token here.
 */
const COLOUR_PREFIXES = [
  'text',
  'bg',
  'border',
  'fill',
  'stroke',
  'outline',
  'decoration',
  'caret',
  'accent',
  'divide',
  'placeholder',
  'from',
  'via',
  'to',
];

/**
 * Words these prefixes take that are NOT colours.
 *
 * Tailwind overloads every one of them — `text-sm` is a size, `text-start` an alignment,
 * `bg-cover` a background-size, `border-dashed` a style. They are listed rather than pattern-matched
 * because a pattern loose enough to cover them is loose enough to cover `ink`.
 */
const NOT_A_COLOUR = new Set([
  // shared
  'transparent',
  'current',
  'inherit',
  'none',
  'auto',
  'white',
  'black',
  // text-
  'xs',
  'sm',
  'base',
  'lg',
  'xl',
  'left',
  'right',
  'center',
  'justify',
  'start',
  'end',
  'wrap',
  'nowrap',
  'balance',
  'pretty',
  'clip',
  'ellipsis',
  // bg-
  'cover',
  'contain',
  'fixed',
  'local',
  'scroll',
  'top',
  'bottom',
  'repeat',
  'blend',
  'origin',
  'clip2',
  'no',
  // border- / divide- / outline- / decoration-
  'solid',
  'dashed',
  'dotted',
  'double',
  'hidden',
  'collapse',
  'separate',
  'spacing',
  'wavy',
  'line',
  'through',
  'x',
  'y',
  's',
  'e',
  't',
  'r',
  'b',
  'l',
  // stroke- / fill-
  'width',
]);

/** `text-gold`, but not `text-gold/40`, `text-[#abc]`, `text-red-500` or `md:text-sm`. */
const COLOUR_CLASS = new RegExp(
  `(?<![\\w-])(${COLOUR_PREFIXES.join('|')})-([a-z][a-z0-9]*)(?![\\w./[-])`,
  'g',
);

/**
 * The file with its COMMENTS and ARBITRARY VALUES removed.
 *
 * A CSS property name is spelt exactly like a colour utility — `border-color` inside
 * `transition-[color,border-color]` is not a class, and neither is `fill-box` inside
 * `[transform-box:fill-box]`. Comments go for the same reason: this file's own prose names
 * `text-ink` while explaining that it must not exist.
 */
function classAttributes(body: string): string {
  return body
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
    .replace(/\[[^\]]*\]/g, ' ');
}

/**
 * The tones that can be a SOLID ground under a label, and the ink each one needs.
 *
 * Measured from the palette on 2026-09-08, every combination, both themes, against the 4.5:1 floor
 * a button label under 18.66px bold has to clear:
 *
 * ```
 * tone    | text-bg dark  text-bg light | text-ink dark  text-ink light | ink it needs
 * gold    |       10.98         3.56 !  |        10.98           5.08   | text-ink
 * ok      |        9.54         4.72    |         9.54           3.83 ! | text-bg
 * bad     |        5.90         4.77    |         5.90           3.79 ! | text-bg
 * pend    |        6.87         5.32    |         6.87           3.40 ! | text-bg
 * teal    |        9.75         5.33    |         9.75           3.39 ! | text-bg
 * orange  |        7.13         5.33    |         7.13           3.39 ! | text-bg
 * warn    |        9.22         4.14 !  |         9.22           4.36 ! | NEITHER
 * ```
 *
 * **`text-bg` for every tone but gold, and `text-ink` for gold.** The reason is not taste: every
 * tone inverts between themes, and for six of them the light value is dark enough that the light
 * page colour reads on it. Gold's is not — #a87a1f takes white to 3.84:1 and the page's near-white
 * to 3.56:1 — so gold needs an ink that does NOT follow the theme, which is what `--color-ink` is.
 *
 * `text-white` is never right: it fails on every tone in the dark theme, where the tones are light.
 * Three buttons said it, including the emergency console's submit at 3.31:1.
 *
 * **`warn` clears the floor with NEITHER ink**, and it is in the list below anyway so that a warn
 * ground carrying `text-white` still fails. Nothing is broken today — the one solid `bg-warn` is
 * the password strength BAR, which carries no text — and a future warn button needs the token
 * darkened first. Same decision as finding 229, same owner.
 *
 * ## Why this checks two shapes rather than mapping every tone to its ink
 *
 * A LINE is not an element. `mode === 'approve' ? 'bg-ok' : 'bg-bad'` puts the ground on one line
 * and its `text-bg` three lines above, and a decorative ground — the password meter's bar, the
 * setting toggle's track, a chart column on التقارير — has no label at all and needs no ink. A map
 * from tone to required ink reported all five of those as defects, which is the noise that gets a
 * test disabled rather than read.
 *
 * So this asserts only what a LINE can prove: an ink that is present and wrong. `text-white` on any
 * tone, and `text-bg` on gold. Those are the two shapes that were actually there, and the browser
 * sweep in `e2e/contrast.spec.ts` measures the rendered result for everything else.
 */
const SOLID_TONES = ['gold', 'ok', 'bad', 'warn', 'pend', 'teal', 'orange'];

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

function declaredTokens(): Set<string> {
  const out = new Set<string>();

  for (const sheet of STYLESHEETS) {
    const css = readFileSync(join(ROOT, sheet), 'utf8');

    for (const [, name] of css.matchAll(/--color-([a-z][a-z0-9-]*)\s*:/g)) {
      out.add(name as string);
    }
  }

  return out;
}

describe('colour classes', () => {
  it('every colour class names a colour that exists', () => {
    const tokens = declaredTokens();
    const dangling: string[] = [];

    for (const app of APPS) {
      for (const file of sources(app)) {
        const body = classAttributes(readFileSync(join(ROOT, file), 'utf8'));

        for (const [whole, , word] of body.matchAll(COLOUR_CLASS)) {
          const name = word as string;

          if (tokens.has(name) || NOT_A_COLOUR.has(name)) continue;

          dangling.push(`${file} — ${whole}`);
        }
      }
    }

    expect(dangling.sort(), 'these classes name a colour no stylesheet declares').toEqual(
      [],
    );
  });

  it('a solid tone ground never carries an ink that cannot be read on it', () => {
    const wrong: string[] = [];
    const ground = new RegExp(`bg-(${SOLID_TONES.join('|')})(?![/\\w-])`);

    for (const app of APPS) {
      for (const file of sources(app)) {
        const body = classAttributes(readFileSync(join(ROOT, file), 'utf8'));

        for (const line of body.split('\n')) {
          const tone = ground.exec(line);

          if (tone === null) continue;

          const say = (why: string): string =>
            `${file} — bg-${tone[1]} ${why}: ${line.trim().slice(0, 90)}`;

          if (/(?<![\w-])text-white(?![\w-])/.test(line)) {
            wrong.push(
              say('with text-white, which fails on every tone in the dark theme'),
            );
          }

          if (tone[1] === 'gold' && /(?<![\w-])text-bg(?![\w-])/.test(line)) {
            wrong.push(
              say(
                'with text-bg, which is 3.56:1 in the light theme — gold takes text-ink',
              ),
            );
          }
        }
      }
    }

    expect(wrong.sort(), 'these labels cannot be read on the tone behind them').toEqual(
      [],
    );
  });

  /*
    The control. A sweep that matched nothing would report perfect health, and this one is a regex
    over class strings — the easiest kind of test to write inert. Asserting on the tokens it
    RESOLVED proves it is reading real class attributes and not scrolling past them.
  */
  it('reads the classes it is meant to be checking', () => {
    const tokens = declaredTokens();
    const seen = new Set<string>();

    for (const app of APPS) {
      for (const file of sources(app)) {
        const body = classAttributes(readFileSync(join(ROOT, file), 'utf8'));

        for (const [, , word] of body.matchAll(COLOUR_CLASS)) {
          if (tokens.has(word as string)) seen.add(word as string);
        }
      }
    }

    expect(
      seen.size,
      'the sweep resolved almost no palette tokens, so it is reading nothing',
    ).toBeGreaterThan(10);
    expect([...seen]).toContain('gold');
  });
});
