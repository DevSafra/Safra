import { expect, test } from '@playwright/test';

import ar from '../packages/i18n/src/messages/web/ar.json' assert { type: 'json' };

/**
 * Guest reviews on the public property page (§5.6, §7.3).
 *
 * ## The assertion that matters is a negative one
 *
 * A review staff have hidden must never appear here. That is enforced by a `status = 'published'`
 * predicate in the API's WHERE clause and asserted directly in `review.integration.test.ts`; what
 * a browser adds is that the RENDERED page agrees — a component that received four reviews and
 * drew five would be invisible to an API test.
 *
 * ## No sign-in, so no login budget spent
 *
 * A property page is public. This spec runs in the ordinary `chromium` project.
 */
const SLUG = 'qasr-al-sharq-malki';

test.use({ baseURL: 'http://localhost:3000' });

test.describe('reviews on a property page', () => {
  test('shows the guest reviews, the total, and the verified-stay note', async ({
    page,
  }) => {
    await page.goto(`/ar/property/${SLUG}`);

    await expect(
      page.getByRole('heading', { name: ar.property.reviewsTitle }),
    ).toBeVisible();

    /*
      The sample is named as a sample: "the 10 most recent of 132". `reviewsCount` is the
      trigger-maintained total over PUBLISHED reviews, so this line and the ★ beside the title
      cannot disagree — both read the same aggregate.
    */
    await expect(page.getByText(/أحدث .* من .* تقييم/)).toBeVisible();

    const reviews = page
      .locator('section', { hasText: ar.property.reviewsTitle })
      .locator('li');

    await expect(reviews.first()).toBeVisible();

    /* Every review says it came from a completed stay — the thing that makes it more than an opinion. */
    await expect(page.getByText(ar.property.reviewsVerified).first()).toBeVisible();
  });

  /**
   * §7.2 forbids showing a partner customer contact details; a public page has an even shorter
   * list. A first name makes a review read as a person's; a surname makes an ordinary opinion
   * searchable against its author for ever, which the reader gains nothing from.
   */
  test('publishes no contact details and no surnames', async ({ page, request }) => {
    /*
      Asserted against the API PAYLOAD and the reviews SECTION, not the whole document.

      A first attempt searched the entire HTML for a Syrian phone number and failed on
      `+963912345678` — the example inside the checkout form's «بصيغة دولية، مثل …» hint, which
      next-intl embeds along with every other message. Searching a page that carries its own
      translation bundle finds the dictionary, not the data.
    */
    const payload = await (
      await request.get(`http://localhost:4000/api/v1/properties/${SLUG}`)
    ).text();
    const reviews = JSON.stringify(JSON.parse(payload).reviews);

    expect(reviews).not.toMatch(/@safra\.test/);
    expect(reviews).not.toMatch(/\+9639\d{8}/);

    await page.goto(`/ar/property/${SLUG}`);

    const section = page.locator('section', { hasText: ar.property.reviewsTitle });
    const rendered = await section.innerText();

    expect(rendered).not.toMatch(/@safra\.test/);
    expect(rendered).not.toMatch(/\+9639\d{8}/);
    /* The seeded guests are «ليلى الحمصي» and friends — the family name must not be published. */
    expect(rendered).not.toContain('الحمصي');
  });

  /**
   * A property with no reviews says so rather than showing an empty box or a bare zero.
   *
   * The seed no longer declares a rating on a property that has none — it used to write
   * `rating: '4.9', reviewsCount: 118` as literals, and a listing showed «★ ٤٫٩ من ١١٨ تقييماً»
   * with not one review behind it. A trigger owns both columns now.
   */
  test('a listing with no reviews shows the empty state, not a fabricated score', async ({
    request,
  }) => {
    const response = await request.get(
      'http://localhost:4000/api/v1/properties/coastal-resort',
    );
    const property = (await response.json()) as {
      rating: string | null;
      reviewsCount: number;
      reviews: unknown[];
    };

    /* Whatever this listing has, the three must agree with each other. */
    if (property.reviews.length === 0) {
      expect(property.reviewsCount).toBe(0);
      expect(property.rating).toBeNull();
    } else {
      expect(property.reviewsCount).toBeGreaterThan(0);
      expect(property.rating).not.toBeNull();
    }
  });
});
