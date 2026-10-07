import { expect, test } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' with { type: 'json' };
import { reachCheckout } from './checkout-reach';

/**
 * A party the chosen rooms cannot sleep is told so before anything is typed (Bashar, 2026-10-07).
 *
 * The API refuses an over-capacity booking, but only at submit, after the guest has given a name, a
 * phone and a card. So the checkout now compares the party with what the quoted rooms sleep and,
 * when it does not fit, shows why and the way back instead of the form. Nobody is dropped from the
 * party to make it fit; that was tried on 2026-10-06 and booked two guests for a family of four.
 */
test.use({ baseURL: 'http://localhost:3000' });

const copy = ar.checkout;

test('a party too large for the rooms is told so instead of being given the form', async ({
  page,
}) => {
  test.skip(!(await reachCheckout(page)), 'No bookable unit to reach checkout with.');

  const fits = new URL(page.url());

  /* The control first: the stay as the basket made it fits, and the guest gets the form. */
  await expect(page.getByLabel(/الاسم الكامل/).first()).toBeVisible();
  await expect(page.getByText(copy.partyTooLarge)).toHaveCount(0);

  /* The same stay for thirty adults: more than one room of any fixture sleeps. */
  const tooMany = new URL(fits);

  tooMany.searchParams.set('adults', '30');
  tooMany.searchParams.set('children', '2');
  await page.goto(tooMany.pathname + tooMany.search);

  await expect(page.getByRole('heading', { name: copy.partyTooLarge })).toBeVisible();
  await expect(page.getByText(/الضيوف: 32/)).toBeVisible();
  await expect(page.getByLabel(/الاسم الكامل/), 'no form to fill in').toHaveCount(0);

  /* The way back carries the stay and the whole party, so nothing is retyped and nobody is lost. */
  const back = page.getByRole('link', { name: copy.changeRooms });
  const href = new URL((await back.getAttribute('href')) ?? '', fits.origin);

  expect(href.pathname).toMatch(/^\/ar\/property\//);
  expect(href.searchParams.get('adults')).toBe('30');
  expect(href.searchParams.get('children')).toBe('2');
  expect(href.searchParams.get('checkIn')).toBe(fits.searchParams.get('checkIn'));
  expect(href.searchParams.get('checkOut')).toBe(fits.searchParams.get('checkOut'));
});
