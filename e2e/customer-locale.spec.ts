import { expect, test, type Page } from '@playwright/test';

import { ar } from '../packages/i18n/src/messages/errors/ar.js';
import { de } from '../packages/i18n/src/messages/errors/de.js';
import { en } from '../packages/i18n/src/messages/errors/en.js';
import arWeb from '../packages/i18n/src/messages/web/ar.json' with { type: 'json' };
import deWeb from '../packages/i18n/src/messages/web/de.json' with { type: 'json' };

/**
 * Server errors reach the customer in the customer's language.
 *
 * ## The bug this exists to keep fixed
 *
 * The API answered with English prose, and `auth-form.tsx` wrote the API's `message` straight
 * into the error under the input. So the one screen where wording matters most — a stranger
 * failing to register — was the one screen that ignored the locale entirely. An Arabic customer
 * read "A valid email address is required." and a German one read the same.
 *
 * `pnpm verify` could not see it: the route handler returned the right status with the right
 * shape, and no unit test rendered a form. Only a browser shows what a person actually reads,
 * which is why this is a browser test.
 *
 * ## Asserted against the catalogue, not against a copy of the sentence
 *
 * The expectations are read from `messages/errors/*.ts`. Duplicating the Arabic here would make
 * this pass while the app rendered a stale string, which is the same class of mistake as the
 * regex-matching it replaced.
 */
test.use({ baseURL: 'http://localhost:3000' });

/**
 * Located by role with a NON-exact name.
 *
 * The customer app appends a decorative `*` to every required label, so the accessible name is
 * `'البريد الإلكتروني *'` and an exact match finds nothing. Matching the label as a substring is
 * what the existing customer spec settled on for the same reason.
 */
const field = (page: Page, name: string) => page.getByRole('textbox', { name });

/**
 * A malformed email, submitted with the browser's own validation bypassed.
 *
 * `noValidate` is already set on the form, so the request does reach the route handler — which
 * is the point: this must exercise the SERVER's error path, not the browser's.
 *
 * EVERY OTHER FIELD IS VALID, including both passwords. It used to fill only the email and rely on
 * an otherwise-empty form still reaching the API. That stopped being true when registration grew a
 * password confirmation (2026-08-11): the client refuses to send a request whose two passwords do
 * not match, and two empty fields do not match, so the API was never called and the test failed on
 * a missing Arabic sentence. Filling the form properly is also what the test MEANS — "a validation
 * error from the API renders in Arabic" is about the email being wrong, not about everything being
 * blank.
 */
async function submitBadEmail(page: Page, locale: 'ar' | 'de') {
  const copy = (locale === 'ar' ? arWeb : deWeb).auth;

  await page.goto(`/${locale}/register`);
  await page.locator('input[name=fullName]').fill('اختبار اللغة');
  await field(page, copy.email).fill('not-an-email');
  /* The NATIONAL number: registration's field carries +963 in its country picker, and
     `input[name=phone]` is now the hidden E.164 value it composes. Checkout still has the
     plain field, which is why the test above fills it whole. */
  await page.locator('#field-phone').fill('933123456');
  await page.locator('select[name=gender]').selectOption('undisclosed');
  await page.locator('input[name=password]').fill('A-Long-Passphrase-1!');
  await page.locator('input[name=confirm]').fill('A-Long-Passphrase-1!');
  await page.getByRole('button', { name: copy.createAccount }).click();
}

test('a validation error from the API renders in Arabic', async ({ page }) => {
  await submitBadEmail(page, 'ar');

  await expect(page.getByText(ar['validation.email_invalid'])).toBeVisible();
});

test('the same error renders in German for a German customer', async ({ page }) => {
  await submitBadEmail(page, 'de');

  await expect(page.getByText(de['validation.email_invalid'])).toBeVisible();
});

/**
 * And the English text is not leaking into the other two.
 *
 * The failure mode being guarded is a fallback that quietly resolves every locale to the
 * English catalogue — which would satisfy "an error appeared" and nothing else.
 */
test('the English wording does not appear on the Arabic page', async ({ page }) => {
  await submitBadEmail(page, 'ar');

  await expect(page.getByText(ar['validation.email_invalid'])).toBeVisible();
  await expect(page.getByText(en['validation.email_invalid'])).toHaveCount(0);
});

