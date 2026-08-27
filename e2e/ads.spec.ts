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

    /* The campaign is on top of its registry, live, in the city it was made for. */
    const row = page.locator('tbody tr').first();

    await expect(row).toContainText(advertiserName);

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

    await live.getByRole('button', { name: 'تعديل الإعلان' }).click();

    const save = live.getByRole('button', { name: 'حفظ' });

    await expect(save, 'nothing has changed yet').toBeDisabled();

    await live.getByLabel('العنوان بالعربية').fill(`إعلان معدَّل ${stamp}`);
    await expect(save).toBeEnabled();
    await save.click();

    await expect(page.locator('tbody tr').first()).toContainText(advertiserName);
    await expect(
      page.locator('tbody tr').first().getByRole('button', { name: 'تعديل الإعلان' }),
      'the form closes and the row returns',
    ).toBeVisible();

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
