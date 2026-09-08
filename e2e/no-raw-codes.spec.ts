import { expect, test } from '@playwright/test';

import { STAFF_STATE } from './staff.js';

/**
 * No screen shows a technical code where a human-readable value belongs.
 *
 * ## Why this sweep exists
 *
 * Bashar, 2026-09-08: *«I do not want users, partners or administrators seeing technical codes
 * where human-readable values should be displayed. Wherever a value is intended for human
 * consumption, it should resolve to a properly translated and user-friendly label.»*
 *
 * The catalogues are large and the resolution happens in a dozen helpers, so «is every value
 * translated» is not a question anybody can answer by reading. It is a question a browser can
 * answer: walk every section, read what a person actually sees, and look for the shape of an
 * identifier. That found `system.partner_no_response` on سجل التدقيق — the most common value in
 * `audit_log.reason`, 11,646 rows, printed raw while the sentence for it had been in the catalogue
 * for weeks.
 *
 * ## What counts as an identifier
 *
 * `snake_case`, with or without a dotted prefix: `partner_no_response`, `system.payment_expired`.
 * Unmistakable, and it is the shape every enum value and every settings key in this platform takes.
 * A single lowercase word is NOT swept — «other», «active» and «visa» are ordinary words in three
 * languages and the false-positive rate would switch this test off within a week.
 *
 * ## The one legitimate case, and why it is an allow-list rather than a blanket exclusion
 *
 * الكتالوج is an EDITOR for amenities, property types and cancellation policies. Its first column
 * is the code an operator types into a form, and the three translations sit beside it in the same
 * row — the code is the subject there, not a failed translation. That is a property of one screen,
 * so it is named as one screen. A blanket «ignore codes in tables» would have hidden the audit
 * finding too.
 */
const SECTIONS = [
  '/',
  '/bookings',
  '/partners',
  '/applications',
  '/properties',
  '/customers',
  '/staff',
  '/staff-roles',
  '/payments',
  '/wallet',
  '/giftcards',
  '/coupons',
  '/geo',
  '/city-categories',
  '/reports',
  '/settings',
  '/audit',
  '/emergency',
  '/disputes',
  '/messages',
  '/reviews',
  '/payouts',
  '/treasury',
  '/ads',
  '/comms',
];

/**
 * Screens whose subject IS the code, with the reason.
 *
 * Each entry has to describe something that would still be true if somebody rewrote the screen —
 * «an editor whose first column is the identifier» is a property of the feature; «it has a lot of
 * codes» would not be.
 */
const CODE_IS_THE_SUBJECT: Readonly<Record<string, string>> = {
  '/catalogue':
    'the amenity, property-type and policy editor — the code column IS the field an operator ' +
    'edits, and the Arabic, English and German names sit beside it in the same row',
  '/settings':
    'the operational settings registry — a setting is addressed by its key, which is what an ' +
    'operator quotes in a runbook and what the API takes',
};

const IDENTIFIER = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*(?:_[a-z0-9]+)+\b/g;

test.use({ storageState: STAFF_STATE });

test('no console screen shows a technical code as a value', async ({ page }) => {
  const found: string[] = [];

  for (const path of SECTIONS) {
    if (path in CODE_IS_THE_SUBJECT) continue;

    const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

    /*
      A section that does not answer is a failure of THIS sweep, not a pass. A 404 or a redirect to
      the login page would silently shrink the walk to nothing, which is the vacuous green this
      file exists to avoid.
    */
    expect(response?.status(), `${path} did not render`).toBeLessThan(400);
    await expect(page.locator('main'), `${path} is not a console screen`).toBeVisible();

    for (const token of new Set(
      (await page.locator('main').innerText()).match(IDENTIFIER) ?? [],
    )) {
      found.push(`${path} — «${token}»`);
    }
  }

  expect(
    [...new Set(found)].sort(),
    'A technical code is on screen where a word belongs. Resolve it through the catalogue — or, ' +
      'if the code genuinely IS the value a reader needs, add the screen to CODE_IS_THE_SUBJECT ' +
      'with the reason.',
  ).toStrictEqual([]);
});

/**
 * And the sweep can actually see one.
 *
 * The control this whole file depends on. If `innerText` returned nothing, if the session had
 * lapsed, or if the pattern stopped matching, the assertion above would report perfect health over
 * an empty walk — the exact failure mode it is written against. So a screen that DOES legitimately
 * show codes must be found to show them.
 */
test('the sweep can find a code when one is genuinely there', async ({ page }) => {
  await page.goto('/catalogue', { waitUntil: 'domcontentloaded' });

  const codes = (await page.locator('main').innerText()).match(IDENTIFIER) ?? [];

  expect(
    codes.length,
    'الكتالوج shows amenity codes in its own column — if this finds none, the sweep above is ' +
      'looking at nothing and its green means nothing',
  ).toBeGreaterThan(0);
});
