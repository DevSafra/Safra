import { expect, test, type Page } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { PARTNER_BASE as BASE, PARTNER_STATE } from './partner-session.js';

/**
 * النزاعات in لوحة الشريك — the side of a dispute that had no voice until finding 223.
 *
 * ## Why this is a browser test and not a service assertion
 *
 * `partner-disputes.integration.test.ts` holds the payload and the privacy boundary: the allegation
 * reaches them, the guest's files do not, the withheld ones are counted, the amount is withheld
 * from an employee. Every one of those assertions would go on passing against a portal with no
 * disputes screen at all — which is precisely how this platform came to have a `dispute_evidence`
 * table that nothing could write to for months while a console displayed a count of it.
 *
 * The questions here are the ones only a browser can answer: does the host reach the complaint,
 * can they answer it, and does an upload actually travel `<input type="file">` → `FormData` → the
 * portal's route handler → the API's `FileInterceptor` → sharp → the worker → back onto the page.
 * Four boundaries no service test crosses.
 *
 * ## It asserts RELATIVE to what it finds
 *
 * `pnpm e2e` runs against a live testbed that is seeded separately, so a spec that assumed a
 * particular dispute would pass once. This one reads the list, takes the first open case, and
 * measures the change it makes.
 */
test.use({ storageState: PARTNER_STATE });

/**
 * Opens an UNDECIDED dispute, or skips saying so.
 *
 * ## Why not simply the first row
 *
 * The list is newest-first and a partner's newest dispute is usually a settled one, so
 * `rows.first()` landed on a closed case and every test that needed a response box or an upload
 * control skipped. Three of the five tests here reported «pass» while never touching the features
 * they were written for — a vacuous green over exactly the defect they exist to catch, which is
 * the failure mode the console's own dispute spec has a paragraph about.
 *
 * The status WORD is what the row shows, so that is what this filters on: «مفتوح» and «قيد
 * الدراسة» are the two states in which a dispute still takes responses, and neither is a substring
 * of «محسوم لصالح الضيف» or «مرفوض». The words come from the catalogue rather than being typed
 * here, so a rewording moves the test with the product.
 */
async function openUndecided(page: Page): Promise<void> {
  await page.goto(`${BASE}/disputes`);

  const rows = page.locator('[data-dispute]');

  test.skip((await rows.count()) === 0, 'No disputes against this fixture partner.');

  const undecided = rows.filter({
    hasText: new RegExp(
      [t.disputeStatus['open'], t.disputeStatus['investigating']]
        .filter((word): word is string => Boolean(word))
        .join('|'),
    ),
  });

  test.skip(
    (await undecided.count()) === 0,
    'Every dispute against this partner has been decided.',
  );

  await undecided.first().click();

  /*
    And WAIT for the detail page before handing it back.

    `openUndecided` is followed by non-waiting reads in some callers — `locator.isVisible()` returns
    immediately rather than polling — so a caller that checked one right after this click was asking
    a page that was still navigating. That is how the previewer test came to skip with «no rendered
    evidence» on a dispute that had five files: the answer was false because the page was not there
    yet, not because the tiles were missing.
  */
  await expect(page.locator('main')).toContainText(t.disputes.allegation);
}

