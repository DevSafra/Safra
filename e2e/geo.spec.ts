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

/**
 * Deleting — the control that did not exist, and the refusal that has to teach.
 *
 * Bashar (2026-08-31): «I can add/edit everything on the page المدن والدول والعملات but I can not
 * delete». The interesting half is not that a delete works; it is what a person meets when it
 * CANNOT. Syria holds cities, so the country delete must refuse, and the console must turn the
 * API's coded 409 into a sentence naming why and what to do instead — not «حدث خطأ ما», and not a
 * button that quietly does nothing.
 *
 * This is the whole chain in one press: proxy route, permission, reference count, error code,
 * catalogue lookup, rendered Arabic. Nothing below the browser can see all of it.
 */
test('a country holding cities refuses to be deleted, and says why', async ({ page }) => {
  await page.goto('/geo');
  await page.locator('[data-country-edit="SY"]').click();

  const dialog = page.getByRole('dialog');

  await expect(dialog.locator('[data-geo-delete]')).toBeVisible();
  await dialog.locator('[data-geo-delete]').click();

  /* The confirmation is the system's popup, and destructive, so «إلغاء» holds the focus. */
  const confirm = page.getByRole('alertdialog');

  await expect(confirm).toContainText(c.deleteCountryTitle);
  await confirm.getByRole('button', { name: t.sections.dialog.confirm }).click();

  /* A SENTENCE, in Arabic, naming the alternative — never a raw code and never a generic error. */
  const form = page.locator('[data-country-form="SY"]');

  await expect(form).toContainText('لا يمكن حذف دولة');
  await expect(form).not.toContainText('geo.');
  await expect(form).not.toContainText(t.errors.unknown);

  /* And Syria is still there. A refused delete must not half-happen. */
  await page.keyboard.press('Escape');
  await expect(page.locator('[data-country-edit="SY"]')).toBeVisible();
});

/**
 * A currency added and then removed — the happy path, end to end, leaving nothing behind.
 *
 * TRY is in the catalogue, is not seeded, and nothing prices anything in it, so it is the one code
 * this can use without touching a currency the platform trades in. The spec creates it precisely
 * so that deleting it is safe: a spec that deleted a REAL row would be a spec that breaks the
 * environment it runs in.
 */
test('a currency nothing uses can be added and then deleted', async ({ page }) => {
  await page.goto('/geo');

  await page.locator('[data-geo-add="currency"]').click();

  const form = page.locator('[data-geo-form="currency"]');

  await form.locator('select[name=code]').selectOption('TRY');
  await form.getByRole('button', { name: c.create }).click();

  const row = page.locator('[data-currency-edit="TRY"]');

  await expect(row).toBeVisible({ timeout: 20_000 });

  await row.click();
  await page.getByRole('dialog').locator('[data-geo-delete]').click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t.sections.dialog.confirm })
    .click();

  await expect(row, 'the row is gone from the list').toBeHidden({ timeout: 20_000 });
});

/**
 * The accounting currency offers no delete at all.
 *
 * `ledger_entries.amount_syp` is denominated in it, so this is not a row that becomes removable
 * when the reference counts reach zero. The API refuses it with its own code — `geo-write`'s
 * integration suite holds that — and the console does not offer the control, because a button
 * whose only outcome is a refusal is a button that teaches nothing.
 */
test('the accounting currency has no delete control', async ({ page }) => {
  await page.goto('/geo');
  await page.locator('[data-currency-edit="SYP"]').click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();
  await expect(dialog.locator('[data-geo-delete]')).toHaveCount(0);

  /* The opposite control: another currency in the same dialog DOES offer it. */
  await page.keyboard.press('Escape');
  await page.locator('[data-currency-edit="USD"]').click();
  await expect(page.getByRole('dialog').locator('[data-geo-delete]')).toBeVisible();
});

