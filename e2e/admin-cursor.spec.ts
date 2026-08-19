import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * "Anything clickable gets `cursor-pointer`" — the project rule, asserted.
 *
 * ## Why this needs a browser, and why it is a rule at all
 *
 * Tailwind v4's preflight carries NO cursor rule for `<button>`, so a styled button falls back to
 * the UA default arrow and looks inert. `<a href>` still gets a pointer from the UA stylesheet,
 * which is why links are not the problem and buttons are.
 *
 * Nothing at the type or lint level can see this: the class is either in a string or it is not,
 * and both compile. Only a computed style says what the mouse actually does. The sign-out button
 * on the dashboard had been missing it since it was written, along with seventeen other controls
 * in the console.
 *
 * ## Sampled across three pages, not all twenty
 *
 * The dashboard, a `ConsoleShell` section and a form-heavy screen between them cover every button
 * treatment in the console — the bordered secondary, the gold primary, the destructive, and the
 * role `<select>`. Walking all twenty would triple the runtime to re-check the same components.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

test.use({ storageState: STAFF_STATE });

const PAGES = ['/', '/bookings', '/staff'];

for (const path of PAGES) {
  test(`every enabled control on ${path} shows a pointer`, async ({ page }) => {
    await page.goto(path);

    /*
      Disabled controls are excluded deliberately: they carry `disabled:cursor-not-allowed`, and
      a pointer over something that cannot be pressed is the opposite of what `disabled` means.
      Hidden controls are excluded because `getComputedStyle` on them is not what a user meets.
    */
    const offenders = await page.evaluate(() => {
      const selector = 'button:not([disabled]), select:not([disabled]), summary';
      const found: string[] = [];

      /*
        `Array.from`, not a `for…of` over the NodeList: iterating one directly needs the
        `DOM.Iterable` lib, which this tsconfig does not include, and without it every element
        is `any` — which the linter rejects and which would silently un-type the checks below.
      */
      for (const element of Array.from(
        document.querySelectorAll<HTMLElement>(selector),
      )) {
        const style = getComputedStyle(element);

        if (style.display === 'none' || style.visibility === 'hidden') continue;
        if (style.cursor === 'pointer') continue;

        found.push(
          `<${element.tagName.toLowerCase()}> "${(element.textContent ?? '').trim().slice(0, 30)}" → ${style.cursor}`,
        );
      }

      return found;
    });

    expect(offenders).toStrictEqual([]);
  });
}

/** The one the request was actually about. */
test('the sign-out button shows a pointer', async ({ page }) => {
  await page.goto('/');

  const cursor = await page
    .getByRole('button', { name: /تسجيل الخروج/ })
    .evaluate((element) => getComputedStyle(element).cursor);

  expect(cursor).toBe('pointer');
});
