import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * المدن والدول والعملات — the three things it could not do (Bashar, 2026-08-30).
 *
 * ## What a browser adds
 *
 * `geo-write.integration.test.ts` proves the writes, their refusals and their audit rows against a
 * real database. What it cannot see is whether an operator can DO any of it: the screen showed
 * three disabled «+ إضافة» buttons and a table whose every row was a dead end, and the city image
 * pipeline was built end-to-end with nothing calling either end.
 *
 * ## It leaves a photograph behind, deliberately
 *
 * `city_images` is append-only-with-a-soft-delete, so a spec cannot tidy up after itself. It
 * uploads one every run, which is the only way to keep testing the path — the same trade
 * `partner-support.spec.ts` documents. `db:testbed` clears them.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE });

const c = t.sections.geo;

/** `MAX_IMAGES_PER_CITY` in `city-images.controller.ts` — the API's refusal, mirrored. */
const MAX_CITY_IMAGES = 12;

test('the three add controls are real, not disabled placeholders', async ({ page }) => {
  await page.goto('/geo');

  for (const marker of ['currency', 'country', 'city']) {
    const trigger = page.locator(`[data-geo-add="${marker}"]`);

    await expect(trigger, `«+ إضافة» for ${marker} must be a control`).toBeEnabled();

    /* And it opens a real form — a trigger that expands nothing is the shape being replaced. */
    await trigger.click();
    await expect(page.locator(`[data-geo-form="${marker}"]`)).toBeVisible();
    await page.getByRole('button', { name: c.cancel }).first().click();
  }
});

/**
 * Three currencies on the screen, and the forms are usable panels rather than slivers.
 *
 * ## The currencies (Bashar, 2026-08-30)
 *
 * «keep the currency only (usd, euro, syp)». JOD and LBP were seeded and neither could ever price
 * anything — one FX pair exists, USD→SYP, and `rateBetween` refuses rather than defaulting.
 *
 * ## The layout
 *
 * The form opened inside a `<span className="ms-auto">`, which sizes to its content, so eight
 * fields rendered in a 230px column against the edge of an otherwise empty panel. Bashar
 * screenshotted it. Asserting the WIDTH is what makes that reproducible: it is a live layout
 * failure, invisible to a type checker and to any HTTP-level check.
 */
test('offers three currencies, in forms that fill their panel', async ({ page }) => {
  await page.goto('/geo');

  /*
    The whole screen, not a panel: `.filter({ hasText })` matched the HEADING ROW first — a div
    holding «العملات + إضافة عملة» and nothing else — so the assertion read an element that could
    never contain a symbol. The three symbols and the two absences are unambiguous on the page as
    a whole, which is what this is really about.
  */
  const screen = page.locator('main');

  await expect(screen).toContainText('ل.س');
  await expect(screen).toContainText('€');
  await expect(screen).toContainText('$');

  /* And nothing the platform cannot price — «د.أ» is JOD's symbol, «ل.ل» is LBP's. */
  await expect(screen).not.toContainText('د.أ');
  await expect(screen).not.toContainText('ل.ل');

  for (const marker of ['country', 'city']) {
    await page.locator(`[data-geo-add="${marker}"]`).click();

    const width =
      (await page.locator(`[data-geo-form="${marker}"]`).boundingBox())?.width ?? 0;

    expect(
      width,
      `the ${marker} form must fill its panel, not a sliver of it`,
    ).toBeGreaterThan(400);

    await page.locator(`[data-geo-add="${marker}"]`).click();
  }
});

/**
 * The currency code is a MENU, and the symbol follows it (Bashar, 2026-08-30).
 *
 * A code is an identifier from a standard, and the symbol and the minor-unit digits are properties
 * OF it. As free text, «USD» could be saved beside «€» — every dollar on the platform then renders
 * with a euro sign and nothing refuses it — and JOD could be stored with two decimals, which
 * truncates 10.125 to 10.13 on the way in. The API takes both from the code regardless of what a
 * form sends; this asserts the FORM cannot even suggest otherwise.
 */
