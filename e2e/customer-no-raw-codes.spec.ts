import { expect, test } from '@playwright/test';

/**
 * The customer site, swept for technical codes on screen.
 *
 * The third of the three sweeps Bashar's instruction of 2026-09-08 calls for — the console's is
 * `no-raw-codes.spec.ts` and the portal's is `partner-no-raw-codes.spec.ts`, and the finding that
 * motivated all three is recorded there. A guest is the least expert reader on the platform and
 * the one with no way to look a code up, so there is no allow-list on this side.
 *
 * ## Signed out AND signed in
 *
 * The public pages carry search facets, amenity lists and cancellation policies — every one of
 * which is an enum somewhere — and the account pages carry the states a guest reads about their own
 * money. Both halves are walked, because the second needs a session and a spec that skipped it
 * would leave حسابي unswept, which is where the states are.
 */
const PUBLIC = ['/ar', '/ar/search', '/ar/terms', '/ar/privacy'];

const ACCOUNT = [
  '/ar/account',
  '/ar/account/bookings',
  '/ar/account/invoices',
  '/ar/account/disputes',
  '/ar/account/support',
  '/ar/account/gifts',
  '/ar/account/wallet',
  '/ar/account/profile',
  '/ar/account/reviews',
  '/ar/account/favourites',
];

const IDENTIFIER = /\b[a-z][a-z0-9]*(?:\.[a-z][a-z0-9]*)*(?:_[a-z0-9]+)+\b/g;

/**
 * Identifiers a reader is MEANT to see, and why.
 *
 * The privacy policy names the three cookies SAFRA sets, and it has to name them EXACTLY: the
 * reader's own browser calls them `safra_session` and `safra_currency`, so a translated name would
 * make the policy unverifiable — and naming them is the point of that section rather than an
 * accident of it. This is the only case on the customer site, and it is listed as two values rather
 * than as «ignore the privacy page» so that a code appearing anywhere ELSE on that page still
 * fails.
 */
const READER_FACING = new Set(['safra_session', 'safra_currency']);

const EMAIL = 'customer@safra.test';
const PASSWORD = process.env['TESTBED_PASSWORD'] ?? 'a-testbed-password-1';

test.use({
  baseURL: 'http://localhost:3000',
  storageState: { cookies: [], origins: [] },
});

test('no customer screen shows a technical code as a value', async ({ page }) => {
  const found: string[] = [];
  let read = 0;

  const walk = async (paths: readonly string[]): Promise<void> => {
    for (const path of paths) {
      const response = await page.goto(path, { waitUntil: 'domcontentloaded' });

      /* A 404 on a page this list names is a finding in itself, not something to walk past. */
      expect(response?.status(), `${path} did not render`).toBeLessThan(400);

      /*
        And it must be the page that was ASKED FOR.

        An account path signed out answers 307 to the login screen, which is a 200 with a `main` —
        so a walk that only checked the status read eight login pages and reported perfect health.
        That is precisely what happened: a code planted on حسابي was not caught, and the reason was
        this check being absent rather than the sweep being wrong. `waitForURL(/\/ar(\/|$)/)` below
        was the other half of it — that pattern matches `/ar/login`, so the wait for a successful
        sign-in succeeded on the login page.
      */
      expect(new URL(page.url()).pathname, `${path} redirected away`).toBe(path);

      const text = await page.locator('main').innerText();

      read += text.length;

      for (const token of new Set(text.match(IDENTIFIER) ?? [])) {
        if (READER_FACING.has(token)) continue;

        found.push(`${path} — «${token}»`);
      }
    }
  };

  await walk(PUBLIC);

  /* Then signed in, for the screens where a guest reads their own states. */
  await page.goto('/ar/login');
  await page.locator('input[name=email]').fill(EMAIL);
  await page.locator('input[name=password]').fill(PASSWORD);
  await page.locator('form button[type=submit]').first().click();

  /* Away from the login page — not merely «somewhere under /ar», which the login page satisfies. */
  await page.waitForURL((url) => !url.pathname.startsWith('/ar/login'), {
    timeout: 20_000,
  });
  await expect(
    page.locator('input[name=password]'),
    'the sign-in did not complete, so حسابي would go unswept',
  ).toHaveCount(0);

  await walk(ACCOUNT);

  expect(read, 'the sweep read real screens').toBeGreaterThan(4000);

  expect(
    [...new Set(found)].sort(),
    'A technical code is on a customer screen. A guest cannot look one up — resolve it through ' +
      'the catalogue.',
  ).toStrictEqual([]);

  /*
    And the exemptions are held to account: each must still be ON the page it was excused for.

    An exemption whose reason has gone stops protecting anything and starts hiding the next value
    that happens to share the name — the failure `audit-catalogue.integration.test.ts` records
    about its own list. If the cookie section is reworded, this says so.
  */
  await page.goto('/ar/privacy', { waitUntil: 'domcontentloaded' });

  const policy = await page.locator('main').innerText();

  for (const cookie of READER_FACING) {
    expect(policy, `«${cookie}» is exempted and is no longer on the policy`).toContain(
      cookie,
    );
  }
});
