import { expect, test, type Page } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';

/**
 * التقويمات — every unit's month on one page, and the dashboard day that opens it.
 *
 * Bashar, 2026-08-10: the dashboard calendar should be clickable, and there should be a page that
 * manages every room's availability with a calendar per room.
 *
 * ## What needs a browser
 *
 * The weekday alignment is arithmetic rendered as CSS grid children — an off-by-one puts every date
 * one column from where the reader expects it, which no HTTP-level check can see. And the page draws
 * FOUR range editors, one per unit; that they each target their own unit is exactly the kind of wiring
 * that looks right in the code and sends every edit to the first room.
 *
 * ## Grouped into three tests on purpose
 *
 * The API's default throttle is 120 requests a minute per IP and every navigation here costs the
 * partner profile plus a page of calendars. `partner-sidebar.spec.ts` records what happened when a
 * spec ignored that: it exhausted the budget and the NEXT file failed on a 429 that had nothing to do
 * with it.
 */

test.use({ storageState: PARTNER_STATE });

/** A month far enough out that the testbed's bookings cannot collide with what this spec writes. */
const EDIT_MONTH = '2027-06';
const EDIT_DAY = '2027-06-15';

const grids = (page: Page) => page.locator('[data-unit] ul[aria-label]');

/**
 * The dashboard hands over to التقويمات, at the day that was clicked.
 *
 * The read-only aggregate square cannot itself be edited — it counts every unit, so there is no one
 * room to open or close — so "clickable" means it takes the reader to the screen that can act, with
 * the day marked. Both halves are asserted: the link, and the landing.
 */
