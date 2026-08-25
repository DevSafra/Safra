import { expect, test } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' assert { type: 'json' };

/**
 * §5.2's party, and §6.3 step 3's guest count — the whole way through.
 *
 * ## What the SRS audit found
 *
 * `bookingCreateSchema` has taken `adults`, `children` and `infants` since it was written, and the
 * customer app only ever sent the first. The search form had one number field, `PropertyCard`
 * linked to a property with no query at all, and the property page's «احجز الآن» hard-coded two
 * adults. So a family of four searched as a family of four and arrived at checkout as a party of
 * TWO — and `max_guests` was then checked against that undercount, which is how somebody is sold a
 * unit that cannot sleep them.
 *
 * ## Why this is one journey rather than three unit tests
 *
 * Every hop is a different file and each one looked correct on its own: the form posted what it
 * collected, the page read what it was given, the API validated what it received. The defect lived
 * in the JOINS — a link that dropped a parameter — and a link that drops a parameter is invisible
 * to everything except following it.
 *
 * No sign-in: search, property and checkout are all public, so this spends nothing from the auth
 * budget.
 */
test.use({ baseURL: 'http://localhost:3000' });

const PARTY = { adults: '2', children: '2', infants: '1' };

/**
 * Dates well into the future, supplied rather than defaulted.
 *
 * The search page falls back to TODAY, and §5.3 closes same-day booking after 17:00 in the city's
 * own timezone — so a spec that relied on the default returned «لا نتائج» and a cutoff notice
 * every evening and passed every morning. That is correct behaviour being mistaken for a fixture.
 */
function stay(): { checkIn: string; checkOut: string } {
  const day = (offset: number): string =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  return { checkIn: day(40), checkOut: day(43) };
}

test.describe('عدد الضيوف', () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test('carries the party from search to the payment summary', async ({ page }) => {
    const query = new URLSearchParams({ ...PARTY, ...stay() }).toString();

    await page.goto(`/ar/search?${query}`);

    // ── The form offers all three, and shows what was asked for ────────────────
    for (const [field, value] of Object.entries(PARTY)) {
      await expect(page.locator(`select[name="${field}"]`), field).toHaveValue(value);
    }

    // ── A result link carries the party ───────────────────────────────────────
    const card = page.locator('a[href*="/property/"]').first();

    await expect(card).toBeVisible({ timeout: 20_000 });

    const toProperty = (await card.getAttribute('href')) ?? '';

    /*
      Asserted on the HREF rather than by clicking and reading the URL: this is the hop that was
      broken, and a page that redirected to a sensible default would hide it behind a correct-looking
      address bar.
    */
    for (const [field, value] of Object.entries(PARTY)) {
      expect(toProperty, `${field} survives the result link`).toContain(
        `${field}=${value}`,
      );
    }

    // ── And the property's «احجز الآن» carries it into checkout ───────────────
    await page.goto(toProperty);

    const book = page.locator('a[href*="/checkout?"]').first();

    await expect(book).toBeVisible({ timeout: 20_000 });

    const toCheckout = (await book.getAttribute('href')) ?? '';

    /*
      `adults` is CLAMPED to the unit's capacity on the way, so it is checked as "present" rather
      than as an exact value — a one-bedroom studio must not link to a checkout for three. What
      must survive exactly are the two that were being dropped entirely.
    */
    expect(toCheckout, 'adults reaches checkout').toMatch(/adults=[1-9]/);
    expect(toCheckout, 'children reach checkout').toContain(`children=${PARTY.children}`);
    expect(toCheckout, 'infants reach checkout').toContain(`infants=${PARTY.infants}`);

    // ── §6.3 step 3: the summary states the guest count ───────────────────────
    await page.goto(toCheckout);

    const summary = page.getByText(ar.checkout.guestsSummary);

    await expect(summary, 'the count §6.3 step 3 requires').toBeVisible({
      timeout: 20_000,
    });

    /*
      The COUNTS, not merely the label. «عدد الضيوف» beside nothing is the same omission with a
      heading on it, and the plural forms are what a partner reads to prepare a room.

      The panel is located by its own heading rather than by a test id: this asserts what a person
      reading the page sees, and a summary that rendered the words somewhere else on the screen
      would not be the payment summary §6.3 step 3 is about.
    */
    const panel = page.locator('aside').filter({ hasText: ar.checkout.summary });

    await expect(panel).toContainText(ar.checkout.guestsSummary);
    /* Two children and one infant, in Arabic's dual and singular — not «٢» and «١». */
    await expect(panel, 'the children are named').toContainText('طفلان');
    await expect(panel, 'and the infant').toContainText('رضيع');
  });

  /**
   * The party is optional, and the screens must render without it.
   *
   * A reader arriving from a bookmark or a city page has no search behind them. Every parse in
   * this journey falls back, and this is the assertion that the fallbacks are real rather than
   * assumed — the same page, reached with nothing.
   */
  test('renders for a reader who never searched', async ({ page }) => {
    await page.goto('/ar/search');

    await expect(page.locator('select[name="adults"]')).toHaveValue('2');
    await expect(page.locator('select[name="children"]')).toHaveValue('0');
    await expect(page.locator('select[name="infants"]')).toHaveValue('0');
  });

  /**
   * A crafted party does not reach the API as one.
   *
   * `?children=abc` used to be `Number('abc')` → NaN, and every screen in this journey now clamps
   * instead. The page must render normally rather than turning a typed URL into an error screen.
   */
  test('clamps a nonsense party rather than failing', async ({ page }) => {
    const response = await page.goto(
      '/ar/search?adults=-5&children=abc&infants=9999&checkIn=&checkOut=',
    );

    expect(response?.status(), 'a page, not a 500').toBeLessThan(400);
    await expect(page.locator('select[name="children"]')).toHaveValue('0');
    /* Clamped to the schema's ceiling, not echoed back. */
    await expect(page.locator('select[name="infants"]')).not.toHaveValue('9999');
  });
});