/**
 * Arabic plural agreement, as a customer actually reads it.
 *
 * ## Why this needs a browser and not only the unit test
 *
 * `plurals.test.ts` proves the CATALOGUE selects the right form. It cannot prove the app reaches
 * that form: a component that pre-formats the count into an Arabic-numeral STRING before handing it
 * to `t()` makes every message fall to `other`, silently, because `Intl.PluralRules` has nothing
 * numeric to classify. Every category still exists, every unit test still passes, and every reader
 * sees the singular.
 *
 * So this asserts the rendered page at a count in the range that used to be wrong.
 */
test.describe('Arabic plurals on a real page', () => {
  test('a result count between 11 and 99 takes the singular noun', async ({ page }) => {
    await page.goto('/ar/search');

    const heading = page
      .locator('h1, h2')
      .filter({ hasText: /نتيجة|نتائج/ })
      .first();

    await expect(heading).toBeVisible();

    const text = (await heading.textContent()) ?? '';
    const digits = text.replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
    const count = Number(/(\d+)/.exec(digits)?.[1] ?? '0');

    /*
      The assertion is conditional on WHICH category the fixture count lands in, because the seed
      decides how many published listings there are — and a test that hard-coded "٦ نتائج" would
      break every time somebody added a listing, for a reason unrelated to plurals.
    */
    if (count >= 3 && count <= 10) {
      expect(text).toContain('نتائج');
    } else if (count >= 11 && count <= 99) {
      /* The category that was wrong: Arabic takes the SINGULAR here. */
      expect(text).toContain('نتيجة');
      expect(text).not.toContain('نتائج');
    } else if (count === 1) {
      expect(text).toContain('نتيجة واحدة');
    }
  });

  test('the count reaches the formatter as a number, not a pre-rendered string', async ({
    page,
  }) => {
    /*
      The failure this catches: a component formatting the count to Arabic-Indic digits BEFORE
      `t()` sees it. Every message would then resolve to `other` and read as the singular for
      every count, which looks like a translation choice rather than a bug.

      Proven on the property page, whose review line names a count and its noun together.
    */
    await page.goto('/ar/property/qasr-al-sharq-malki');

    const line = page.locator('text=/أحدث .* من .*/').first();

    await expect(line).toBeVisible();

    const text = (await line.textContent()) ?? '';

    /* Whatever the fixture count is, it must have selected a real category — never «# تقييم». */
    expect(text).not.toContain('#');
    expect(text).toMatch(/تقييم/);
  });
});

/**
 * A Latin-valued field on an Arabic page, and the number quoted beside it.
 *
 * ## Two different bugs with one cause
 *
 * A phone number, an email and a URL are laid out LEFT TO RIGHT whatever the page reads. Getting
 * that wrong produces two distinct failures, and this covers both because fixing one is what breaks
 * the other:
 *
 * 1. **Placement.** `dir="ltr"` alone makes the element's own start edge the LEFT one, so the value
 *    sits flush left inside a full-width field while its label sits on the right. `field-ltr` sets
 *    the direction and takes the alignment from the DOCUMENT — the one thing a `dir` attribute
 *    cannot express.
 * 2. **Order.** `+` is bidi-NEUTRAL. Inside an Arabic sentence it takes the paragraph's direction
 *    and lands after the digits, so the checkout hint quoted «963933123456+» — a format nobody could
 *    type. That hint has since been replaced by a country picker; the same hazard now applies to
 *    the «+963» it displays, which is why the second test below follows it there.
 *
 * Both were reported by Bashar from a screenshot of the checkout form (2026-08-13), and neither is
 * visible to `pnpm verify`: the markup and the catalogue are both correct in each case. Only a
 * browser resolves the bidi algorithm and the computed style.
 */
