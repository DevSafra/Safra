import { expect, test, type Page } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

/**
 * Every word in all THREE applications is readable, measured rather than assumed.
 *
 * Bashar, 2026-09-02: «the text colour on the entire website is too light and hard to read. Please
 * keep in mind to make the website comfortable and easy to use for really every person on the
 * earth.» He was right, and it was two tokens: `--color-faint` sat at **3.07:1** and
 * `--color-gold`, used for prices, badges and the wordmark, at **3.09:1**. Seven more inks were
 * between 3.5 and 4.2. WCAG AA asks 4.5:1 for body text.
 *
 * ## Why this walks the DOM instead of checking the tokens
 *
 * A token audit proves what the palette says. This proves what a person sees — the colour that
 * actually landed on the element after every utility, every `/60` opacity and every inherited
 * value, against the background that is actually behind it. Those two answers came apart twice in
 * one day: `text-text2` resolved to an inherited colour because the customer app never defined the
 * token, and a `--shadow-*` override was silently inlined by Tailwind. The palette is not the page.
 *
 * ## The floors
 *
 * 4.5:1 for body text and 3:1 for large text, which is WCAG AA — the legal floor in most of the
 * markets this platform serves. `--color-text` measures 12.6:1 and `--color-muted` 4.81:1, both at
 * the handoff's own values. Two ink colours sit below the floor by the client's explicit decision
 * and are listed in `SIGNED_OFF` with their numbers; everything else must clear it.
 *
 * ## What extending it to the staff surfaces found (2026-09-08)
 *
 * This checked the customer site only, and the console and the portal had never been measured. The
 * first run over them read **217 nodes below the floor in the console's dark theme and 544 in its
 * light one**, on screens that had all been looked at by eye. Three causes, all now fixed:
 *
 * - **`--color-faint2`, the decorative step, carrying real sentences** — 85 places, at 2.31:1 light
 *   and 2.15:1 dark. One of them was the dispute privacy note an operator reads before releasing a
 *   guest's file. The token is deleted; a colour named like the reading tones reads like one.
 * - **`text-white` on a solid tone** — white fails on every tone in the DARK theme, where the tones
 *   are the light ones. The emergency console's submit button measured 3.31:1.
 * - **`bg-gold text-bg`** on thirty-six primary buttons — 3.56:1 in the light theme, because gold
 *   inverts between themes and so does `bg`, so the label followed the ground instead of opposing
 *   it. `--color-ink` is fixed rather than themed and reads on both golds (10.98:1 and 5.08:1).
 *
 * Note what SIGNED_OFF is and is not, because the third of those looks like it contradicts it and
 * does not: the signed-off decision is about **gold TEXT on a page**, where the only fix would be
 * darkening the brand. A dark label ON a gold button leaves the gold exactly as it is.
 */
/** One page per shape: marketing, results, a record, prose, a form. */
const CUSTOMER = [
  '/ar',
  '/ar/search?checkIn=2026-09-03&checkOut=2026-09-04&adults=2',
  '/ar/city/damascus',
  '/ar/property/qasr-al-sharq-apartments',
  '/ar/login',
  '/ar/terms',
];

/** Every section of the staff console. */
const CONSOLE = [
  '/',
  '/bookings',
  '/partners',
  '/properties',
  '/customers',
  '/staff',
  '/payments',
  '/wallet',
  '/giftcards',
  '/coupons',
  '/geo',
  '/reports',
  '/settings',
  '/audit',
  '/disputes',
  '/messages',
  '/reviews',
  '/payouts',
  '/treasury',
  '/ads',
  '/catalogue',
  '/applications',
  '/emergency',
];

/** Every screen a partner has. */
const PORTAL = [
  '/',
  '/properties',
  '/calendars',
  '/arrivals',
  '/contracts',
  '/coupons',
  '/disputes',
  '/employees',
  '/employee-roles',
  '/payouts',
  '/payouts/accounts',
  '/reviews',
  '/support',
  '/violations',
];

