import { expect, test } from '@playwright/test';

import { STAFF_STATE } from './staff.js';

test.use({ storageState: STAFF_STATE });

/**
 * The queue's bar must page the QUEUE, and the registry's must page the REGISTRY.
 *
 * Two paged lists on one route, so the bars namespace their parameters. A bar that emitted the
 * plain names would move the list beside it — which is what the queues would have done before the
 * parameter names were derived from the section.
 */
test('each bar on /partners pages its own list', async ({ page }) => {
  await page.goto('/partners', { waitUntil: 'networkidle' });

  const names = await page.evaluate(() =>
    Array.from(document.querySelectorAll('input[name$="age"], select[name$="ize"]')).map(
      (el) => el.getAttribute('name'),
    ),
  );
  console.log('param names on the page:', JSON.stringify(names));

  expect(names).toContain('page');
  expect(names).toContain('size');
  expect(names).toContain('queuePage');
  expect(names).toContain('queueSize');

  /*
    Paging the QUEUE leaves the registry where it was.

    The queue is a `<ul>` of cards and the registry is a `<table>` — that is the distinction the
    pagination rule calls out ("'Table' means any paged list, not the `<table>` element"), and it is
    also the cleanest way to tell the two lists apart from outside.
  */
  const queueRefs = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('ul > li a[href*="/partners/PAR-"]')).map(
        (a) => (a.getAttribute('href') ?? '').split('?')[0],
      ),
    );
  const registryRefs = () =>
    page.evaluate(() =>
      Array.from(document.querySelectorAll('table tbody a[href*="/partners/PAR-"]')).map(
        (a) => (a.getAttribute('href') ?? '').split('?')[0],
      ),
    );

  const queue1 = await queueRefs();
  const registry1 = await registryRefs();

  await page.goto('/partners?queuePage=2', { waitUntil: 'networkidle' });

  const queue2 = await queueRefs();
  const registry2 = await registryRefs();

  console.log(`queue p1: ${queue1.length} rows, first ${queue1[0]}`);
  console.log(`queue p2: ${queue2.length} rows, first ${queue2[0]}`);

  expect(queue1.length, 'the queue renders rows').toBeGreaterThan(0);
  expect(queue2[0], 'queuePage=2 shows different partners').not.toBe(queue1[0]);
  expect(
    queue2.filter((r) => queue1.includes(r)),
    'page 2 of the queue must not repeat page 1',
  ).toEqual([]);
  expect(registry2, 'paging the queue must not move the registry').toEqual(registry1);

  /* And the mirror: paging the registry must leave the queue alone. */
  await page.goto('/partners?page=2', { waitUntil: 'networkidle' });

  expect(await queueRefs(), 'paging the registry must not move the queue').toEqual(
    queue1,
  );
  expect(await registryRefs()).not.toEqual(registry1);
});
