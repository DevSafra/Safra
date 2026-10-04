import { expect, test } from '@playwright/test';

import { partnerApplicationsOpen } from '../packages/contracts/src/partner-applications.js';

/**
 * «عن سفرة» (Bashar, 2026-10-04: a new page, in the navbar «between الرئيسية and تواصل معنا»).
 *
 * The page is composed of copy SAFRA already publishes, so what is asserted is that each part
 * reached it and each way onward goes somewhere: the menu item leads here and says it is here,
 * the pledges and services are the home page's own, and the partner and contact links resolve.
 */
test.use({ baseURL: 'http://localhost:3000' });

test('the navbar leads to «عن سفرة» and marks it as the current page', async ({
  page,
}) => {
  await page.goto('/ar');
  const item = page.locator('header nav').getByRole('link', { name: 'عن سفرة' });
  await expect(item).toHaveAttribute('href', '/ar/about');

  await item.click();
  await expect(page).toHaveURL(/\/ar\/about$/);
  await expect(
    page.locator('header nav').getByRole('link', { name: 'عن سفرة' }),
  ).toHaveAttribute('aria-current', 'page');
});

test('«عن سفرة» states what SAFRA is, its pledges, its services and the ways onward', async ({
  page,
  request,
}) => {
  await page.goto('/ar/about');

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('عن سفرة');
  /* The footer's own description of SAFRA, not a second wording of it. */
  await expect(page.locator('main')).toContainText(
    'سفرة منصّة لحجز الإقامات في الوطن العربي',
  );

  const pledges = page.getByRole('region', { name: 'عهود سفرة' });
  for (const title of [
    'علاقتك مع سفرة، لا مع العقار',
    'الثقة قبل الكمية',
    'تعويض خيبة الأمل',
  ]) {
    await expect(pledges.getByRole('heading', { name: title })).toBeVisible();
  }

  await expect(
    page.getByRole('region', { name: 'خدمات سفرة' }).locator('[data-service]'),
  ).toHaveCount(6);

  /*
    The partner offer exists only while the super admin keeps the form open (2026-10-04). This
    asserts whichever state the switch is in rather than demanding one: it is shared state on
    الإعدادات, and a person testing the console had turned it off when this failed a full run.
    `partner-applications-switch.spec.ts` drives both states on purpose.
  */
  const settings = (await (
    await request.get('http://localhost:4000/api/v1/settings/public')
  ).json()) as Record<string, unknown>;
  const onward = page.getByRole('region', { name: 'أدرج فندقك أو بيتك على سفرة' });

  if (partnerApplicationsOpen(settings)) {
    await expect(onward.getByRole('link', { name: 'سجّل كشريك' })).toHaveAttribute(
      'href',
      '/ar/partners/join',
    );
    await expect(onward.getByRole('link', { name: 'تواصل معنا' })).toHaveAttribute(
      'href',
      '/ar/contact',
    );
  } else {
    await expect(onward).toHaveCount(0);
  }
});

test('the English page is «About SAFRA», and the sitemap lists it', async ({
  page,
  request,
}) => {
  await page.goto('/en/about');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('About SAFRA');

  const sitemap = await (await request.get('/sitemap.xml')).text();
  expect(sitemap).toContain('/ar/about</loc>');
  expect(sitemap).toContain('/en/about</loc>');
});