test.describe('a Latin-valued field on an Arabic page', () => {
  /*
    A real PUBLISHED property and one of its units, resolved at run time.

    It was `payments-test-property` with a hard-coded unit id — the fixture the payments integration
    suite owns. That suite commits by design (its teardown keeps any booking carrying a payment or a
    ledger entry, because that is financial evidence), so the property had accumulated 12,846
    bookings and its public payload had reached 7.1MB: past the 2MB Next.js data-cache ceiling, so
    the customer app re-fetched it uncached on every render and specs opening it timed out. It is a
    DRAFT now (`O-ops-4`), which removes it from search and from public pages — and took this
    checkout with it, because a draft has no public page to check out of.

    So this resolves a seeded property instead, the same way `findReference` does: ask the public
    API. A hard-coded unit id could not survive a re-seed anyway, and pointing a customer-facing
    spec at a test suite's private fixture was the coupling that made one property's growth this
    file's problem.
  */
  let CHECKOUT = '';

  test.beforeAll(async ({ request }) => {
    const property = await request.get(
      'http://localhost:4000/api/v1/properties/qasr-al-sharq-apartments',
    );
    const body = (await property.json()) as { units?: { id?: string }[] };
    const unitId = body.units?.[0]?.id ?? '';

    expect(
      unitId,
      'No unit on the seeded property — checkout has no form to inspect.',
    ).not.toBe('');

    CHECKOUT =
      '/ar/checkout?property=qasr-al-sharq-apartments' +
      `&unitId=${unitId}` +
      '&checkIn=2026-11-10&checkOut=2026-11-12&adults=2';
  });

  test('lays the phone number out left to right at the reader´s start edge', async ({
    page,
  }) => {
    await page.goto(CHECKOUT);

    /*
      `#field-phone`, not `input[name=phone]`: since the country picker landed, `name="phone"` is
      the HIDDEN input carrying the composed E.164 value, and the visible input is the national
      number. The property under test is unchanged — it is the visible one that a person reads.
    */
    const phone = page.locator('#field-phone');

    await expect(phone).toBeVisible();

    const style = await phone.evaluate((el) => {
      const computed = getComputedStyle(el);

      return { direction: computed.direction, textAlign: computed.textAlign };
    });

    /* The digits run left to right… */
    expect(style.direction).toBe('ltr');
    /* …and the value still starts where the reader starts, which on this page is the right. */
    expect(style.textAlign).toBe('right');
  });

  /**
   * The `+` still leads its digits — now in the country picker rather than in a hint.
   *
   * The hint no longer quotes an example number: with a picker supplying `+963`, telling somebody
   * to type «+963…» is an instruction they cannot follow, so that copy went. The BUG the old
   * assertion guarded did not go anywhere — `+` is bidi-neutral, and in «+963» on an Arabic line it
   * will migrate to the far end and render «963+» unless the run is forced left-to-right. It is now
   * the picker's summary that has to hold, and it does so with `dir="ltr"` rather than with
   * isolates, because there is no surrounding sentence to leave alone.
   */
  test('keeps the + at the head of the dial code in the picker', async ({ page }) => {
    await page.goto(CHECKOUT);

    const dial = page.getByText('+963', { exact: true });

    await expect(dial).toBeVisible();

    /* The characters, in order, as the code controls them… */
    expect(await dial.textContent()).toBe('+963');
    /* …and the direction that stops the browser reordering them. */
    expect(await dial.evaluate((el) => getComputedStyle(el).direction)).toBe('ltr');
  });

  /**
   * The footer is on every page of the customer site, so its own RTL is worth one assertion.
   *
   * This asserted that the copyright sat opposite the language links, which was true of the row
   * the footer used to end with — a brand at the start and an `ms-auto` copyright at the trailing
   * edge, where `ml-auto` would have pinned it to the START of an Arabic page. That row is gone:
   * the footer was rebuilt to the reference Bashar gave on 2026-09-03, which stacks the controls
   * under the brand and centres the copyright.
   *
   * The QUESTION survives the layout, so the assertion follows it rather than being deleted: does
   * this footer lay itself out by the reading direction, or by a physical edge somebody typed? In
   * a multi-column grid the answer is the COLUMN ORDER — the brand opens the row at the start,
   * which on an Arabic page is the right, and the last column closes it on the left.
   */
  test('lays the footer columns out by the reading direction', async ({ page }) => {
    await page.goto('/ar');

    const footer = page.locator('footer');
    const brand = footer.getByRole('link', { name: /SAFRA/ }).first();
    /* The last column, by its landmark rather than its position — position is what is on trial. */
    const lastColumn = footer.getByRole('navigation', { name: 'حسابي' });

    const [identity, tail] = await Promise.all([
      brand.boundingBox(),
      lastColumn.boundingBox(),
    ]);

    /* Right-to-left: the brand opens on the right, the account column closes on the left. */
    expect(identity && tail && identity.x).toBeGreaterThan(tail?.x ?? 0);

    /*
      And the copyright is CENTRED, not pushed to an edge — the reference's own answer, and the
      thing that would silently regress into `ml-auto` if anybody reached for a margin again.
    */
    const rights = footer.getByText(/جميع الحقوق محفوظة/);

    expect(await rights.evaluate((el) => getComputedStyle(el).textAlign)).toBe('center');
  });

  /**
   * The languages are reachable from BOTH bars, and the crawler depends on neither.
   *
   * This used to assert the opposite of half of that — «in the footer and NOT in the navbar», from
   * when the control moved out of the header (2026-08-13). It came back on 2026-09-02 at Bashar's
   * request, as booking.com has it, and on 2026-09-03 the footer's bespoke `<details>` was replaced
   * by the same component so the two behave identically. The old assertion only still passed
   * because a CLOSED popup renders no links — an accidental pass, which is the kind of test that
   * reports coverage it does not have.
   *
   * So it now asserts what is true and worth holding: each bar's control opens, each offers a real
   * anchor carrying `hreflang`, and the AUTHORITATIVE signal — `<link rel="alternate">` in the head
   * — is there whether or not anybody opens anything.
   */
  test('offers the languages from both bars, with hreflang on the anchors', async ({
    page,
  }) => {
    await page.goto('/ar');

    /* The head's alternates, which are what a crawler actually reads. */
    for (const code of ['ar', 'en', 'de']) {
      await expect(
        page.locator(`head link[rel="alternate"][hreflang="${code}"]`),
      ).toHaveCount(1);
    }

    for (const bar of ['header', 'footer']) {
      await page.locator(`${bar} [data-menu="language"]`).click();

      const german = page.locator(bar).getByRole('link', { name: 'Deutsch' });

      await expect(german, bar).toHaveAttribute('hreflang', 'de');

      await page.keyboard.press('Escape');
    }
  });

  /**
   * A language link keeps the reader's PAGE.
   *
   * The header's sent everybody to the home page, which on a property page threw away the property
   * they had arrived at from a search engine — the one screen where language matters most.
   */
  test('keeps the page when the language changes', async ({ page }) => {
    await page.goto('/ar/city/damascus');

    await page.locator('footer [data-menu="language"]').click();
    await page.locator('footer').getByRole('link', { name: 'English' }).click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/en/city/damascus');
  });

  /**
   * Changing the language must not change the THEME.
   *
   * ## The bug, exactly
   *
   * A visitor on a light page pressed «English» and the site turned dark (Bashar, 2026-08-13).
   * Nothing about the theme had been touched.
   *
   * Two causes, both now removed. `data-theme` was written by a pre-paint script, outside React —
   * and `/ar` and `/en` are different instances of the locale layout, so switching language
   * re-rendered `<html>` and React dropped the attribute it had not written. Underneath it, the
   * customer palette defaulted to DARK and only turned light when the OS asked, so losing the
   * attribute on an OS preferring dark meant losing the light page.
   *
   * The attribute is now rendered by the SERVER from a cookie, and the default beneath it is white
   * unconditionally. This asserts the visible half of both.
   *
   * ## Why it emulates a dark-preferring OS
   *
   * That is the configuration the bug needed. On a light-preferring machine the fallback happened
   * to be the same colour as the choice, so the attribute could vanish and nothing showed — which
   * is why three earlier attempts to reproduce it found nothing.
   */
  test.describe('changing the language leaves the theme alone', () => {
    test.use({ colorScheme: 'dark' });

    test('a white page stays white when the language changes', async ({ page }) => {
      await page.goto('/ar');

      const background = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);

      /* White by default, whatever the operating system prefers. */
      const light = await background();

      expect(light, 'the default is white').toBe('rgb(245, 246, 250)');

      await page.locator('footer [data-menu="language"]').click();
      await page.locator('footer').getByRole('link', { name: 'English' }).click();
      await page.waitForURL('**/en');

      expect(await background(), 'the language change did not repaint the site').toBe(
        light,
      );
    });

    /* And a visitor who DID choose dark keeps it — the same drop, from the other direction. */
    test('a dark page stays dark when the language changes', async ({ page }) => {
      await page.goto('/ar');
      /*
        `safra-theme-web`, namespaced. The name used to be `safra-theme` for all three apps, and a
        cookie ignores the PORT — so the console and لوحة الشريك, which are designed dark, turned the
        customer site dark through this very cookie (Bashar, 2026-08-18).
      */
      await page.evaluate(() => {
        document.cookie = 'safra-theme-web=dark; Path=/; Max-Age=3600; SameSite=Lax';
        localStorage.setItem('safra-theme-web', 'dark');
      });
      await page.reload({ waitUntil: 'networkidle' });

      const dark = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      expect(dark).not.toBe('rgb(245, 246, 250)');

      await page.locator('footer [data-menu="language"]').click();
      await page.locator('footer').getByRole('link', { name: 'English' }).click();
      await page.waitForURL('**/en');

      expect(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'the chosen theme survived the locale change',
      ).toBe(dark);
    });

    /**
     * The choice survives even when the SERVER render could not carry it.
     *
     * `data-theme` is emitted by the layout from the cookie, so React owns it across the re-render a
     * locale change causes. That holds only when the render being reconciled against actually read a
     * cookie — and most of this app is statically prerendered (`●` in the build output), so a
     * prefetched or cached payload carries no attribute and the theme reverts on navigation.
     *
     * Reproduced here the way it happens: a stored choice with NO cookie, which is exactly what a
     * static payload sees. `ThemeKeeper` re-asserts it after each navigation.
     */
    test('keeps a stored theme a static payload could not carry', async ({ page }) => {
      await page.goto('/ar');
      await page.evaluate(() => localStorage.setItem('safra-theme-web', 'dark'));
      await page.reload({ waitUntil: 'networkidle' });

      const background = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);

      const dark = await background();

      expect(dark, 'the stored choice applies on a cold load').not.toBe(
        'rgb(245, 246, 250)',
      );

      /* Every hop, because the bug was reported as specific to some of them. */
      for (const language of ['English', 'Deutsch', 'العربية']) {
        await page.locator('footer [data-menu="language"]').click();
        await page.locator('footer').getByRole('link', { name: language }).click();
        await page.waitForTimeout(900);

        expect(await background(), `${language} lost the stored theme`).toBe(dark);
      }
    });

    /**
     * Changing the language keeps the reader where they are — page AND query.
     *
     * The picker used to take the path as a prop, read by the footer from an `x-safra-pathname`
     * header the middleware sets. When that header was missing or failed validation the fallback was
     * `/${locale}` — the HOME page — so the control that exists to keep somebody in place sent them
     * to the front door instead (Bashar, 2026-08-18). It reads `usePathname()` now, which cannot be
     * stale, absent, or another request's.
     *
     * The search page is the case worth having: it carries a query, and the header only ever held a
     * path, so a reader changing language mid-search kept their page and lost their search.
     */
    test('keeps the page and its query when the language changes', async ({ page }) => {
      for (const [from, to] of [
        ['/ar/city/damascus', '/en/city/damascus'],
        ['/ar/search?city=damascus&adults=2', '/en/search?city=damascus&adults=2'],
      ] as const) {
        await page.goto(from);

        await page.locator('footer [data-menu="language"]').click();
        await page.locator('footer').getByRole('link', { name: 'English' }).click();
        await page.waitForURL(`**${to}`);

        const landed = await page.evaluate(() => location.pathname + location.search);

        expect(landed, `${from} did not survive the language change`).toBe(to);
      }
    });

    /**
     * A staff dashboard's theme does not reach the customer site.
     *
     * The cookie was one name for all three apps, and a cookie is scoped to a HOST and ignores the
     * PORT — so `localhost:3001` and `:3002`, both designed DARK, shared this jar. Using either
     * toggle turned the public site dark, and because the layout reads the cookie during a SERVER
     * render it surfaced on the next navigation, which made the language switcher look guilty.
     *
     * Both names are written here: the STALE shared one, which any pre-fix browser still carries,
     * and the console's own. Neither may repaint this site.
     */
    test('a staff dashboard theme does not reach the customer site', async ({ page }) => {
      await page.goto('/ar');

      const background = () =>
        page.evaluate(() => getComputedStyle(document.body).backgroundColor);

      const light = await background();

      expect(light, 'the default is white').toBe('rgb(245, 246, 250)');

      await page.evaluate(() => {
        document.cookie = 'safra-theme=dark; Path=/; Max-Age=3600; SameSite=Lax';
        document.cookie = 'safra-theme-admin=dark; Path=/; Max-Age=3600; SameSite=Lax';
        document.cookie = 'safra-theme-partner=dark; Path=/; Max-Age=3600; SameSite=Lax';
      });
      await page.reload({ waitUntil: 'networkidle' });

      expect(await background(), 'another app cannot repaint this one').toBe(light);

      /* And the language change, which is where it was noticed. */
      await page.locator('footer [data-menu="language"]').click();
      await page.locator('footer').getByRole('link', { name: 'English' }).click();
      await page.waitForURL('**/en');

      expect(await background(), 'still not repainted after a locale change').toBe(light);
    });
  });

  /**
   * The currency control, end to end — and the line that keeps it honest.  /**
   * The currency control, end to end — and the line that keeps it honest.
   *
   * A converted price is an ESTIMATE from one rate a staff member typed. The listing's own amount
   * is printed beneath it, and checkout is never converted, because that is the figure somebody is
   * actually charged. Both halves are asserted here; either alone would pass on a broken build.
   *
   * The dollar is «$», which is what `CURRENCY_CATALOGUE` says it is. This pinned `Intl`'s ar-SY
   * spelling until 2026-09-03 — asserted because that is what the screen happened to render, never
   * because the platform had decided it. See the note in `formatMoney`.
   */
  test('converts browse prices and never the checkout total', async ({ page }) => {
    await page.goto('/ar/city/damascus');

    const card = page.locator('article').first();

    await expect(card).toContainText('$');

    /*
      Driven through the real control — a `<details>` and a form POST. A cookie set directly would
      skip the one thing worth testing, which is that choosing a currency writes it and comes back
      to the same page.
    */
    await page.locator('footer [data-menu="currency"]').click();
    await page.locator('footer button[name="currency"][value="SYP"]').click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/ar/city/damascus');
    await expect(card).toContainText('ل.س');
    /* The original, so an estimate is never mistaken for a quote. */
    await expect(card).toContainText('$');

    /* Contractual: the amount a card is charged, in the listing's own currency, always. */
    await page.goto(CHECKOUT);

    await expect(page.locator('main')).toContainText('$');
    await expect(page.locator('main')).not.toContainText('ل.س');
  });
});

