import { expect, test } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * الإعلانات, from creating the advertiser to recording that they paid.
 *
 * In a BROWSER because `pnpm verify` is HTTP-level and this page's defect was exactly the kind it
 * cannot see: the screen rendered perfectly, the `AD_MANAGE` permission existed, the table existed
 * — and there was no control anywhere that created a campaign. «Built, green, and connected to
 * nothing» is the state this file exists to catch.
 *
 * The engine is held by the integration suites (`ad-management`, `ad-delivery`, `ad-expiry`); this
 * is the half a person meets.
 */
test.describe('الإعلانات', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  const iso = (d: Date): string => d.toISOString().slice(0, 10);

  /**
   * A campaign, end to end: the advertiser it needs, the campaign, and the invoices that follow.
   *
   * The advertiser half is not incidental. `advertisers` had a table and no create route, so the
   * FIRST campaign was unreachable — every one needs an advertiser reference and there was nowhere
   * to obtain one. A test that seeded an advertiser directly would pass over exactly that gap.
   */
  test('creates an advertiser, a campaign, and its invoices', async ({ page }) => {
    await page.goto('/ads');

    await page.getByRole('button', { name: /معلن جديد/ }).click();

    const stamp = Date.now().toString().slice(-8);
    const advertiserName = `مطعم اختبار ${stamp}`;

    await page.getByLabel('الاسم', { exact: true }).fill(advertiserName);

    /* The city is a SLUG, and the campaign form asks for the same one. */
    const citySlug = await page.evaluate(() => {
      const link = document.querySelector<HTMLAnchorElement>('a[href*="/city/"]');

      return link?.href.split('/city/')[1]?.split(/[?#]/)[0] ?? '';
    });

    await page
      .getByLabel('المدينة (المُعرِّف)', { exact: true })
      .first()
      .fill(citySlug || 'damascus');

    const addAdvertiser = page.getByRole('button', { name: 'إضافة المعلن' });

    await expect(addAdvertiser, 'armed once it has a name and a city').toBeEnabled();
    await addAdvertiser.click();

    /* The reference is SHOWN, because the campaign form asks for it and nothing else reveals it. */
    const confirmation = page.getByText(/أُضيف المعلن/);

    await expect(confirmation).toBeVisible();

    const reference = (await confirmation.innerText()).match(/ADV-\d+/)?.[0] ?? '';

    expect(reference, 'the new advertiser names itself').toMatch(/^ADV-\d+$/);

    /*
      ── the campaign ────────────────────────────────────────────────────────

      No second click: creating an advertiser opens the campaign form with the new reference
      already in it. Driving this by hand is what found the alternative — the triggers are hidden
      while a panel is open, so «+ حملة جديدة» was unreachable, and «إلغاء» discarded the reference
      the operator had just been shown and was about to need.
    */
    const submit = page.getByRole('button', { name: /^إنشاء الحملة$/ });

    await expect(submit, 'no headline and no window yet').toBeDisabled();
    await expect(
      page.getByLabel('المعلن (المرجع)'),
      'the advertiser just created is already named',
    ).toHaveValue(reference);
    await expect(
      page.getByLabel('المدينة (المُعرِّف)', { exact: true }),
      'and so is the city it was created in',
    ).toHaveValue(citySlug || 'damascus');

    await page.getByLabel('العنوان بالعربية').fill(`إعلان اختبار ${stamp}`);
    await page.getByLabel('العنوان بالإنجليزية').fill(`Test ad ${stamp}`);
    await page.getByLabel('العنوان بالألمانية').fill(`Testanzeige ${stamp}`);

    await expect(submit, 'still no target and no window').toBeDisabled();

    await page.getByLabel(/^الرابط/).fill('https://example.test/menu');
    await page.getByLabel('السعر لكل دورة (اختياري)').fill('150');

    const today = new Date();

    await page.getByLabel('يبدأ في').fill(iso(today));
    await expect(submit, 'a start alone is not a window').toBeDisabled();

    await page
      .getByLabel('ينتهي في')
      .fill(iso(new Date(today.getTime() + 60 * 86_400_000)));
    await expect(submit).toBeEnabled();
    await submit.click();

    /*
      ── created, and the creative dialog is ALREADY OPEN (Bashar, 2026-08-27) ─

      «After a campaign is created successfully, automatically open the Edit / Creative dialog for
      the newly created campaign.» The picture stays optional and the campaign is valid without
      one; this only puts the operator in front of the control rather than leaving them to find
      the row. Asserted on the real create path, because the wiring runs from the toolbar's
      redirect through the page's `searchParams` to the row's `autoOpen` — three places, any of
      which could be right on its own while the flow is broken.
    */
    const opened = page.getByRole('dialog');

    await expect(opened, 'the new campaign opens its own creative dialog').toBeVisible();
    await expect(page).toHaveURL(/[?&]created=ADS-/);

    await opened.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await expect(opened).toBeHidden();

    /*
      And the parameter is gone, so a reload does not reopen a dialog that was closed. Checked
      because `history.replaceState` is silent: leaving it out changes nothing a person sees until
      they press refresh, which is exactly when they would not connect it to this.
    */
    await expect(page).not.toHaveURL(/[?&]created=/);

    /* The campaign is on top of its registry, live, in the city it was made for. */
    const row = page.locator('tbody tr').first();

    await expect(row).toContainText(advertiserName);

    /*
      ── «بلا صورة» on the row (Bashar, 2026-08-27) ───────────────────────────

      «I would also like a clear visual indication in the table when a campaign has no creative
      image yet, so operators can identify incomplete campaigns without opening every dialog.» A
      brand-new campaign is exactly that case, so this is the one row guaranteed to carry it.
    */
    await expect(
      row.locator('[data-no-creative]'),
      'a campaign with no creative says so on its row',
    ).toHaveText('بلا صورة');

    /*
      A DRAFT, and then live — both halves, because the second was unreachable.

      Every campaign is created as a draft so the creative is confirmed before an advertiser's
      window opens. The row's only control said «إيقاف» and would have moved it draft → paused, so
      a campaign made in this console could never be made live from this console. Asserting the
      draft alone would have documented that defect as the design.
    */
    await expect(row.locator('[data-status-pill]')).toHaveText('مسودة');
    await row.getByRole('button', { name: 'تشغيل' }).click();

    await expect(
      page.locator('tbody tr').first().locator('[data-status-pill]'),
      'a draft can be started from its own row',
    ).toHaveText('نشط');

    /* And the control flips, so a live campaign can be taken down again. */
    await expect(
      page.locator('tbody tr').first().getByRole('button', { name: 'إيقاف' }),
    ).toBeVisible();

    /*
      ── the creative, edited from the row ───────────────────────────────────

      `PATCH /admin/ad-campaigns/:reference` shipped with no caller at all — the same «built and
      connected to nothing» shape the whole domain had, reproduced one level down in my own work.
      A typo in a headline is visible to every customer in the city until somebody can fix it.
    */
    const live = page.locator('tbody tr').first();

    await live.getByRole('button', { name: 'تعديل', exact: true }).click();

    /*
      A DIALOG over the table, not a panel inside the cell (Bashar, 2026-08-27).

      الحالة is about 150px wide and neither shape that stays inside a table cell works: a panel
      spanning the cell is still 150px, and an absolutely positioned popover is CLIPPED by the
      table's own `overflow-x-auto` box — measured at 163px rendered against 304px asked for.
    */
    const dialog = page.getByRole('dialog');

    await expect(dialog, 'the edit opens in a dialog').toBeVisible();

    const save = dialog.getByRole('button', { name: 'حفظ' });

    await expect(save, 'nothing has changed yet').toBeDisabled();

    const edited = `إعلان معدَّل ${stamp}`;

    await dialog.getByLabel('العنوان بالعربية').fill(edited);
    await expect(save).toBeEnabled();
    await save.click();

    await expect(dialog, 'the dialog closes on a successful save').toBeHidden();
    await expect(page.locator('tbody tr').first()).toContainText(advertiserName);

    /*
      And the row SHOWS the new headline (Bashar, 2026-08-27).

      «when I edit a row and save, nothing changes, is that correct?» — it was correct, and it was
      the defect: none of the four fields this form edits appeared anywhere on the screen, so a save
      that worked was indistinguishable from one that had failed silently. This is the assertion
      that was missing. The suite passed against a build where the write landed and the person who
      made it could not tell.
    */
    await expect(
      page.locator('tbody tr').first(),
      'the edit is visible to the person who made it',
    ).toContainText(edited);

    /*
      And the money followed it, in the same transaction.

      Two months at a monthly price is two invoices, and the whole point of issuing them at creation
      is that every period the campaign will ever be billed for is already known. A test that only
      checked the campaign row would pass over a campaign nobody can invoice.
    */
    /*
      By MARKER, not by position: an empty `AdminTable` renders «لا نتائج» and no `<table>` at
      all, so «the second table on the page» is a locator that finds the campaign registry on a
      console with no invoices — and asserts the wrong thing rather than failing.
    */
    const invoices = page.locator('[data-ad-invoices] tbody tr');

    await expect(invoices.first()).toContainText(advertiserName);
    await expect(invoices.first().locator('[data-status-pill]')).toHaveText('مستحقة');
    /*
      Never a bare figure — a CODE or a symbol, whichever the formatter chose.

      This first named only the three-letter codes and failed against «150.00 ل.س», which is the
      correct rendering, not a defect. SYP and USD differ by four orders of magnitude, so what the
      rule requires is that SOMETHING beside the number says which one it is.
    */
    await expect(invoices.first(), 'never a bare figure').toContainText(
      /\b(?:USD|EUR|SYP|SAR|JOD|TRY|AED|GBP)\b|[$€£]|ل\.س/,
    );
  });

  /**
   * The dialog behaves like a dialog.
   *
   * Escape closes it, the backdrop closes it, and focus returns to the button that opened it — the
   * last is the part a bare `fixed` overlay does not give you, and without it a keyboard reader is
   * returned to the top of the document having lost the row they were working on.
   */
  test('closes on Escape and gives the focus back', async ({ page }) => {
    await page.goto('/ads?size=5');
    await page.waitForSelector('tbody tr');

    const trigger = page
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: 'تعديل', exact: true });

    await trigger.click();
    await expect(page.getByRole('dialog')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();

    await expect(trigger, 'focus came back to where it started').toBeFocused();
  });

  /**
   * A creative goes through the platform's pipeline, and what comes back is OURS.
   *
   * The assertion that matters is `naturalWidth`: the row can say `ready` and the URL can be right
   * while the browser renders nothing — which is exactly what happened before `ads/*` was added to
   * the object store's public-read policy, silently, with no request anybody could see.
   */
  test('saves a creative when the picture is the only change', async ({ page }) => {
    await page.goto('/ads?size=5');
    await page.waitForSelector('tbody tr');
    await page
      .locator('tbody tr')
      .first()
      .getByRole('button', { name: 'تعديل', exact: true })
      .click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible();

    const save = dialog.getByRole('button', { name: 'حفظ', exact: true });

    await expect(save, 'nothing is different yet').toBeDisabled();

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/room-one.jpg');

    /*
      ── the whole of Bashar's report, 2026-08-27 ─────────────────────────────

      «When I change only the image, I should be able to save!» حفظ was gated on the four text
      fields alone, so the one change an operator makes most often left it greyed out. Watched to
      fail: dropping `pending !== null` from `changed` makes this line red.
    */
    await expect(save, 'the picture alone is a change worth saving').toBeEnabled();
    await expect(dialog, 'and it says it has not been sent yet').toContainText(
      'ستُرفع عند الحفظ',
    );

    await save.click();

    /*
      The render is a QUEUED job, so the tile is a placeholder until a worker has run. Polled
      rather than slept on: the wait is for the row to reach `ready`, and how long that takes is
      not this test's business.

      `naturalWidth` is the assertion that matters. The row can say `ready` and the URL can be
      right while the browser renders nothing — which is exactly what happened before `ads/*` was
      added to the object store's public-read policy, silently, with no request anybody could see.
    */
    const picture = dialog.locator('img');

    await expect(picture).toBeVisible({ timeout: 30_000 });
    await expect
      .poll(
        async () => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        { timeout: 30_000, message: 'the browser actually loaded the re-encoded image' },
      )
      .toBeGreaterThan(0);

    /*
      And REPLACING it works (Bashar, 2026-08-27: «it keeps loading and nothing happens»).

      The job id was keyed on the campaign ROW, which is the same row for every upload against it —
      so the second `add` collided with the first, BullMQ ignored it, and the row sat at
      `processing` for ever. `ad-creative.integration.test.ts` holds the ids; this holds what a
      person actually meets.

      The assertion is that the src CHANGES. A first pass asserted only `naturalWidth > 0`, which
      the ALREADY-LOADED first image satisfies instantly — it passed against the broken build, which
      is the vacuous shape this suite's own history keeps producing.
    */
    const first = await picture.getAttribute('src');

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/room-two.jpg');
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();

    await expect
      .poll(async () => picture.getAttribute('src'), {
        timeout: 40_000,
        message: 'the replacement reaches the dialog',
      })
      .not.toBe(first);

    await expect
      .poll(
        async () => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        { timeout: 40_000 },
      )
      .toBeGreaterThan(0);

    /* And the row stops saying «بلا صورة», because it now has one. */
    await dialog.getByRole('button', { name: 'إغلاق', exact: true }).click();
    await expect(
      page.locator('tbody tr').first().locator('[data-no-creative]'),
    ).toBeHidden();
  });

  /**
   * The file WAITS for حفظ, and إلغاء throws it away.
   *
   * It used to upload the instant it was chosen, which broke the dialog's contract in both
   * directions at once — حفظ disabled on the only change that had been made, and إلغاء unable to
   * undo the one it had already committed. Bashar, 2026-08-27: «Save should commit the image
   * change and Cancel should discard it rather than uploading immediately when a file is
   * selected.»
   *
   * The strong half is the REQUEST assertion. «The picture did not change» is also what a screen
   * that failed to refresh looks like; counting the POSTs distinguishes «never sent» from «sent
   * and not shown», and only one of those is the behaviour asked for.
   */
  test('sends nothing until حفظ, and إلغاء discards the choice', async ({ page }) => {
    const uploads: string[] = [];

    page.on('request', (request) => {
      if (request.method() === 'POST' && request.url().includes('/creative')) {
        uploads.push(request.url());
      }
    });

    await page.goto('/ads?size=5');
    await page.waitForSelector('tbody tr');

    const row = page.locator('tbody tr').first();

    await row.getByRole('button', { name: 'تعديل', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible();

    const before = await dialog.locator('img').count();

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/room-one.jpg');
    await expect(dialog).toContainText('ستُرفع عند الحفظ');

    /* Nothing has left the browser. Watched to fail by uploading on `change` again. */
    expect(uploads, 'choosing a file sends nothing').toStrictEqual([]);

    await dialog.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await expect(dialog).toBeHidden();

    /* Still nothing — closing is not a deferred send. */
    expect(uploads, 'إلغاء sends nothing either').toStrictEqual([]);

    await row.getByRole('button', { name: 'تعديل', exact: true }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog, 'the discarded choice is gone').not.toContainText(
      'ستُرفع عند الحفظ',
    );
    await expect(
      dialog.getByRole('button', { name: 'حفظ', exact: true }),
      'and there is nothing left to save',
    ).toBeDisabled();
    expect(await dialog.locator('img').count(), 'the creative is exactly as it was').toBe(
      before,
    );
  });

  /**
   * Taking the picture off, and keeping the campaign — Bashar, 2026-08-27.
   *
   * «I should be also able to remove the current image and keep the الإعلان without an image.»
   *
   * The two halves are asserted together and neither is enough alone: the picture is gone from the
   * dialog, AND the campaign is still in the registry saying what it said. A test that only checked
   * the first would pass just as happily against a route that deleted the campaign.
   *
   * Staged like an upload, so إلغاء puts it back. That case is asserted FIRST — an undo that
   * silently did nothing would leave the removal looking correct while the campaign lost its
   * picture to a click somebody took back.
   */
  test('removes the picture on حفظ, and puts it back on إلغاء', async ({ page }) => {
    await page.goto('/ads?size=5');
    await page.waitForSelector('tbody tr');

    /* A row that HAS a picture — the earlier tests upload one, so the first row is the one. */
    const row = page.locator('tbody tr').first();
    /*
      The REFERENCE, not the advertiser cell. Captured from that cell first, which was wrong twice
      over: it holds the advertiser and the headline on two lines, and after a removal it also
      holds «بلا صورة» — so the text captured before could never be a substring of the text after,
      and the test failed on a removal that had worked perfectly.
    */
    const reference = (await row.locator('td').first().innerText()).trim();

    await row.getByRole('button', { name: 'تعديل', exact: true }).click();

    const dialog = page.getByRole('dialog');

    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img'), 'this row has a creative to remove').toBeVisible({
      timeout: 30_000,
    });

    /* ── staged, then taken back ─────────────────────────────────────────── */
    await dialog.getByRole('button', { name: 'إزالة الصورة', exact: true }).click();
    await expect(dialog).toContainText('ستُزال عند الحفظ');
    await expect(
      dialog.getByRole('button', { name: 'حفظ', exact: true }),
      'a removal is a change worth saving',
    ).toBeEnabled();

    await dialog.getByRole('button', { name: 'التراجع عن الإزالة', exact: true }).click();

    await expect(dialog).not.toContainText('ستُزال عند الحفظ');
    await expect(dialog.locator('img'), 'the picture is back').toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'حفظ', exact: true }),
      'and there is nothing left to save',
    ).toBeDisabled();

    /* ── and now for real ────────────────────────────────────────────────── */
    await dialog.getByRole('button', { name: 'إزالة الصورة', exact: true }).click();
    await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();

    await expect(dialog, 'the dialog closes — there is nothing to render').toBeHidden();

    const after = page.locator('tbody tr').first();

    /* The campaign is still there, and still live. */
    await expect(after).toContainText(reference);
    await expect(
      after.locator('[data-status-pill]'),
      'removing a picture does not disturb the campaign',
    ).toHaveText('نشط');
    await expect(
      after.locator('[data-no-creative]'),
      'and the row now says it has no picture',
    ).toHaveText('بلا صورة');

    /* Reopened, it offers to CHOOSE rather than to replace — there is nothing to replace. */
    await after.getByRole('button', { name: 'تعديل', exact: true }).click();

    await expect(dialog).toBeVisible();
    await expect(dialog.locator('img')).toBeHidden();
    await expect(
      dialog.getByRole('button', { name: 'اختر صورة', exact: true }),
    ).toBeVisible();
    await expect(
      dialog.getByRole('button', { name: 'إزالة الصورة', exact: true }),
      'nothing to remove, so nothing offers to',
    ).toBeHidden();
  });

  /**
   * Recording a payment needs a note, and the note reaches the audit log.
   *
   * A ledger pair that cannot be unposted is worth one sentence about how the money arrived. The
   * button is disabled without it AND the contract refuses an empty one — this asserts the half an
   * operator meets.
   */
  test('will not record a payment without saying how it arrived', async ({ page }) => {
    await page.goto('/ads');

    const due = page
      .locator('[data-ad-invoices] tbody tr')
      .filter({ has: page.locator('[data-status-pill]', { hasText: 'مستحقة' }) })
      .first();

    const count = await due.count();

    test.skip(count === 0, 'No unpaid ad invoice on the first page to record against.');

    /*
      The REFERENCE, captured before anything changes.

      The assertion below used to read «the first row after the refresh», which is not necessarily
      the row that was paid — the list is ordered by period, not by what somebody just touched. It
      would pass on a console where a different invoice happened to be settled first, which is the
      vacuous shape this suite's own history keeps producing.
    */
    const reference = ((await due.innerText()).match(/ADI-\d+/) ?? [''])[0];

    expect(reference, 'the row names the invoice being paid').toMatch(/^ADI-\d+$/);

    await due.getByRole('button', { name: 'تسجيل السداد' }).click();

    const confirm = due.getByRole('button', { name: 'تأكيد' });

    await expect(confirm, 'no note, no posting').toBeDisabled();

    await due.getByRole('textbox', { name: 'كيف وصل المبلغ' }).fill('حوالة E2E');
    await expect(confirm).toBeEnabled();
    await confirm.click();

    await expect(
      page
        .locator(`[data-ad-invoices] tbody tr#row-${reference}`)
        .locator('[data-status-pill]'),
      'THAT invoice reads as settled',
    ).toHaveText('مسدَّدة');

    /* And it offers no second payment: the ledger pair is posted once or not at all. */
    await expect(
      page
        .locator(`[data-ad-invoices] tbody tr#row-${reference}`)
        .getByRole('button', { name: 'تسجيل السداد' }),
    ).toHaveCount(0);
  });

  /**
   * Two paged tables on one route, and neither may move the other.
   *
   * This is «a bar that drops its neighbour's page drops it in both directions». الإعلانات is the
   * fourth route to carry two tables, and the first three all shipped this defect at least once.
   */
  test('pages each table without moving the other', async ({ page }) => {
    await page.goto('/ads?page=1&size=10&ipage=1&isize=10');

    /* Search the campaign registry; the invoice table's own parameters must survive it. */
    await page.getByRole('searchbox', { name: /بحث بالمعلن أو المدينة/ }).fill('ADS');
    await page.getByRole('button', { name: 'بحث' }).first().click();

    await expect(page).toHaveURL(/isize=10/);
    await expect(
      page,
      'the campaign search did not take the invoice size with it',
    ).toHaveURL(/[?&]q=ADS/);

    /* And the other direction: searching the invoices keeps the registry's own page and size. */
    await page.goto('/ads?page=2&size=10&isize=10');
    await page.getByRole('searchbox', { name: /بحث برقم الفاتورة/ }).fill('ADI');
    await page.getByRole('button', { name: 'بحث' }).nth(1).click();

    await expect(page).toHaveURL(/[?&]iq=ADI/);
    await expect(page, "the registry's place survived").toHaveURL(/[?&]page=2/);
    await expect(page).toHaveURL(/[?&]size=10/);
  });

  /**
   * Both tables fit their columns, and the page never scrolls sideways.
   *
   * Measured at the widths the standing rule names rather than eyeballed. 1024 is the one that
   * regresses silently, because it is wide enough to look fine in a screenshot.
   */
  test('fits both tables without scrolling the page', async ({ page }) => {
    for (const width of [1440, 1280, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 950 });
      await page.goto('/ads');
      /*
        The PAGER, not a row.

        `tbody tr` was the wait, and it hung for thirty seconds on a console with no campaigns —
        which is the state a fresh database is in, and exactly the state «the state that made it
        visible» says to test. The bar renders whether the table is empty or full.
      */
      await page.waitForSelector('[data-table-total]');

      const sideways = await page.evaluate(
        () =>
          document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
      );

      expect(sideways, `the page scrolls sideways at ${width}px`).toBe(false);
    }
  });
});