/**
 * The one ink still signed off below the AA floor, and why.
 *
 * ## The gold was decided on 2026-09-08, and is no longer here
 *
 * Finding 229 asked whether SAFRA's gold should be darkened, left alone, or split. Bashar chose the
 * split: _«Please keep the existing SAFRA gold branding colour unchanged. I do not want the primary
 * brand colour changed globally. However, I agree with introducing a secondary accessibility-safe
 * gold variant for small text elements where the current gold does not meet readability
 * requirements.»_ — brand gold for decoration, large headings, branding and highlights;
 * `--color-gold-read` (#805d18, the brand hue darkened) for small text, prices, labels, chips and
 * metadata.
 *
 * So `--gold` came OFF this list and every small gold word moved to the readable token. What the
 * check enforces now is exactly his rule: brand gold is fine at display sizes, because the floor
 * there is 3:1 and it measures 3.09:1 at its worst — and it fails the moment it is used on
 * something small, which is the mistake the split exists to prevent.
 *
 * ## `--warn` is still here, and deliberately
 *
 * | token     | value     | worst measured | where it shows                              |
 * |-----------|-----------|----------------|---------------------------------------------|
 * | `--warn`  | `#9E6E15` | 4.14:1         | status pills — «بانتظار الدفع», «قيد المعالجة» |
 *
 * It misses by a hair (4.47:1 on white, 4.14:1 on a field) and the obvious fix collides with the
 * one just made: darkened to clear 4.5 on every ground it lands on, `--warn` becomes **#835c11**
 * against the readable gold's **#805d18** — three points of red apart, indistinguishable. `--warn`
 * is a STATUS colour, and «no two statuses on one screen share a colour» is a standing rule with
 * its own suite behind it, so this is not a colour to nudge on the way past. Reported for a
 * decision rather than taken.
 *
 * **This is an allow-list of COLOURS, not a switch that turns the check off.** Any other foreground
 * under its floor still fails, so a new low-contrast colour cannot arrive unnoticed — which is the
 * only thing that makes a documented exception different from an abandoned rule. `--muted` is
 * deliberately NOT here: at the handoff's own `#5C6377` it measures 4.81:1 and passes.
 *
 * **`--color-ink` is a third thing, despite the name.** It is the ink that goes ON a gold surface —
 * a dark label on a gold button — and it changes what sits on the gold, never the gold.
 */
const SIGNED_OFF = new Set([
  'rgb(158, 110, 21)', // --warn
]);

interface Failure {
  ratio: number;
  floor: number;
  size: number;
  colour: string;
  on: string;
  sample: string;
  where: string;
}

/**
 * Walks every visible run of text and reports the ones under their floor.
 *
 * The background is the first ancestor with a background that is actually opaque — a colour is
 * read against what is behind it, and "behind it" is rarely the element itself.
 */
