import { expect, test } from '@playwright/test';

import { PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

/**
 * A Latin run inside an Arabic sentence keeps its own order — checked by LAYOUT, not by string.
 *
 * ## Why nothing else can see this
 *
 * `formatMoney` returns «$131.99» and a date column returns «2027-07-12». Both are correct, and
 * every unit test that compares them passes. Then the browser lays them out inside a right-to-left
 * paragraph, splits the value into runs, and orders the runs right to left — so the reader meets
 * «131.99$» and «12-07-2027». Nothing downstream of the formatter can tell, because nothing
 * downstream of the formatter has a layout.
 *
 * So this walks the pages and reads the BOUNDING BOX of every character, which is the only place
 * the defect exists.
 *
 * ## What was found the first time it ran (2026-09-07)
 *
 * Nine, across all three applications: the partner's accept dialog rendered a booking's dates as
 * «12-07-2027» and its amount as «131.99$» on the most time-critical screen in the platform; the
 * customer's checkout said «استخدم 45$ من رصيدي»; «آخر تحديث» on الشروط and الخصوصية reversed a
 * date; بطاقات الهدايا displaced a balance; and the partner's dashboard did it three times.
 *
 * The remedy is `ltrIsolate` from `@safra/i18n` on the VALUE passed to a catalogue placeholder —
 * never on the sentence, which would isolate the Arabic instead.
 */

/** Reads every text node's characters by box, and reports the runs the algorithm reordered. */
const REORDERED = () => {
  const out: { kind: string; text: string }[] = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;

  while ((node = walk.nextNode())) {
    const text = node.textContent ?? '';
    const trimmed = text.trim();

    if (!trimmed || trimmed.length > 200) continue;
    if (!/[؀-ۿ]/.test(trimmed)) continue;
    /* Already isolated: U+2066 … U+2069 is the fix, so its presence is the passing case. */
    if (trimmed.includes('⁦')) continue;

    const parent = node.parentElement;
    if (!parent || getComputedStyle(parent).direction !== 'rtl') continue;

    const range = document.createRange();
    const marks: { ch: string; x: number; y: number }[] = [];

    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);

      const box = range.getBoundingClientRect();
      if (box.width && box.height)
        marks.push({ ch: text[i]!, x: box.x, y: Math.round(box.y) });
    }

    if (marks.length === 0) continue;

    /* A currency symbol belongs to the LEFT of its own digits on the same line. */
    for (const symbol of marks.filter((m) => /[$€£]/.test(m.ch))) {
      const digits = marks.filter((m) => m.y === symbol.y && /\d/.test(m.ch));

      if (digits.length && symbol.x > Math.min(...digits.map((d) => d.x))) {
        out.push({ kind: 'currency', text: trimmed.slice(0, 80) });
        break;
      }
    }

    /* An ISO date reads year first, left to right. */
    for (const match of text.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) {
      const at = match.index ?? 0;
      const year = marks.find((m) => m.ch === text[at]);
      const day = marks.find((m) => m.ch === text[at + 9]);

      if (year && day && year.y === day.y && year.x > day.x) {
        out.push({ kind: 'date', text: trimmed.slice(0, 80) });
        break;
      }
    }
  }

  return out;
};

const SURFACES = [
  {
    name: 'the customer application',
    base: 'http://localhost:3000',
    state: undefined as string | undefined,
    paths: [
      '/ar',
      '/ar/search?checkIn=2027-04-05&checkOut=2027-04-07&adults=2',
      '/ar/property/qasr-al-sharq-malki',
      /* The trip card prints «من $100», on the home row, the list and the trip's own page. */
      '/ar/groups',
      '/ar/groups/coastal-syria-spring',
      '/ar/terms',
      '/ar/privacy',
      '/ar/find-booking',
      '/ar/login',
      '/ar/register',
      '/ar/partners/join',
    ],
  },
  {
    name: 'the staff console',
    base: 'http://localhost:3001',
    state: STAFF_STATE,
    paths: [
      '/',
      '/bookings',
      '/payments',
      '/payouts',
      '/partners',
      '/customers',
      '/disputes',
      '/treasury',
      '/wallet',
      '/giftcards',
      '/coupons',
      '/reviews',
    ],
  },
  {
    name: 'the partner portal',
    base: 'http://localhost:3002',
    state: PARTNER_STATE,
    paths: [
      '/',
      '/arrivals',
      '/calendars',
      '/payouts',
      '/properties',
      '/violations',
      '/reviews',
    ],
  },
];

