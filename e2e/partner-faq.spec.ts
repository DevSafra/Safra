import { expect, test, type Page } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { findReference } from './partner-fixtures.js';
import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

/**
 * The partner's FAQ answers, driven the way a partner drives them (audit 2026-10-04).
 *
 * Two defects, both invisible to a test that only calls the service:
 *
 * - **Clearing an answer did nothing.** The form left an emptied box out of the save, the API only
 *   upserted, and «حُفظت الإجابات.» appeared above an answer that stayed on the public page.
 * - **One retired question froze the whole form.** A question SAFRA stopped asking keeps its
 *   answer on screen with «يمكنك تعديلها», and the form sends it with every save; the API refused
 *   it and rolled back every other answer with it.
 *
 * Everything is put back: the question is reactivated and the answer cleared, because the suite
 * shares one partner and one catalogue.
 */
test.use({ storageState: PARTNER_STATE });

const LISTING = 'qasr-al-sharq-lodge';

async function openForm(page: Page, reference: string) {
  await page.goto(`${PARTNER_BASE}/properties/${reference}/edit`);
  await expect(page.locator('[data-faq-answer]').first()).toBeVisible();
}

async function save(page: Page) {
  const done = page.waitForResponse(
    (r) => r.url().includes('/faq') && r.request().method() === 'PUT',
  );
  await page.getByRole('button', { name: t.faq.save }).click();
  return done;
}

test('a cleared answer is removed, and a retired question does not freeze the form', async ({
  page,
  browser,
}) => {
  const reference = await findReference(page, LISTING);
  await openForm(page, reference);

  /* The last question, to stay clear of anything another spec reads first. */
  const box = page.locator('[data-faq-answer]').last();
  const questionId = (await box.getAttribute('data-faq-answer')) ?? '';
  expect(questionId).not.toBe('');

  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const setActive = (isActive: boolean) =>
    staff.request.patch(`http://localhost:3001/api/faq/questions/${questionId}`, {
      data: { isActive },
    });

  try {
    /* Answer it. */
    await box.fill('إجابة اختبار الحذف');
    expect((await save(page)).ok()).toBe(true);

    /* Clear it: the saved answer must be GONE after a reload, not merely look gone. */
    await openForm(page, reference);
    const cleared = page.locator(`[data-faq-answer="${questionId}"]`);
    await expect(cleared).toHaveValue('إجابة اختبار الحذف');
    await cleared.fill('');
    expect((await save(page)).ok()).toBe(true);
    await openForm(page, reference);
    await expect(page.locator(`[data-faq-answer="${questionId}"]`)).toHaveValue('');

    /* Answer it again, then SAFRA retires the question. */
    await page.locator(`[data-faq-answer="${questionId}"]`).fill('قبل الإيقاف');
    expect((await save(page)).ok()).toBe(true);
    expect((await setActive(false)).ok(), 'the console retires the question').toBe(true);

    /* The retired answer is still shown, still editable, and saving it succeeds. */
    await openForm(page, reference);
    await expect(page.getByText(t.faq.retired)).toBeVisible();
    const retired = page.locator(`[data-faq-answer="${questionId}"]`);
    await expect(retired).toHaveValue('قبل الإيقاف');
    await retired.fill('بعد الإيقاف');

    const response = await save(page);
    expect(response.ok(), 'a retired answer froze the whole save').toBe(true);
    await expect(page.getByText(t.faq.saved)).toBeVisible();

    await openForm(page, reference);
    await expect(page.locator(`[data-faq-answer="${questionId}"]`)).toHaveValue(
      'بعد الإيقاف',
    );
  } finally {
    await setActive(true);
    await openForm(page, reference);
    await page.locator(`[data-faq-answer="${questionId}"]`).fill('');
    await save(page);
    await staff.close();
  }
});