async function unreadable(page: Page): Promise<Failure[]> {
  /*
    The allow-list is passed ACROSS the boundary, not closed over: `page.evaluate` runs its function
    in the browser, where nothing from this module exists. The first version referenced it directly
    and every run died with «SIGNED_OFF is not defined» — a failure that looks like a contrast
    problem and is not one.
  */
  return page.evaluate(
    (signedOff: readonly string[]) => {
      const allowed = new Set(signedOff);
      const canvas = document.createElement('canvas');

      canvas.width = 1;
      canvas.height = 1;

      const paint = canvas.getContext('2d', { willReadFrequently: true });

      /* Any CSS colour to real sRGB, by letting the browser resolve it. `oklab()` and alpha both
       arrive here, and neither can be parsed out of the string by hand. */
      const rgb = (colour: string, over?: string): [number, number, number] => {
        if (!paint) return [0, 0, 0];

        paint.clearRect(0, 0, 1, 1);

        if (over) {
          paint.fillStyle = over;
          paint.fillRect(0, 0, 1, 1);
        }

        paint.fillStyle = colour;
        paint.fillRect(0, 0, 1, 1);

        const data = paint.getImageData(0, 0, 1, 1).data;

        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0];
      };

      const luminance = ([r, g, b]: [number, number, number]) => {
        const channel = (value: number) => {
          const s = value / 255;

          return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
        };

        return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
      };

      const contrast = (fg: [number, number, number], bg: [number, number, number]) => {
        const [high, low] = [luminance(fg), luminance(bg)].sort((a, b) => b - a);

        return ((high ?? 0) + 0.05) / ((low ?? 0) + 0.05);
      };

      /*
        Every colour the text might be sitting on, WORST one first is the caller's problem.

        A gradient has no single ratio, and the two obvious answers are both wrong. Walking PAST it
        to the colour behind reports the page behind a button as the button's own ground: the gold
        call-to-action is `linear-gradient(135deg,#F0CB7C,#C4923E)` with a `#241A05` label, and
        reading through it scored the dark ink against the dark PAGE at 1.04:1 — fifteen findings
        across all three apps, every one a control a person reads perfectly well. SKIPPING it
        instead drops real coverage: three of the five gradients behind text on this platform are
        page BANDS, including the hero's `radial-gradient`, so skipping would stop checking the
        headline and subtitle that sit on it.

        So the stops are measured. The browser normalises every stop to `rgb(...)`, so they can be
        read straight out of the computed value, and the caller scores the text against ALL of them
        and keeps the worst. Conservative by construction, and it needs no allow-list: a NEW
        gradient surface is measured the day it appears rather than exempted until somebody notices.

        The gradient-FILLED hero headline is still skipped, above, and for a different reason — its
        text has no colour of its own to measure.
      */
      const grounds = (element: Element): string[] | null => {
        let node: Element | null = element;

        while (node && node !== document.documentElement) {
          const style = getComputedStyle(node);

          if (style.backgroundImage !== 'none') {
            const stops = style.backgroundImage.match(/rgba?\([^)]*\)/g);

            /* A photograph or an `image-set` has no stops to read. Nothing on this platform puts
               text straight onto one, and if something does, this is where to notice. */
            return stops === null ? null : stops;
          }

          const colour = style.backgroundColor;
          const parts = colour.match(/[\d.]+/g);

          if (parts && (parts.length < 4 || Number(parts[3]) > 0.85)) return [colour];

          node = node.parentElement;
        }

        return [getComputedStyle(document.body).backgroundColor || '#ffffff'];
      };

      const found: Failure[] = [];
      const seen = new Set<string>();
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);

      let node = walker.nextNode();

      while (node) {
        const text = (node.textContent ?? '').trim();
        const element = node.parentElement;

        node = walker.nextNode();

        if (text.length < 2 || !element) continue;

        const box = element.getBoundingClientRect();

        if (box.width === 0 || box.height === 0) continue;

        const style = getComputedStyle(element);

        if (style.visibility === 'hidden' || style.opacity === '0') continue;
        if (element.closest('[aria-hidden="true"]')) continue;
        if (element.className.toString().includes('sr-only')) continue;

        /*
          Text painted THROUGH a background gradient reports a transparent fill, so `color` is
          `rgba(0, 0, 0, 0)` and this check would score it 1:1 — a failure the reader never meets.
          The hero headline is the only such element, and its gradient is `--hero-title-grad` from
          §9.2 of the handoff. Its stops were measured against the page ground separately, because
          a per-pixel check is a different tool from this one:

            light  #8A6414 4.97:1 · #A87A1F 3.56:1 · #6E4F0F 6.97:1
            dark   #F6E3B0 15.37:1 · #E8BC66 10.98:1 · #C4923E 7.00:1

          At 58px the floor is 3:1, so the weakest stop clears it with room. Skipped here rather
          than allow-listed by colour, because «transparent fill over an image» is a MECHANISM this
          check cannot read, not a colour somebody chose.
        */
        if (
          style.webkitTextFillColor === 'rgba(0, 0, 0, 0)' &&
          style.backgroundImage !== 'none'
        ) {
          continue;
        }

        const size = Number.parseFloat(style.fontSize);
        const weight = Number(style.fontWeight) || 400;
        /* WCAG's own definition of large: 24px, or 18.66px when bold. */
        const floor = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
        const behind = grounds(element);

        if (behind === null) continue;

        /* The worst stop is the one that has to clear the floor. */
        let ratio = Number.POSITIVE_INFINITY;
        let background = behind[0] ?? '#ffffff';

        for (const candidate of behind) {
          const measured = contrast(rgb(style.color, candidate), rgb(candidate));

          if (measured < ratio) {
            ratio = measured;
            background = candidate;
          }
        }

        if (ratio >= floor) continue;
        if (allowed.has(style.color)) continue;

        const key = `${style.color}|${background}|${Math.round(size)}|${weight}`;

        if (seen.has(key)) continue;

        seen.add(key);
        found.push({
          ratio: Number(ratio.toFixed(2)),
          floor,
          size: Math.round(size),
          colour: style.color,
          on: background,
          sample: text.slice(0, 30),
          where: (element.className.toString() || element.tagName).slice(0, 50),
        });
      }

      return found.sort((a, b) => a.ratio - b.ratio);
    },
    [...SIGNED_OFF],
  );
}