test('a day on the dashboard opens التقويمات at that date', async ({ page }) => {
  await page.goto(`${BASE}/`);

  const day = page.locator('[data-day="2026-08-22"] a');

  await expect(day).toBeVisible();
  await expect(day).toHaveAttribute('href', '/calendars?date=2026-08-22');
  /* Its accessible name is the breakdown, not a bare numeral repeated thirty-one times. */
  await expect(day).toHaveAttribute('aria-label', /2026-08-22/);

  await day.click();
  await page.waitForURL(/\/calendars\?date=2026-08-22/);

  /* Marked in EVERY unit's grid — the reader arrived looking for that date across the portfolio. */
  const marked = page.locator('[data-day-highlight]');

  expect(await marked.count()).toBeGreaterThan(0);
  for (const value of await marked.evaluateAll((nodes) =>
    nodes.map((node) => node.getAttribute('data-day')),
  )) {
    expect(value).toBe('2026-08-22');
  }

  /*
    Every marker ring is painted INSIDE the cell it marks.

    REGRESSION (Bashar, 2026-08-14: «14 متاح border ist not completely visible»). The today and
    highlight markers were `ring-1`/`ring-2`, and a Tailwind ring is a box-shadow drawn OUTSIDE the
    element. The grid scrolls in an `overflow-x-auto` box so it fits a phone, so a marked cell in the
    first or last COLUMN had that ring clipped — today's gold outline was missing its left edge
    whenever today fell on الجمعة, which is one day in seven and reads as a rendering fault.

    Asserted as the invariant rather than as a class name: the ring's painted extent must not fall
    outside the scrolling ancestor. An outward ring on an edge cell fails it; an inset one cannot,
    because its extent is the cell's own box. Checking for `ring-inset` in `className` would pass
    against a cell that had been given `overflow-visible` instead and still be describing the fix
    rather than the requirement.
  */
  const escaping = await page.evaluate(() => {
    const clipperOf = (element: HTMLElement) => {
      for (let node = element.parentElement; node; node = node.parentElement) {
        if (['auto', 'scroll', 'hidden'].includes(getComputedStyle(node).overflowX))
          return node;
      }
      return null;
    };

    /*
      Split on commas OUTSIDE parentheses. A computed `box-shadow` separates its layers with commas
      and `rgba(0, 0, 0, 0)` contains three of its own, so a plain `.split(',')` mis-aligns every
      layer after the first — and this check would then read one layer's `inset` off another's.
    */
    const layersOf = (shadow: string) => {
      const layers: string[] = [];
      let depth = 0;
      let current = '';

      for (const character of shadow) {
        if (character === '(') depth += 1;
        if (character === ')') depth -= 1;

        if (character === ',' && depth === 0) {
          layers.push(current);
          current = '';
        } else {
          current += character;
        }
      }

      return [...layers, current];
    };

    /** How far a layer reaches beyond the box: its SPREAD, the fourth length. Inset reaches zero. */
    const reachOf = (layer: string) => {
      if (layer.includes('inset')) return 0;

      const lengths = layer.match(/-?[\d.]+px/g) ?? [];

      return lengths.length >= 4 ? Number.parseFloat(lengths[3] ?? '0') : 0;
    };

    return Array.from(
      document.querySelectorAll<HTMLElement>('[data-day-today], [data-day-highlight]'),
    ).flatMap((cell) => {
      const reach = Math.max(
        0,
        ...layersOf(getComputedStyle(cell).boxShadow).map(reachOf),
      );
      const clipper = clipperOf(cell);

      if (!clipper || reach === 0) return [];

      const box = cell.getBoundingClientRect();
      const bounds = clipper.getBoundingClientRect();

      return box.left - reach < bounds.left || box.right + reach > bounds.right
        ? [{ day: cell.dataset['day'], reach }]
        : [];
    });
  });

  expect(escaping).toStrictEqual([]);

  /*
    Every day cell's id must be unique, or there must be none.

    REGRESSION: the cells carried `id="day-<date>"` for fragment scrolling — correct on the one-grid
    screen, invalid here, where four units draw the same month and every id appeared four times over.
    A duplicate id is not cosmetic: `#day-2026-08-22` then addresses whichever cell the browser
    reaches first.
  */
  const duplicateIds = await page.evaluate(() => {
    const counts = new Map<string, number>();

    for (const element of Array.from(document.querySelectorAll<HTMLElement>('[id]'))) {
      counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
    }

    return Array.from(counts.entries()).filter(([, n]) => n > 1);
  });

  expect(duplicateIds).toStrictEqual([]);

  /*
    Then the month ARROW, clicked — not a fresh `goto`.

    REGRESSION, and the reason this is a click: `RangeEditor` holds its date range in state seeded
    from the month's first day, and a client-side navigation re-renders it without remounting it. The
    range therefore stayed on آب while the bounds moved to أيلول, and pressing «تطبيق على المدة»
    wrote to AUGUST while the partner was looking at September. A `goto` remounts the component and
    would have passed against the bug.

    It also gets the grid's shape at a month that needs an offset, for the price of one navigation:
    September 2026 opens on a TUESDAY, so a Saturday-first week needs exactly three leading spacers.
    That is what the old strip would have failed — it drew day one in column one whatever weekday it
    was. The spacers carry no `data-day`, because that attribute has to keep meaning "a real day".
  */
  await page.getByLabel(t.unitCalendar.nextMonth).click();
  await page.waitForURL(/month=2026-09/);

  await expect(
    page.locator('[data-unit] form').first().getByLabel(t.unitCalendar.from),
  ).toHaveValue('2026-09-01');

  const properties = page.locator('[data-property]');
  const units = page.locator('[data-unit]');

  expect(await properties.count()).toBeGreaterThan(0);
  expect(await units.count()).toBeGreaterThan(0);

  /* One grid and one editor per unit — a page of four rooms is four calendars, not one shared. */
  await expect(grids(page)).toHaveCount(await units.count());
  await expect(units.locator('form')).toHaveCount(await units.count());

  const shape = await page.evaluate(() => {
    const list = document.querySelector('[data-unit] ul[aria-label]');
    const cells = Array.from(list?.children ?? []);

    return {
      spacers: cells.filter((cell) => !cell.hasAttribute('data-day')).length,
      days: cells.filter((cell) => cell.hasAttribute('data-day')).length,
      first: cells
        .find((cell) => cell.hasAttribute('data-day'))
        ?.getAttribute('data-day'),
      header: Array.from(
        document.querySelector('[data-unit] ol[aria-hidden]')?.children ?? [],
      ).map((label) => label.textContent),
    };
  });

  /* 1 September 2026 is a Tuesday: Saturday, Sunday and Monday come first. */
  expect(shape.spacers).toBe(3);
  expect(shape.days).toBe(30);
  expect(shape.first).toBe('2026-09-01');
  /* Saturday-first, the week as it is read in Syria. */
  expect(shape.header?.[0]).toBe('السبت');
  expect(shape.header).toHaveLength(7);

  /*
    ONE عقار open, the rest listed as links — the shape that removed the ten-property ceiling
    (Bashar, 2026-08-19).

    Asserted here rather than in a fourth test because of the throttle noted at the top of this
    file, and it costs one navigation. What it is worth: the API expands only the property named by
    `?expand=`, so if the page ever went back to rendering every folder open, the units of the other
    four would draw as EMPTY grids — a month of blank days on a room that is actually booked. The
    unit count is the assertion that catches that, because it is the one thing an over-eager render
    cannot fake.
  */
  const shut = page.locator('a[data-property]');
  const folder = page.locator('details[data-property]');

  await expect(folder).toHaveCount(1);
  expect(await shut.count()).toBeGreaterThan(0);
  await expect(folder.locator('[data-unit]')).toHaveCount(await units.count());

  const wasOpen = await folder.getAttribute('data-property');
  const target = await shut.last().getAttribute('data-property');

  await shut.last().click();
  await page.waitForURL(new RegExp(`expand=${target}`));

  await expect(page.locator(`details[data-property="${target}"]`)).toBeVisible();
  await expect(page.locator(`a[data-property="${wasOpen}"]`)).toBeVisible();
  await expect(page.locator('details[data-property]')).toHaveCount(1);
  /* The month rides along, so opening a property never drops the reader back on today. */
  expect(page.url()).toContain('month=2026-09');
});