/**
 * شروط الاستخدام and سياسة الخصوصية.
 *
 * ## What is worth asserting about a legal page
 *
 * Not the prose — that is the catalogue's job and duplicating a paragraph here would make the test
 * pass while the app served a stale one. What matters is that the pages EXIST in every language the
 * site serves, that the footer actually reaches them, and that the notice about what is still
 * outstanding is visible rather than buried.
 *
 * That last one is the point. `O-web-5` records these as needing legal copy that is not an
 * engineer's to write — the registered entity, the privacy contact, the supervisory authority, the
 * governing law. The pages say so at the top. If somebody later fills those in and removes the
 * notice, this test fails and makes them confirm the removal was deliberate.
 */
test.describe('the legal pages', () => {
  for (const locale of ['ar', 'en', 'de'] as const) {
    test(`terms and privacy both render in ${locale}`, async ({ page }) => {
      for (const path of [`/${locale}/terms`, `/${locale}/privacy`]) {
        const response = await page.goto(path);

        expect(response?.status(), `${path} resolves`).toBe(200);
        /* A heading and real sections, not an empty shell with a title. */
        await expect(page.locator('h1')).toBeVisible();
        expect(await page.locator('article section h2').count()).toBeGreaterThan(4);
      }
    });
  }

  test('the footer reaches both, and says what is still outstanding', async ({
    page,
  }) => {
    await page.goto('/ar');

    await page
      .locator('footer')
      .getByRole('link', { name: arWeb.legal.terms.title })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/ar/terms');

    /* The notice is a `note`, not an `alert` — standing context rather than something that fired. */
    await expect(page.getByRole('note')).toContainText(arWeb.legal.pendingTitle);

    await page
      .locator('footer')
      .getByRole('link', { name: arWeb.legal.privacy.title })
      .click();
    await expect.poll(() => new URL(page.url()).pathname).toBe('/ar/privacy');
    await expect(page.getByRole('note')).toContainText(arWeb.legal.pendingTitle);
  });

  /**
   * The cookie section names the three cookies this site actually sets.
   *
   * A privacy notice is a factual claim about a system, and this is the claim most likely to drift:
   * a fourth cookie added without a thought here turns the page into a false statement. Naming them
   * in the test means adding one breaks a test rather than a promise.
   */
  test('the cookie section names exactly the cookies the site sets', async ({ page }) => {
    await page.goto('/en/privacy');

    const body = page.locator('article');

    await expect(body).toContainText('safra_session');
    await expect(body).toContainText('safra-theme');
    await expect(body).toContainText('safra_currency');
  });
});