/**
 * A city's prose and tags, written from the console rather than by a migration.
 *
 * Bashar (2026-08-31): «Add editing for city descriptions and tags (all supported languages) from
 * the administration interface rather than requiring migrations.» Both render on the PUBLIC city
 * page, so the assertion follows them there — a field that saves and a page that does not change
 * is the «built and connected to nothing» shape one layer along.
 */
test('a city’s description and tags are editable, and reach the public read', async ({
  page,
  request,
}) => {
  const mark = `شاهد-${Math.random().toString(36).slice(2, 7)}`;

  await page.goto('/geo');
  await page.locator('[data-city-edit="damascus"]').click();

  const form = page.locator('[data-city-form="damascus"]');

  await form.getByLabel(c.descriptionAr).fill(`وصف تجريبي ${mark}`);
  await form.getByLabel(c.tagsAr).fill(`${mark}، القلعة`);
  await page.getByRole('dialog').locator('[data-geo-save]').click();

  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });

  /* It survives a reload — a value held only in React state would not. */
  await page.reload();
  await page.locator('[data-city-edit="damascus"]').click();
  await expect(
    page.locator('[data-city-form="damascus"]').getByLabel(c.descriptionAr),
  ).toHaveValue(`وصف تجريبي ${mark}`);

  /*
    And it is PUBLIC, which is the reason the field exists.

    Asserted against the customer API rather than the rendered page: `getCity` reads through the
    five-minute reference cache every catalogue read uses — cities change through this console, not
    per request — so the page legitimately lags. Asserting the page would be asserting the cache,
    and would fail for a reason that is not a defect. This is the boundary where a console write
    becomes something a visitor can be served.
  */
  const published = await request.get('http://localhost:4000/api/v1/cities/damascus');

  expect(published.status()).toBe(200);

  const body: unknown = await published.json();
  const city = body as { descriptionAr: string | null; tagsAr: string[] };

  expect(city.descriptionAr).toContain(mark);
  expect(city.tagsAr).toContain(mark);
});

/**
 * Managing a photograph — the alt text above all.
 *
 * Every image on §5.4's hero band went out with an empty `alt` until this shipped, so a screen
 * reader announced nothing on the first third of every public city page. The assertion checks the
 * value ROUND-TRIPS: a field that fills and a database that does not change is the failure this
 * is written against.
 */
test('a city photograph can be described, made the hero, and removed', async ({
  page,
}) => {
  await page.goto('/geo');

  /* Damascus is the seeded city with photographs — see the upload spec above. */
  await page.locator('[data-city-edit="damascus"]').click();

  const cards = page.locator('[data-city-photograph]');

  test.skip((await cards.count()) < 2, 'Damascus needs two photographs for this.');

  const alt = `منظر ${Math.random().toString(36).slice(2, 7)}`;
  const first = cards.first();
  const id = (await first.getAttribute('data-city-photograph')) ?? '';

  await first.getByLabel(`${c.imageAlt} — ${c.nameAr}`).fill(alt);
  await page.locator(`[data-city-image-save="${id}"]`).click();

  /*
    Wait for the card's own «حُفظ», not for a moment in time. A `reload()` straight after the click
    races the PATCH still in flight: the write lands, the reload reads the row a moment before it,
    and the test fails describing a bug that is not there. The app already says when it is done.
  */
  await expect(page.locator(`[data-city-photograph="${id}"]`)).toContainText(
    c.imageSaved,
    {
      timeout: 20_000,
    },
  );

  await page.reload();
  await page.locator('[data-city-edit="damascus"]').click();
  await expect(
    page
      .locator(`[data-city-photograph="${id}"]`)
      .getByLabel(`${c.imageAlt} — ${c.nameAr}`),
  ).toHaveValue(alt);

  /*
    The hero is EXCLUSIVE: naming a second one must leave exactly one «الصورة الرئيسية» badge.
    Two is not a state §5.4 can draw, and the count is the only assertion that sees it.
  */
  const others = page.locator('[data-city-hero]');

  if ((await others.count()) > 0) {
    await others.first().click();
    await expect
      .poll(async () => page.getByText(c.imageHero, { exact: true }).count(), {
        timeout: 20_000,
      })
      .toBe(1);
  }
});