/**
 * A campaign carries a DESCRIPTION, and emptying it takes it off (Bashar, 2026-08-31).
 *
 * The round trip is the assertion: written, reloaded, still there — then cleared, reloaded, gone.
 * The clearing half is the one that needs a browser, because the API distinguishes «leave this»
 * from «clear this» by whether the key is present, and only the form decides which it sends. A
 * dialog that omitted an emptied box would let an operator add a description and never remove one.
 */
test('الإعلانات › a campaign description is written, kept, and cleared', async ({
  page,
}) => {
  await page.goto('/ads');

  const row = page.locator('tbody tr').first();

  test.skip((await row.count()) === 0, 'No campaign on this database to edit.');

  await row.getByRole('button', { name: 'تعديل', exact: true }).click();

  const dialog = page.getByRole('dialog');

  await expect(dialog).toBeVisible();

  const arabic = dialog.getByLabel(t.sections.ads.fDescriptionAr);
  const written = `وصف تجريبي ${Math.random().toString(36).slice(2, 7)}`;

  await expect(arabic, 'the description is on the edit dialog').toBeVisible();

  await arabic.fill(written);
  await dialog.getByRole('button', { name: 'حفظ', exact: true }).click();
  await expect(dialog).toBeHidden({ timeout: 20_000 });

  /* It survives a reload — a value held only in React state would not. */
  await page.reload();
  await page
    .locator('tbody tr')
    .first()
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByLabel(t.sections.ads.fDescriptionAr),
  ).toHaveValue(written);

  /* And emptying the box CLEARS it, rather than leaving the old text in place. */
  await page.getByRole('dialog').getByLabel(t.sections.ads.fDescriptionAr).fill('');
  await page
    .getByRole('dialog')
    .getByRole('button', { name: 'حفظ', exact: true })
    .click();
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 20_000 });

  await page.reload();
  await page
    .locator('tbody tr')
    .first()
    .getByRole('button', { name: 'تعديل', exact: true })
    .click();
  await expect(
    page.getByRole('dialog').getByLabel(t.sections.ads.fDescriptionAr),
    'an emptied description is cleared, not left behind',
  ).toHaveValue('');
});