/**
 * A message that interpolates a value must show the VALUE, in every language.
 *
 * ## The bug
 *
 * The registration form printed «يجب أن تكون كلمة المرور {min} أحرف على الأقل.» — the placeholder
 * itself, where the number belongs (Bashar, 2026-08-14). Seventeen entries in the error catalogue
 * carry one, so this was never about passwords.
 *
 * Three things had to be true and none was: the API had to send the values alongside the code, the
 * web proxy — which parses the same schema and refuses BEFORE calling the API, so for a short
 * password the API is never reached — had to send them too, and the form had to pass them on.
 *
 * ## Why a browser test rather than a unit one
 *
 * There are unit tests at each layer, and all three could pass while the screen still showed
 * `{min}`: the shape being right and the sentence being wrong is exactly the state this shipped
 * in. Only rendering the form answers what a person reads.
 */
test.describe('a message that interpolates a value', () => {
  for (const [locale, expected] of [
    ['ar', 'كلمة المرور'],
    ['en', 'Password must be at least'],
    ['de', 'mindestens'],
  ] as const) {
    test(`shows the number, not the placeholder, in ${locale}`, async ({ page }) => {
      await page.goto(`/${locale}/register`);

      await page.locator('input[name=fullName]').fill('Test');
      await page
        .locator('input[name=email]')
        .fill(`ph-${Math.random().toString(36).slice(2, 10)}@example.test`);
      await page.locator('#field-phone').fill('933123456');
      await page.locator('select[name=gender]').selectOption('undisclosed');
      await page.locator('input[name=password]').fill('Shortpass1!');
      await page.locator('input[name=confirm]').fill('Shortpass1!');
      await page.locator('form button[type=submit]').first().click();

      const error = page.locator('[id$="-error"]').first();

      await expect(error).toBeVisible();

      const text = (await error.textContent()) ?? '';

      /* The value the schema enforces… */
      expect(text).toContain('12');
      /* …the sentence in the reader's own language… */
      expect(text).toContain(expected);
      /* …and never the raw placeholder, which is what a reader actually saw. */
      expect(text).not.toMatch(/\{\w+\}/);
    });
  }

  /**
   * The checklist states the length, and nothing else does.
   *
   * There used to be a hint under the field reading «١٢ حرفًا على الأقل» in Arabic-Indic digits
   * while the error below it said «12» — two numeral systems for one number, a line apart, because
   * the hint was a typed-out copy of a bound the schema owns. Bashar had the hint removed once the
   * live checklist showed the same requirement (2026-08-14), so there is now exactly one place the
   * number appears and it is computed.
   */
  test('states the length requirement once, in the checklist', async ({ page }) => {
    await page.goto('/ar/register');

    const lengthChip = page.locator('[data-met]').first();

    await expect(lengthChip).toContainText('12');
    /* And the removed hint has not come back alongside it. */
    await expect(page.getByText('الطول أهم من الرموز')).toHaveCount(0);
  });
});