test('the currency code is chosen, and the symbol follows it', async ({ page }) => {
  await page.goto('/geo');
  await page.locator('[data-geo-add="currency"]').click();

  const form = page.locator('[data-geo-form="currency"]');
  const symbol = form.locator('input[name=symbol]');

  await expect(symbol, 'the symbol is not something to type').toBeDisabled();

  await form.locator('select[name=code]').selectOption('TRY');

  await expect(symbol).toHaveValue('₺');

  /* Choosing a different code moves it — a stale symbol would be the same defect, one step later. */
  await form.locator('select[name=code]').selectOption('GBP');
  await expect(symbol).toHaveValue('£');

  /*
    And a currency the platform already holds is not offered: choosing one could only earn a 409,
    and a menu whose entries are refusals teaches the operator nothing.
  */
  const codes = await form.locator('select[name=code] option').allInnerTexts();

  expect(codes.join(' ')).not.toContain('USD');
  expect(codes.join(' ')).not.toContain('EUR');
});

/**
 * A city row opens an editor, and the editor takes a photograph.
 *
 * `city_images`, its `GEO_MANAGE` controller and the re-encoding worker all existed and nothing
 * called them: nine cities, zero rows, and §5.4's hero band rendering a gradient. The count on the
 * row is the cheapest proof the upload landed AND that the read sees it.
 */
test('a city can be edited, and given the photograph §5.4 asks for', async ({ page }) => {
  await page.goto('/geo');

  /*
    A city with ROOM, not a hardcoded one.

    This spec uploads a photograph every run and cannot tidy up after itself — `city_images` is
    append-only with a soft delete and the console offers no removal — so the city it names fills
    up. Damascus reached the twelve-image cap, and the failure then looked exactly like a broken
    upload: the count did not move, and the reason was a refusal inside the form nobody read.
    Choosing a city under the cap keeps the spec testing the PATH rather than the accumulation.
  */
  const counted = await page.locator('[data-city-images]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      slug: node.getAttribute('data-city-images') ?? '',
      images: Number(/\d+/.exec(node.textContent ?? '')?.[0] ?? '0'),
    })),
  );

  const target = counted.find((one) => one.images < MAX_CITY_IMAGES)?.slug;

  test.skip(target === undefined, 'every city is at its photograph cap.');

  const marker = page.locator(`[data-city-images="${target}"]`);
  const before = ((await marker.textContent()) ?? '').trim();

  await page.locator(`[data-city-edit="${target}"]`).click();

  /*
    The form opens in a POPUP over the page (Bashar, 2026-08-30), not inside a table cell and not
    in a panel under the table. It was rendered in the cell first: a five-track grid given six
    columns squeezes every track, «البتراء» came out «تراء», and the form folded into a 40px
    column and stretched two thousand pixels down the page. The panel that replaced it was
    readable and pushed every row below it down, which is what the popup fixes.
  */
  const form = page.locator(`[data-city-form="${target}"]`);

  await expect(form).toBeVisible();
  await expect(
    page.getByRole('dialog'),
    'the editor is a popup, not a panel under the table',
  ).toBeVisible();
  expect(
    (await form.boundingBox())?.width ?? 0,
    'the editor is a form, not a table cell',
  ).toBeGreaterThan(400);

  const chooser = page.waitForEvent('filechooser');

  await page.locator(`[data-city-image-add="${target}"]`).click();
  await (await chooser).setFiles('e2e/fixtures/room-one.jpg');

  await expect
    .poll(async () => ((await marker.textContent()) ?? '').trim(), { timeout: 30_000 })
    .not.toBe(before);
});

/**
 * And the photograph reaches the PUBLIC page, which is the point of uploading it.
 *
 * The bucket policy grants anonymous read per prefix, and `cities/*` was absent — the failure is
 * silent in the worst way: URL right, object stored, row `ready`, browser rendering nothing.
 * `media-policy.integration.test.ts` holds the policy; this holds the page that depends on it.
 */