/**
 * An edit reaches the unit whose editor was used, and NOT its neighbours.
 *
 * The failure this exists for: four editors on one page, all posting to the first unit's id. Both
 * screens would still look right, and the partner would close a room they never touched.
 *
 * Idempotent — `pnpm e2e` does not re-seed, so the day is reopened at the end. A spec that left a
 * room closed would pass once and then describe a fixture nobody else expects.
 */
test('an edit applies to that unit only, and is put back', async ({ page }) => {
  await page.goto(`${BASE}/calendars?month=${EDIT_MONTH}`);

  const units = page.locator('[data-unit]');

  /* Needs at least two units on the page for "only that one" to mean anything. */
  expect(await units.count()).toBeGreaterThanOrEqual(2);

  const target = units.nth(1);
  const neighbour = units.nth(0);
  const dayOf = (unit: typeof target) => unit.locator(`[data-day="${EDIT_DAY}"]`);

  await expect(dayOf(target)).toHaveAttribute('data-day-status', 'available');
  await expect(dayOf(neighbour)).toHaveAttribute('data-day-status', 'available');

  async function setStatus(value: string) {
    /*
      The range editor is folded away per unit (2026-08-19) — a partner reads a month far more often
      than they change one, and a seven-field form under every unit made the calendars the thing you
      scrolled past. So it has to be OPENED before it can be filled, exactly as a partner does.
    */
    const editor = target.locator('details').first();

    if (!(await editor.evaluate((element: HTMLDetailsElement) => element.open))) {
      await editor.locator('summary').click();
    }

    const form = target.locator('form');

    await form.getByLabel(t.unitCalendar.from).fill(EDIT_DAY);
    await form.getByLabel(t.unitCalendar.to).fill(EDIT_DAY);
    await form.getByLabel(t.unitCalendar.status).selectOption(value);
    await form.getByRole('button', { name: t.unitCalendar.apply }).click();
    await expect(form.getByRole('alert')).toContainText(t.unitCalendar.applied);
  }

  try {
    await setStatus('closed');

    await expect(dayOf(target)).toHaveAttribute('data-day-status', 'closed');
    /* The one that matters: the neighbouring room was not touched. */
    await expect(dayOf(neighbour)).toHaveAttribute('data-day-status', 'available');

    await page.reload();
    await expect(dayOf(target)).toHaveAttribute('data-day-status', 'closed');
  } finally {
    /* Put it back whatever happened above, so a failure here does not poison later runs. */
    await setStatus('available');
    await expect(dayOf(target)).toHaveAttribute('data-day-status', 'available');
  }
});