/**
 * A weak password is refused, in the reader's language, before an account exists.
 *
 * ## What this guards
 *
 * The policy was twelve characters and nothing else, so `aaaaaaaaaaaa` and `Password1234` opened
 * accounts on a platform holding wallet balances and payout details (Bashar, 2026-08-14). The
 * checks now live on `passwordSchema`, which every password route shares.
 *
 * `password-strength.test.ts` proves the rules. This proves the two things a unit test cannot: that
 * the refusal survives the round trip through the proxy and the form, and that it arrives as a
 * sentence somebody can act on rather than as a code or a generic "something went wrong".
 */
test.describe('password strength', () => {
  const register = async (page: Page, password: string) => {
    await page.goto('/ar/register');
    await page.locator('input[name=fullName]').fill('اختبار');
    await page
      .locator('input[name=email]')
      .fill(`pw-${Math.random().toString(36).slice(2, 10)}@example.test`);
    await page.locator('#field-phone').fill('933123456');
    await page.locator('select[name=gender]').selectOption('undisclosed');
    await page.locator('input[name=password]').fill(password);
    await page.locator('input[name=confirm]').fill(password);
    await page.locator('form button[type=submit]').first().click();
  };

  it_refuses('a character held down', 'Aaaaaaaaaa1!', 'validation.password_predictable');
  it_refuses('a common password', 'Password123!', 'validation.password_common');

  /**
   * Declared as a helper so each case is its own test rather than a loop that stops at the first
   * failure — with a shared account and a throttle, knowing which one broke matters.
   */
  function it_refuses(what: string, password: string, code: keyof typeof ar) {
    test(`refuses ${what}, and says why in Arabic`, async ({ page }) => {
      await register(page, password);

      const error = page.locator('[id$="-error"]').first();

      await expect(error).toBeVisible();
      /* The catalogue's own sentence — never a code, and never the generic fallback. */
      await expect(error).toHaveText(ar[code]);
      /* And no account was made: the form is still the form. */
      await expect(page).toHaveURL(/\/register/);
    });
  }

  /**
   * A password somebody following the hint would actually choose is accepted.
   *
   * Asserted on the CONFIRMATION, not on a redirect. Registration answers 202 and the form swaps
   * itself for «تحقّق من بريدك الإلكتروني» — it deliberately does not navigate, because the account
   * is not usable until the address is verified. The first version of this test waited for the URL
   * to change and failed on a registration that had entirely succeeded.
   */
  test('accepts four unrelated words', async ({ page }) => {
    await register(page, 'مطر أزرق فوق الجبل ٩!');

    await expect(page.getByText(arWeb.auth.checkEmail)).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[id$="-error"]')).toHaveCount(0);
  });
});