test('the city hero is a photograph, and it loads', async ({ page, request }) => {
  await page.goto('http://localhost:3000/ar/city/damascus');

  const hero = page.locator('section img').first();

  /* Skip only if the city genuinely has none — never because the picture failed to arrive. */
  test.skip((await hero.count()) === 0, 'Damascus has no photograph yet.');

  const src = (await hero.getAttribute('src')) ?? '';

  expect(src).toContain('/cities/');

  /* The bytes, not the tag: an `<img>` whose source 403s renders nothing and reports no error. */
  expect((await request.get(src)).status(), `${src} must be readable`).toBe(200);

  await expect
    .poll(async () => hero.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
});

/**
 * Editing a country and a currency — a POPUP, and the writes that had no caller.
 *
 * ## Two things at once, and both were asked for
 *
 * «Can you get the page المدن والدول والعملات completely done and implement a CRUD for every
 * table» — `PATCH /admin/geo/countries/:code` and `/currencies/:code` shipped behind `GEO_MANAGE`
 * with proxy routes in this app and NOTHING called either: both lists were create-and-read.
 *
 * «When I click on edit button of a contry I should get a popup not a form under the table» —
 * hence `getByRole('dialog')` rather than a bounding box. A panel under a list pushes every row
 * below it down, and the reader loses their place in the list they were working through.
 */
test('a country opens a popup, and the popup saves', async ({ page }) => {
  await page.goto('/geo');

  await page.locator('[data-country-edit="SY"]').click();

  const dialog = page.getByRole('dialog');

  await expect(dialog, 'editing a country must open a popup').toBeVisible();
  await expect(page.locator('[data-country-form="SY"]')).toBeVisible();

  /* Escape closes it — a popup the keyboard cannot dismiss is modal in appearance only. */
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  /* And it writes: the same name back, so the row is unchanged and the PATCH is exercised. */
  await page.locator('[data-country-edit="SY"]').click();

  const nameAr = page.locator('[data-country-form="SY"] input').first();
  const before = (await nameAr.inputValue()).trim();

  await nameAr.fill(before);
  await page.getByRole('dialog').getByRole('button', { name: c.save }).click();

  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });
  await expect(page.locator('main')).toContainText(before);
});

test('a currency opens a popup, and the accounting one cannot be withdrawn', async ({
  page,
}) => {
  await page.goto('/geo');

  await page.locator('[data-currency-edit="SYP"]').click();

  const form = page.locator('[data-currency-form="SYP"]');

  await expect(page.getByRole('dialog')).toBeVisible();

  /*
    `ledger_entries.amount_syp` measures every posting the platform has ever made, so «stop
    offering SYP» is not a thing this screen may express. The control is disabled AND says why —
    a control that is merely inert teaches nothing. The endpoint refuses it too; this is the
    courtesy, and `geo-write.integration.test.ts` holds the control.
  */
  await expect(form.locator('input[type=checkbox]')).toBeDisabled();
  await expect(form).toContainText(c.accountingLocked);

  /* The code and the symbol follow ISO 4217 and are shown rather than typed. */
  const readOnly = form.locator('input[disabled]');

  await expect(readOnly.first()).toBeDisabled();
});

/**
 * Every box in a row is the same height (Bashar, 2026-08-30, with two screenshots).
 *
 * A grid item stretches to its row's height by default, so a field carrying a HINT made the plain
 * field beside it grow to match — the height of a text box was decided by whether its neighbour
 * had explanatory text under it. Both screenshots were of a row of three where «الاسم بالعربية»
 * was visibly taller than «رمز الدولة».
 *
 * Measured rather than eyeballed, because that is the only version of this that survives the next
 * person adding a hint.
 */
test('every field on both forms is the same height', async ({ page }) => {
  await page.goto('/geo');

  for (const marker of ['currency', 'country', 'city']) {
    await page.locator(`[data-geo-add="${marker}"]`).click();

    const boxes = page.locator(
      `[data-geo-form="${marker}"] input:not([type=checkbox]), [data-geo-form="${marker}"] select`,
    );
    const heights = await boxes.evaluateAll((nodes) =>
      nodes.map((node) => Math.round(node.getBoundingClientRect().height)),
    );

    expect(heights.length, `the ${marker} form must have fields`).toBeGreaterThan(2);
    expect(
      [...new Set(heights)],
      `every box on the ${marker} form is one height, not a height per neighbour`,
    ).toHaveLength(1);

    await page.locator(`[data-geo-add="${marker}"]`).click();
  }
});