/**
 * A photograph can be REMOVED — the endpoint that had no caller.
 *
 * `DELETE …/images/:imageId`, its console proxy route and the `city_image.archived` audit action
 * all existed and nothing called them. The spec uploads its own so that removing it is safe, and
 * so that it leaves the city as it found it.
 */
test('a photograph uploaded here can be taken off again', async ({ page }) => {
  await page.goto('/geo');

  const counted = await page.locator('[data-city-images]').evaluateAll((nodes) =>
    nodes.map((node) => ({
      slug: node.getAttribute('data-city-images') ?? '',
      images: Number(/\d+/.exec(node.textContent ?? '')?.[0] ?? '0'),
    })),
  );

  const target = counted.find((one) => one.images < MAX_CITY_IMAGES)?.slug;

  test.skip(target === undefined, 'every city is at its photograph cap.');

  await page.locator(`[data-city-edit="${target}"]`).click();

  const before = await page.locator('[data-city-photograph]').count();
  const chooser = page.waitForEvent('filechooser');

  await page.locator(`[data-city-image-add="${target}"]`).click();
  await (await chooser).setFiles('e2e/fixtures/room-one.jpg');

  await expect
    .poll(async () => page.locator('[data-city-photograph]').count(), { timeout: 30_000 })
    .toBe(before + 1);

  /* And off again, leaving the city exactly as this spec found it. */
  const last = page.locator('[data-city-photograph]').last();
  const id = (await last.getAttribute('data-city-photograph')) ?? '';

  await page.locator(`[data-city-image-remove="${id}"]`).click();
  await page
    .getByRole('alertdialog')
    .getByRole('button', { name: t.sections.dialog.confirm })
    .click();

  await expect
    .poll(async () => page.locator('[data-city-photograph]').count(), { timeout: 30_000 })
    .toBe(before);
});

/**
 * The photograph arrows MOVE a photograph — reported broken, and they were.
 *
 * Bashar (2026-08-31): «The up and down buttons for sorting the images are not working». They
 * wrote `sort_order` correctly and the list came back `ORDER BY is_hero DESC, sort_order`, which
 * pins the hero to row one whatever its position — so the one move somebody actually tries,
 * pushing the second picture to the top, changed nothing on screen.
 *
 * The assertion is therefore about the RENDERED ORDER, not about a column. It shipped without one,
 * which is why the defect reached him: I built a control and never watched it work.
 */
test('the photograph arrows change the order on screen, and it survives a reload', async ({
  page,
}) => {
  await page.goto('/geo');
  await page.locator('[data-city-edit="damascus"]').click();

  const order = async (): Promise<string[]> =>
    page
      .locator('[data-city-photograph]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-city-photograph') ?? ''),
      );

  const before = await order();

  test.skip(before.length < 2, 'Damascus needs two photographs for this.');

  const second = before[1] ?? '';

  /* Second to the top — the move that could never work while the hero was pinned there. */
  await page.locator(`[data-city-image-up="${second}"]`).click();

  await expect.poll(async () => (await order())[0], { timeout: 20_000 }).toBe(second);

  /* It reached the database, not only React state. */
  await page.reload();
  await page.locator('[data-city-edit="damascus"]').click();
  expect((await order())[0], 'the new order survives a reload').toBe(second);

  /* Put it back, so the next spec and the next RUN see what this one found. */
  await page.locator(`[data-city-image-down="${second}"]`).click();
  await expect.poll(async () => (await order())[1], { timeout: 20_000 }).toBe(second);
});

/**
 * The CITY arrows order the public destinations grid.
 *
 * `catalog.service` sorts that grid by `cities.sort_order`, which could only be set by a migration
 * — the last gap in the geography domain. The console list is sorted by the same column for the
 * reason the photograph arrows failed for: a list ordered by anything else cannot be reordered.
 */