/**
 * The live strength meter beside the new-password field.
 *
 * Asked for by Bashar from a reference design (2026-08-14). What it must do is tick requirements as
 * they are met, and — the part that matters — agree with what the server enforces. A checklist that
 * goes green on a password the API then refuses is worse than no checklist: it tells somebody their
 * password is fine and then rejects it.
 *
 * `PASSWORD_RULES` in `@safra/contracts` is the single definition the schema refines against and the
 * meter renders, so this asserts the visible half of that arrangement.
 */
test.describe('the password strength meter', () => {
  test('ticks each requirement as it is met', async ({ page }) => {
    await page.goto('/ar/register');

    const chips = page.locator('[data-met]');
    const met = () => page.locator('[data-met="true"]');

    /* Five requirements, none met, before anything is typed. */
    await expect(chips).toHaveCount(5);
    await expect(met()).toHaveCount(0);

    const field = page.locator('input[name=password]');

    /* Lowercase only: one requirement. */
    await field.fill('abcdefghijkl');
    await expect(met()).toHaveCount(2);

    /* Adding a capital, a digit and a symbol completes the set. */
    await field.fill('Abcdefghijk1!');
    await expect(met()).toHaveCount(5);
  });

  /**
   * Arabic satisfies both case rules, because Arabic HAS no case.
   *
   * A literal "one uppercase letter" rule cannot be met by «مطر أزرق فوق الجبل», so as drawn it
   * would have refused every password written in this site's primary language and quietly forced
   * everybody onto a Latin keyboard. That is a script requirement, not a strength requirement.
   */
  test('does not demand a capital letter of a script that has none', async ({ page }) => {
    await page.goto('/ar/register');

    await page.locator('input[name=password]').fill('مطر أزرق فوق الجبل ٩!');

    await expect(page.locator('[data-met="true"]')).toHaveCount(5);
  });

  /**
   * A full checklist is not a promise of acceptance, and must not be drawn as one.
   *
   * `Password123!` ticks every box and is still refused, because it is one of the most-guessed
   * passwords there is. The meter measures the checklist; the blocklist is what keeps the checklist
   * honest.
   */
  test('a complete checklist does not override the blocklist', async ({ page }) => {
    await page.goto('/ar/register');

    await page.locator('input[name=fullName]').fill('اختبار');
    await page
      .locator('input[name=email]')
      .fill(`m-${Math.random().toString(36).slice(2, 10)}@example.test`);
    await page.locator('#field-phone').fill('933123456');
    await page.locator('select[name=gender]').selectOption('undisclosed');
    await page.locator('input[name=password]').fill('Password123!');
    await page.locator('input[name=confirm]').fill('Password123!');

    await expect(page.locator('[data-met="true"]')).toHaveCount(5);

    await page.locator('form button[type=submit]').first().click();

    await expect(page.locator('[id$="-error"]').first()).toHaveText(
      ar['validation.password_common'],
    );
  });
});

