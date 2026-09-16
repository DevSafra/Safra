import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { requirePublishedReference } from './partner-fixtures.js';
import { MISSING_CREDENTIALS, SKIP_REASON } from './staff.js';

/**
 * The bed KIND, along the whole chain — partner chooses, API stores, guest reads a word.
 *
 * Bashar asked for «سرير فردي» or «سرير مزدوج» on the listing (2026-09-16), then that the partner
 * be able to set it, then that NO bed anywhere be left untyped — «also on multiple beds». Those
 * three are the test: a column the API accepts and no screen can write is the shape this project
 * has shipped before and named — a capability with no feature behind it, green in every suite and
 * reachable by nobody — and a rule that holds for one bed and not for four is not a rule.
 *
 * ## Why the page assertion is on a DIFFERENT listing
 *
 * The property page is ISR (`revalidate = 60`) and its fetch caches for the same minute, so a
 * choice made seconds ago is not on it yet. The payload proves STORAGE; a listing the spec never
 * touches proves RENDERING, and separating them is the only way both claims are true. The same
 * split the amenities chain makes, for the same reason.
 *
 * ## It puts the unit back
 *
 * The kind is restored at the end and the restore is asserted, so the next run measures the
 * fixture rather than this run's leftovers.
 */
/* Resolved per run: a reseed renumbers references — see property-reference.ts. */
let PROPERTY = '';
const SLUG = 'qasr-al-sharq-malki';
/* Seeded with «غرفة مزدوجة قياسية» rooms, and never edited here. */
const UNTOUCHED_SLUG = 'grand-umayyad-hotel';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.describe.configure({ mode: 'serial' });
test.beforeAll(async ({ request }) => {
  PROPERTY = await requirePublishedReference(request, SLUG);
});

test.use({
  baseURL: PARTNER_BASE,
  storageState: PARTNER_STATE,
  viewport: { width: 1440, height: 900 },
});

test('a partner chooses a bed kind and a guest reads it as a word', async ({
  page,
  browser,
  request,
}) => {
  const api = 'http://localhost:4000/api/v1';

  // ── 1. THE PARTNER CHOOSES ────────────────────────────────────────────────
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

  /*
    The unit id comes from the amenity picker's own attribute, which is the one element in a unit
    block that carries it. Scoped inside `[data-unit]` because the building's picker sits above
    الوحدات and taking the first on the page would name the PROPERTY.
  */
  const picker = page.locator('[data-unit] [data-amenity-picker]').first();

  await expect(picker, 'the editor rendered a unit at all').toBeVisible();

  const unitId = (await picker.getAttribute('data-amenity-picker'))!;
  const select = page.locator(`select[id="unit-bed-type-${unitId}"]`);

  await expect(select, 'the unit editor offers a bed kind at all').toBeVisible();

  const before = await select.inputValue();
  /* A value it is not already on, or the save short-circuits on an empty patch and proves nothing. */
  const chosen = before === 'double' ? 'single' : 'double';

  expect(
    await select.locator('option').allTextContents(),
    'two kinds and no empty option — a bed cannot be left untyped from here',
  ).toHaveLength(2);

  console.log('unit under test:', unitId, '| was:', before || '(unset)', '→', chosen);

  await select.selectOption(chosen);

  const saved = page.waitForResponse(
    (r) => r.url().includes(`/api/units/${unitId}`) && r.request().method() === 'PATCH',
  );

  await page
    .locator(`form:has([data-amenity-picker="${unitId}"])`)
    .getByRole('button', { name: 'حفظ الوحدة' })
    .click();

  expect((await saved).status(), 'the API accepted the choice').toBeLessThan(300);
  await expect(page.getByText('حُفظت الوحدة').first()).toBeVisible({ timeout: 15_000 });

  // ── 2. IT SURVIVED A RELOAD ───────────────────────────────────────────────
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

  await expect(
    page.locator(`select[id="unit-bed-type-${unitId}"]`),
    'stored rather than held in the form',
  ).toHaveValue(chosen);

  // ── 3. THE GUEST-FACING PAYLOAD CARRIES IT ────────────────────────────────
  const detail = await request.get(`${api}/properties/${SLUG}`);

  expect(detail.status(), 'the public property endpoint answers').toBe(200);

  const body = (await detail.json()) as {
    units: { id: string; bedType: string | null }[];
  };

  console.log(
    'customer payload bedType:',
    body.units.find((one) => one.id === unitId)?.bedType,
  );
  expect(body.units.find((one) => one.id === unitId)?.bedType).toBe(chosen);

  // ── 4. AND A GUEST READS A WORD, NOT A CODE ───────────────────────────────
  const guest = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const guestPage = await guest.newPage();

  try {
    await guestPage.goto(`http://localhost:3000/ar/property/${UNTOUCHED_SLUG}`, {
      waitUntil: 'domcontentloaded',
    });

    const shown = await guestPage.locator('main').innerText();

    expect(shown, 'the kind reaches the listing as Arabic').toContain('سرير مزدوج');
    expect(shown, 'and never as the enum value').not.toContain('double');

    /*
      «Also on multiple beds» — the half a one-bed room cannot prove. This listing's suites have
      three beds and its family room four, and the rule is that the kind survives the count:
      «3 أسرّة مزدوجة», never «3 أسرّة».

      Asserted as «no bare count anywhere on the page» rather than as one expected sentence,
      because the defect this guards is a FALLBACK — a branch that prints the number alone when
      something is missing — and naming one sentence would leave every other room free to take it.
    */
    const bare = [...shown.matchAll(/\d+ أسرّة(?! (?:مزدوجة|فردية))/g)].map((m) => m[0]);

    expect(bare, 'every multi-bed room names its kind too').toEqual([]);
    expect(shown, 'and the multi-bed phrasing is on the page at all').toMatch(
      /أسرّة (?:مزدوجة|فردية)/,
    );
  } finally {
    await guest.close();
  }

  // ── 5. PUT IT BACK ────────────────────────────────────────────────────────
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });

  const restore = page.locator(`select[id="unit-bed-type-${unitId}"]`);

  await restore.selectOption(before);

  const restored = page.waitForResponse(
    (r) => r.url().includes(`/api/units/${unitId}`) && r.request().method() === 'PATCH',
  );

  await page
    .locator(`form:has([data-amenity-picker="${unitId}"])`)
    .getByRole('button', { name: 'حفظ الوحدة' })
    .click();

  expect((await restored).status(), 'the fixture is put back').toBeLessThan(300);
  await page.goto(`/properties/${PROPERTY}/edit`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.locator(`select[id="unit-bed-type-${unitId}"]`),
    'and the restore is asserted rather than hoped for',
  ).toHaveValue(before);
});