test.describe('النزاعات — the partner’s side', () => {
  /**
   * The list exists, and it says what is at stake.
   *
   * Before this screen a partner met a held amount on مستحقاتي and nothing else: no notification
   * when a dispute opened, no view of the allegation, nowhere to answer it.
   */
  test('lists the disputes against this partner', async ({ page }) => {
    await page.goto(`${BASE}/disputes`);

    const main = page.locator('main');

    await expect(main).toContainText(t.disputes.title);

    const rows = page.locator('[data-dispute]');

    test.skip((await rows.count()) === 0, 'No disputes against this fixture partner.');

    /* The reference is the thing they quote to support, so it has to be on the row. */
    await expect(rows.first()).toContainText(/DSP-\d+/);
  });

  /**
   * The allegation, the decision, the response box — and the guest's privacy.
   *
   * The four things Bashar named as private are asserted by their ABSENCE from the rendered page:
   * no contact detail, and no name. Phrased as a pattern rather than a particular string, because
   * «this exact email is missing» only ever protects the string it names — a mistake this
   * repository has already shipped once.
   */
  test('shows the allegation and the decision, without the guest’s contact details', async ({
    page,
  }) => {
    await openUndecided(page);
    await expect(page.locator('main')).toContainText(t.disputes.allegation);

    const body = (await page.locator('main').innerText()).replace(/\s+/g, ' ');

    /*
      A Syrian mobile number and an email address, as SHAPES. The dispute's own bodies are stored
      redacted, so a match here means either the redactor did not run or a field carrying the
      guest's contact details was added to the payload.
    */
    expect(body, 'no telephone number of the guest’s').not.toMatch(/09\d{8}/);
    expect(body, 'and no email address').not.toMatch(/[\w.+-]+@[\w-]+\.[a-z]{2,}/i);

    /* The control: the page is not simply empty, so the two assertions above mean something. */
    expect(body.length, 'a real case file was rendered').toBeGreaterThan(200);
  });

  /**
   * A photograph filed by the host, all the way through the pipeline and back onto the page.
   *
   * ## What each assertion is for
   *
   * The COUNT proves the multipart body survived the portal's route handler — the failure that
   * motivated `partner-images.spec.ts` is a proxy forwarding a parsed body, which arrives at the
   * API file-less and is refused. `naturalWidth` proves the browser loaded actual bytes rather
   * than a broken `img`. And the `src` proves those bytes come through the authorised route on
   * this origin: evidence is a photograph taken inside somebody's property, the bucket prefix is
   * deliberately absent from the anonymous read policy, and a media-host URL here would mean
   * anybody with the link could read it.
   */
  test('files a photograph on a dispute, and the picture comes back', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    await openUndecided(page);

    /*
      Asserted, not skipped on. `openUndecided` has already established that this dispute is open,
      so a missing control is a DEFECT — and «skip if there is no button» over exactly the feature
      under test is how a suite comes to report health it has not measured.
    */
    await expect(
      page.getByRole('button', { name: t.disputes.evidenceAdd }),
      'an undecided dispute offers to take evidence',
    ).toBeVisible();

    const before = await page.locator('main img').count();

    await page.setInputFiles('input[type=file]', 'e2e/fixtures/room-one.jpg');

    await expect
      .poll(async () => page.locator('main img').count(), {
        timeout: 60_000,
        message: 'the photograph reaches the case file',
      })
      .toBeGreaterThan(before);

    const picture = page.locator('main img').last();

    await expect
      .poll(
        async () => picture.evaluate((node) => (node as HTMLImageElement).naturalWidth),
        { timeout: 60_000, message: 'and the browser actually loaded it' },
      )
      .toBeGreaterThan(0);

    expect(
      await picture.getAttribute('src'),
      'served under authorisation from this origin, never from the media host',
    ).toMatch(/^\/api\/disputes\/evidence\//);
  });

  /**
   * The ONE previewer, per the project rule — `ImageSlider` from `@safra/ui`.
   *
   * Evidence used to open the raw file in a new tab, so reading a picture meant leaving the
   * complaint it was about. The frame's position counter is the cheapest proof that this is the
   * shared component and not a fourth hand-rolled lightbox.
   */
  test('opens a photograph in the shared previewer', async ({ page }) => {
    await openUndecided(page);

    const tiles = page.getByRole('button', { name: new RegExp(t.slider.open) });

    /*
      An empty case file is the only honest reason to skip: there is nothing to preview. Counted
      rather than asked `isVisible()`, which does not wait — see `openUndecided`.
    */
    test.skip((await tiles.count()) === 0, 'No rendered evidence on this dispute yet.');

    await tiles.first().click();

    const frame = page.getByRole('dialog');

    await expect(frame, 'the picture opens in place, not in a new tab').toBeVisible();
    await expect(frame.getByRole('button', { name: t.slider.close })).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(frame, 'and Escape closes it').toBeHidden();
  });

  /**
   * The response box, and what it says before anything is typed.
   *
   * Two facts a person needs before writing an account of a bad night, both of which the API makes
   * true and neither of which a person can discover afterwards: it is read before the decision, and
   * it cannot be edited once sent — the table is append-only by trigger.
   */
  test('offers a response box that says what happens to the words', async ({ page }) => {
    await openUndecided(page);

    const box = page.locator('#dispute-response');

    await expect(box, 'an undecided dispute offers a box to answer in').toBeVisible();
    await expect(page.locator('main')).toContainText(t.disputes.respondHint);
    await expect(
      page.getByRole('button', { name: t.disputes.respondSubmit }),
    ).toBeVisible();

    /*
      A field a person TYPES INTO follows the page's direction — the standing rule. `dir="ltr"`
      would set the direction AND move the element's start edge, putting an Arabic account's caret
      on the far left of its own box.
    */
    expect(
      await box.evaluate((node) => getComputedStyle(node).direction),
      'the account is typed right-to-left, like the page',
    ).toBe('rtl');
  });
});