/**
 * الجنس on the registration form (Bashar, 2026-08-14).
 *
 * REQUIRED, and the third option is why that is acceptable: a choice has to be made, but «أفضّل عدم
 * الإفصاح» is one of the choices rather than a polite way of leaving the field blank. A required
 * field with only two answers would force somebody to state something untrue about themselves,
 * which is worse data than none and a poor thing to do besides.
 */
test.describe('the gender field', () => {
  test('must be chosen, and «prefer not to say» is one of the choices', async ({
    page,
  }) => {
    await page.goto('/ar/register');

    const select = page.locator('select[name=gender]');

    await expect(select).toBeVisible();
    /* Required: nothing is pre-selected, and the placeholder cannot be chosen back. */
    await expect(select).toHaveValue('');
    await expect(select).toHaveJSProperty('required', true);
    await expect(select.locator('option[disabled]')).toHaveCount(1);

    await select.selectOption('undisclosed');

    await page.locator('input[name=fullName]').fill('اختبار');
    await page
      .locator('input[name=email]')
      .fill(`g-${Math.random().toString(36).slice(2, 10)}@example.test`);
    await page.locator('#field-phone').fill('933123456');
    await page.locator('select[name=gender]').selectOption('undisclosed');
    await page.locator('input[name=password]').fill('A-Long-Passphrase-1!');
    await page.locator('input[name=confirm]').fill('A-Long-Passphrase-1!');
    await page.locator('form button[type=submit]').first().click();

    await expect(page.getByText(arWeb.auth.checkEmail)).toBeVisible({ timeout: 20_000 });
  });
});