for (const surface of SURFACES) {
  test(`${surface.name} never reorders a money or date run inside Arabic`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      ...(surface.state ? { storageState: surface.state } : {}),
    });
    const page = await context.newPage();
    const found: string[] = [];

    try {
      for (const path of surface.paths) {
        const response = await page.goto(surface.base + path, {
          waitUntil: 'domcontentloaded',
          timeout: 25_000,
        });

        /*
          A 404 is a broken FIXTURE, not a pass. A path that stopped existing would otherwise make
          this sweep quietly narrower every time a route is renamed — the same way an exemption
          list decays in the direction of hiding things.
        */
        expect(response?.status(), `${path} should be reachable`).toBeLessThan(400);

        await page.waitForTimeout(300);

        for (const hit of await page.evaluate(REORDERED)) {
          found.push(`${path}  [${hit.kind}]  ${hit.text}`);
        }
      }
    } finally {
      await context.close();
    }

    expect(
      [...new Set(found)],
      'These read right-to-left in the browser though their string is correct. Wrap the VALUE ' +
        'passed to the catalogue placeholder in `ltrIsolate` from `@safra/i18n` — never the sentence.',
    ).toEqual([]);
  });
}

/**
 * The breadcrumb chevron points the way the reader reads — measured as a SHAPE on screen.
 *
 * Same family of defect as the sweep above: the string is not where the fault lives. A separator
 * was `←` because `‹`/`›` carry Unicode's `Bidi_Mirrored` property and flip inside an RTL
 * container — so the two obvious spellings each fail, one silently. The drawing that replaced them
 * takes its direction from the DOCUMENT, and the only place that resolves is a laid-out page.
 *
 * It reads the path's endpoints and apex through `getScreenCTM()` rather than asserting a class or
 * a `scale` value, so it still holds if the flip moves to a transform, a rotate, or a second path.
 * What is being protected is where the chevron POINTS, and nothing else is allowed to satisfy it.
 *
 * Both directions are checked because fixing one and leaving the other is exactly how this arrived:
 * both breadcrumbs hardcoded `←` regardless of locale, so English and German pointed backwards
 * against their own text for as long as those locales have existed.
 */
const CHEVRON_APEX = () => {
  const navs: HTMLElement[] = Array.from(document.querySelectorAll('nav'));
  const nav = navs.find((n) => n.querySelector('svg path') !== null);
  const path: Element | null = nav?.querySelector('svg path') ?? null;
  if (!(path instanceof SVGPathElement)) return null;

  const ctm = path.getScreenCTM();
  if (!ctm) return null;

  const total = path.getTotalLength();
  const at = (l: number) => {
    const p = path.getPointAtLength(l).matrixTransform(ctm);
    return p.x;
  };

  // A chevron is two arms meeting at a middle vertex: the apex is the midpoint of the outline.
  return { apex: at(total / 2), ends: (at(0) + at(total)) / 2 };
};

for (const { locale, path, reads } of [
  { locale: 'ar', path: '/ar/property/qasr-al-sharq-malki', reads: 'left' },
  { locale: 'en', path: '/en/property/qasr-al-sharq-malki', reads: 'right' },
  { locale: 'de', path: '/de/property/qasr-al-sharq-malki', reads: 'right' },
  { locale: 'ar', path: '/ar/city/damascus', reads: 'left' },
  { locale: 'en', path: '/en/city/damascus', reads: 'right' },
  /*
    The landmark page, added 2026-09-28. It is the third instance of the breadcrumb shape and the
    only one that draws TWO chevrons, so it is the one where a direction taken from the element
    rather than from the document would show up as a pair disagreeing with each other.
  */
  { locale: 'ar', path: '/ar/landmark/souq-al-hamidiyah', reads: 'left' },
  { locale: 'en', path: '/en/landmark/souq-al-hamidiyah', reads: 'right' },
] as const) {
  test(`the breadcrumb chevron on ${path} points ${reads}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
    const page = await context.newPage();

    try {
      const response = await page.goto('http://localhost:3000' + path, {
        waitUntil: 'domcontentloaded',
        timeout: 25_000,
      });
      expect(response?.status(), `${path} should be reachable`).toBeLessThan(400);

      await page.waitForTimeout(300);
      const measured = await page.evaluate(CHEVRON_APEX);

      expect(measured, `${path} should draw a breadcrumb chevron`).not.toBeNull();

      const pointsLeft = measured!.apex < measured!.ends;
      expect(
        pointsLeft ? 'left' : 'right',
        `On ${locale} the breadcrumb runs ${reads === 'left' ? 'right-to-left' : 'left-to-right'}, ` +
          'so the chevron between two crumbs must point that way. It takes its direction from the ' +
          'document — check the `ltr:` variant on `BreadcrumbChevron` still reaches it.',
      ).toBe(reads);
    } finally {
      await context.close();
    }
  });
}