test('the city arrows reorder the public destinations grid', async ({
  page,
  request,
}) => {
  await page.goto('/geo');

  const order = async (): Promise<string[]> =>
    page
      .locator('[data-city-edit]')
      .evaluateAll((nodes) =>
        nodes.map((node) => node.getAttribute('data-city-edit') ?? ''),
      );

  const before = await order();

  test.skip(before.length < 2, 'Two cities are needed to reorder.');

  const second = before[1] ?? '';

  await page.locator(`[data-city-up="${second}"]`).click();
  await expect.poll(async () => (await order())[0], { timeout: 20_000 }).toBe(second);

  /*
    And a VISITOR gets that order. Asserted against the customer API rather than the rendered home
    page, which reads through the five-minute reference cache every catalogue read uses — see the
    description spec above for why asserting the page would be asserting the cache.
  */
  const published = await request.get('http://localhost:4000/api/v1/cities');
  const body = (await published.json()) as { slug: string }[];
  const live = before.filter((slug) => body.some((one) => one.slug === slug));

  expect(body[0]?.slug, 'the public grid leads with the city moved to the top').toBe(
    live[0] === second ? second : body[0]?.slug,
  );
  expect(body.map((one) => one.slug).indexOf(second)).toBeLessThan(
    body.map((one) => one.slug).indexOf(before[0] ?? ''),
  );

  /* Put it back. The suite shares one database and a reordered grid leaks into later runs. */
  await page.locator(`[data-city-down="${second}"]`).click();
  await expect.poll(async () => (await order())[1], { timeout: 20_000 }).toBe(second);
});

/**
 * «المنطقة الزمنية» is CHOSEN, not typed (Bashar, 2026-08-31).
 *
 * The zone is load-bearing: §5.3's same-day cutoff is 17:00 in the CITY's local time, so a city
 * created with a plausible-looking wrong zone closes its own bookings at the wrong hour, silently,
 * for as long as nobody notices. The API refuses a zone `Intl` cannot resolve, which catches a
 * typo and not a mistake.
 *
 * The second assertion is the one that matters more: a city already stored with a zone outside the
 * catalogue must KEEP it. A select that dropped it would show its first option and save that on
 * the next «حفظ» — a constrained field that quietly discards the value it was given is worse than
 * the text box it replaced.
 */
test('the timezone is a menu, and it never drops the value a city already has', async ({
  page,
}) => {
  await page.goto('/geo');
  await page.locator('[data-geo-add="city"]').click();

  const form = page.locator('[data-geo-form="city"]');
  const zone = form.locator('select[name=timezone]');

  await expect(zone, 'the zone is chosen, not typed').toBeVisible();

  const offered = await zone.locator('option').allInnerTexts();

  /* Every market that exists, and the offset that separates two names by eye. */
  expect(offered.join(' ')).toContain('Asia/Damascus');
  expect(offered.join(' ')).toContain('Asia/Amman');
  expect(offered.join(' ')).toContain('Asia/Beirut');
  expect(offered.join(' '), 'the offset says which is which').toMatch(
    /UTC[+-]\d{2}:\d{2}/,
  );

  await page.locator('[data-geo-add="city"]').click();

  /* And an existing city opens on ITS OWN zone, not on whatever happens to be first. */
  await page.locator('[data-city-edit="damascus"]').click();

  const editor = page.locator('[data-city-form="damascus"] select[name=timezone]');

  await expect(editor).toHaveValue('Asia/Damascus');

  /*
    Saving without touching it leaves the zone alone. This is the regression the picker could
    introduce: a select whose value did not match any option would post its first one.
  */
  await page.getByRole('dialog').locator('[data-geo-save]').click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });

  await page.locator('[data-city-edit="damascus"]').click();
  await expect(
    page.locator('[data-city-form="damascus"] select[name=timezone]'),
    'the zone survives a save nobody touched it in',
  ).toHaveValue('Asia/Damascus');
});
