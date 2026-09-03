import { expect, test, type Page } from '@playwright/test';

/**
 * Every word on the customer site is readable, measured rather than assumed.
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
 * markets this platform serves. Where it cost nothing the tokens went further: `--color-text` is
 * 12.6:1 and `--color-muted`, which carries most of the secondary reading, is 7:1, both AAA.
 */
test.use({ baseURL: 'http://localhost:3000' });

/** One page per shape: marketing, results, a record, prose, a form. */
const PAGES = [
  '/ar',
  '/ar/search?checkIn=2026-09-03&checkOut=2026-09-04&adults=2',
  '/ar/city/damascus',
  '/ar/property/qasr-al-sharq-apartments',
  '/ar/login',
  '/ar/terms',
];

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
  return page.evaluate(() => {
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

    const behind = (element: Element): string => {
      let node: Element | null = element;

      while (node && node !== document.documentElement) {
        const colour = getComputedStyle(node).backgroundColor;
        const parts = colour.match(/[\d.]+/g);

        if (parts && (parts.length < 4 || Number(parts[3]) > 0.85)) return colour;

        node = node.parentElement;
      }

      return getComputedStyle(document.body).backgroundColor || '#ffffff';
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

      const size = Number.parseFloat(style.fontSize);
      const weight = Number(style.fontWeight) || 400;
      /* WCAG's own definition of large: 24px, or 18.66px when bold. */
      const floor = size >= 24 || (size >= 18.66 && weight >= 700) ? 3 : 4.5;
      const background = behind(element);
      const ratio = contrast(rgb(style.color, background), rgb(background));

      if (ratio >= floor) continue;

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
  });
}

/**
 * Both themes, because they are two palettes and only one of them is ever being looked at.
 *
 * The theme is an ATTRIBUTE this product sets before paint, not `prefers-color-scheme` — a context
 * created with Playwright's `colorScheme: 'dark'` renders the LIGHT palette. The first version of
 * this audit did exactly that and reported the light theme's failures twice while calling the dark
 * one checked.
 */
for (const theme of ['light', 'dark'] as const) {
  test(`every word on the customer site is readable in the ${theme} theme`, async ({
    page,
  }) => {
    await page.addInitScript((mode) => {
      const apply = () => document.documentElement.setAttribute('data-theme', mode);

      apply();
      document.addEventListener('DOMContentLoaded', apply);
    }, theme);

    const broken: string[] = [];

    for (const path of PAGES) {
      await page.goto(path);

      for (const one of await unreadable(page)) {
        broken.push(
          `${path} — ${one.ratio}:1 (needs ${one.floor}) ${one.size}px ${one.colour} on ${one.on} «${one.sample}» ${one.where}`,
        );
      }
    }

    expect(broken).toStrictEqual([]);
  });
}