/**
 * Both themes, because they are two palettes and only one of them is ever being looked at.
 *
 * The theme is an ATTRIBUTE this product sets before paint, not `prefers-color-scheme` — a context
 * created with Playwright's `colorScheme: 'dark'` renders the LIGHT palette. An early version of
 * this audit did exactly that and reported the light theme's failures twice while calling the dark
 * one checked.
 *
 * ## Seeded in STORAGE, and why setting the attribute is not enough
 *
 * This used to set `data-theme` from an init script. That is still not the product's own mechanism,
 * and on the customer site it measured the LIGHT theme in both runs: `ThemeKeeper` re-reads
 * `localStorage` after hydration and DELETES an attribute that storage does not agree with, which
 * is the whole reason that component exists. The two runs differed only in render noise — 31
 * findings against 85 — which looks like two themes and was one.
 *
 * Seeding the key the app itself writes means `THEME_SCRIPT` applies it BEFORE paint and nothing
 * fights it afterwards. `the two runs really are two palettes` holds that to account by reading a
 * token back, because «the theme did not apply» is invisible in a passing result.
 */
async function seed(
  page: Page,
  surface: 'admin' | 'partner' | 'web',
  theme: string,
): Promise<void> {
  await page.addInitScript(
    ({ key, mode }) => {
      try {
        localStorage.setItem(key, mode);
      } catch {
        /* Private browsing. The pre-paint script falls back to the default, and the control below
           is what notices. */
      }
    },
    { key: `safra-theme-${surface}`, mode: theme },
  );
}

async function sweep(
  page: Page,
  paths: readonly string[],
  surface: 'admin' | 'partner' | 'web',
  theme: string,
): Promise<string[]> {
  await seed(page, surface, theme);

  const broken: string[] = [];

  for (const path of paths) {
    const response = await page.goto(path);

    expect(response?.status(), `${path} did not render`).toBeLessThan(400);

    for (const one of await unreadable(page)) {
      broken.push(
        `${path} — ${one.ratio}:1 (needs ${one.floor}) ${one.size}px ${one.colour} on ${one.on} «${one.sample}» ${one.where}`,
      );
    }
  }

  return broken;
}

test.describe('the customer site', () => {
  test.use({ baseURL: 'http://localhost:3000' });

  for (const theme of ['light', 'dark'] as const) {
    test(`every word is readable in the ${theme} theme`, async ({ page }) => {
      expect(await sweep(page, CUSTOMER, 'web', theme)).toStrictEqual([]);
    });
  }

  /*
    The control on the seeding, not on the palette. Reading `--color-gold` back proves the two runs
    above are two palettes: it is #a87a1f against white and #e8bc66 against night, so one value in
    both runs means the theme never applied and every «readable» above was one theme measured twice.
  */
  test('the two runs really are two palettes', async ({ page }) => {
    const goldIn = async (theme: string): Promise<string> => {
      await seed(page, 'web', theme);
      await page.goto('/ar');

      return page.evaluate(() =>
        getComputedStyle(document.documentElement)
          .getPropertyValue('--color-gold')
          .trim(),
      );
    };

    expect(await goldIn('light')).not.toEqual(await goldIn('dark'));
  });
});

test.describe('the staff console', () => {
  test.use({ storageState: STAFF_STATE });

  for (const theme of ['light', 'dark'] as const) {
    test(`every word is readable in the ${theme} theme`, async ({ page }) => {
      expect(await sweep(page, CONSOLE, 'admin', theme)).toStrictEqual([]);
    });
  }

  /*
    The control on SIGNED_OFF.

    An exemption list decays in the direction of hiding things: this one excuses the gold, so on the
    day the gold decision is revisited it would go on excusing nothing while still reading as
    coverage. Asserting that it matches something REAL means that day this test says so, and names
    what to delete. The console's light theme is where the gold is densest — about 290 nodes.
  */
  test('the signed-off colours are still below the floor', async ({ page }) => {
    await seed(page, 'admin', 'light');
    await page.goto('/');

    const excused = await page.evaluate(
      (allowed: readonly string[]) =>
        Array.from(document.querySelectorAll('*')).filter((node) =>
          allowed.includes(getComputedStyle(node).color),
        ).length,
      [...SIGNED_OFF],
    );

    expect(
      excused,
      'no element paints a signed-off colour any more — the decision has moved, so delete SIGNED_OFF and this test',
    ).toBeGreaterThan(0);
  });
});

test.describe('the partner portal', () => {
  test.use({ baseURL: PARTNER_BASE, storageState: PARTNER_STATE });

  for (const theme of ['light', 'dark'] as const) {
    test(`every word is readable in the ${theme} theme`, async ({ page }) => {
      expect(await sweep(page, PORTAL, 'partner', theme)).toStrictEqual([]);
    });
  }
});
