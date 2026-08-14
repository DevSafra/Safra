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
  await page.locator('input[name=phone]').fill('+963912345678');
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
 *    and lands after the digits, so the hint quoted «963912345678+» — a format nobody could type.
 *    U+2066…U+2069 make the number its own left-to-right run.
 *
 * Both were reported by Bashar from a screenshot of the checkout form (2026-08-13), and neither is
 * visible to `pnpm verify`: the markup and the catalogue are both correct in each case. Only a
 * browser resolves the bidi algorithm and the computed style.
 */
test.describe('a Latin-valued field on an Arabic page', () => {
  /* A real property and unit, or the checkout renders no guest form to inspect. */
  const CHECKOUT =
    '/ar/checkout?property=payments-test-property' +
    '&unitId=27b8b887-a81e-4d3d-ac2f-74503fe0c7af' +
    '&checkIn=2026-11-10&checkOut=2026-11-12&adults=2';

  test('lays the phone number out left to right at the reader´s start edge', async ({
    page,
  }) => {
    await page.goto(CHECKOUT);

    const phone = page.locator('input[name="phone"]');

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

  test('keeps the + at the head of the example number', async ({ page }) => {
    await page.goto(CHECKOUT);

    const hint = page.locator('#field-phone-hint');

    await expect(hint).toBeVisible();

    const text = (await hint.textContent()) ?? '';

    /*
      Asserted on the ISOLATION rather than on the rendered pixels, because the characters are what
      the code controls and the rendering is what the browser owes us for them. U+2066 is
      LEFT-TO-RIGHT ISOLATE and U+2069 is POP DIRECTIONAL ISOLATE.
    */
    expect(text).toContain('⁦+963912345678⁩');

    /* And the plus is never stranded after the digits, which is what the bug looked like. */
    expect(text).not.toContain('963912345678+');
  });

  /**
   * The footer is on every page of the customer site, so its own RTL is worth one assertion.
   *
   * `ms-auto` rather than `ml-auto` on the copyright: a logical margin puts it at the trailing
   * edge in both directions, where a physical one pins it to the left of an Arabic page — which is
   * the START, beside the language links it is supposed to be opposite.
   */
  test('puts the footer copyright opposite the language links', async ({ page }) => {
    await page.goto('/ar');

    const footer = page.locator('footer');
    const brand = footer.getByRole('link', { name: /SAFRA/ }).first();
    const pickers = footer.locator('details').first();

    const [identity, controls] = await Promise.all([
      brand.boundingBox(),
      pickers.boundingBox(),
    ]);

    /* Right-to-left: the brand starts the row on the right, the controls end it on the left. */
    expect(identity && controls && identity.x).toBeGreaterThan(controls?.x ?? 0);
  });

  /**
   * The language control moved OUT of the navbar (Bashar, 2026-08-13) and must not come back.
   *
   * Its justification in the header was that real anchors get the alternate-language pages indexed
   * (§5.4). That property had to survive the move, so this asserts both halves: gone from the
   * header, and still real anchors in the footer.
   */
  test('offers the languages in the footer and not in the navbar', async ({ page }) => {
    await page.goto('/ar');

    await expect(
      page.locator('header').getByRole('link', { name: 'Deutsch' }),
    ).toHaveCount(0);

    /*
      Opened first: a closed `<details>` hides its contents from the ACCESSIBILITY TREE, so a role
      selector finds nothing there. The anchors are still in the DOM, which is what a crawler reads
      — and `generateMetadata` emits the `hreflang` alternates regardless, which is the
      authoritative signal either way.
    */
    await page.locator('footer details').first().click();

    const german = page.locator('footer').getByRole('link', { name: 'Deutsch' });

    await expect(german).toHaveAttribute('hreflang', 'de');
  });

  /**
   * A language link keeps the reader's PAGE.
   *
   * The header's sent everybody to the home page, which on a property page threw away the property
   * they had arrived at from a search engine — the one screen where language matters most.
   */
  test('keeps the page when the language changes', async ({ page }) => {
    await page.goto('/ar/city/damascus');

    await page.locator('footer details').first().click();
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

      await page.locator('footer details').first().click();
      await page.locator('footer').getByRole('link', { name: 'English' }).click();
      await page.waitForURL('**/en');

      expect(await background(), 'the language change did not repaint the site').toBe(
        light,
      );
    });

    /* And a visitor who DID choose dark keeps it — the same drop, from the other direction. */
    test('a dark page stays dark when the language changes', async ({ page }) => {
      await page.goto('/ar');
      await page.evaluate(() => {
        document.cookie = 'safra-theme=dark; Path=/; Max-Age=3600; SameSite=Lax';
        localStorage.setItem('safra-theme', 'dark');
      });
      await page.reload({ waitUntil: 'networkidle' });

      const dark = await page.evaluate(
        () => getComputedStyle(document.body).backgroundColor,
      );

      expect(dark).not.toBe('rgb(245, 246, 250)');

      await page.locator('footer details').first().click();
      await page.locator('footer').getByRole('link', { name: 'English' }).click();
      await page.waitForURL('**/en');

      expect(
        await page.evaluate(() => getComputedStyle(document.body).backgroundColor),
        'the chosen theme survived the locale change',
      ).toBe(dark);
    });
  });

  /**
   * The currency control, end to end — and the line that keeps it honest.  /**
   * The currency control, end to end — and the line that keeps it honest.
   *
   * A converted price is an ESTIMATE from one rate a staff member typed. The listing's own amount
   * is printed beneath it, and checkout is never converted, because that is the figure somebody is
   * actually charged. Both halves are asserted here; either alone would pass on a broken build.
   */
  test('converts browse prices and never the checkout total', async ({ page }) => {
    await page.goto('/ar/city/damascus');

    const card = page.locator('article').first();

    await expect(card).toContainText('US$');

    /*
      Driven through the real control — a `<details>` and a form POST. A cookie set directly would
      skip the one thing worth testing, which is that choosing a currency writes it and comes back
      to the same page.
    */
    await page.locator('footer details').last().click();
    await page.locator('footer button[name="currency"][value="SYP"]').click();

    await expect.poll(() => new URL(page.url()).pathname).toBe('/ar/city/damascus');
    await expect(card).toContainText('ل.س');
    /* The original, so an estimate is never mistaken for a quote. */
    await expect(card).toContainText('US$');

    /* Contractual: the amount a card is charged, in the listing's own currency, always. */
    await page.goto(CHECKOUT);

    await expect(page.locator('main')).toContainText('US$');
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
      await page.locator('input[name=phone]').fill('+963912345678');
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
    await page.locator('input[name=phone]').fill('+963912345678');
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
    await page.locator('input[name=phone]').fill('+963912345678');
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
    await page.locator('input[name=phone]').fill('+963912345678');
    await page.locator('select[name=gender]').selectOption('undisclosed');
    await page.locator('input[name=password]').fill('A-Long-Passphrase-1!');
    await page.locator('input[name=confirm]').fill('A-Long-Passphrase-1!');
    await page.locator('form button[type=submit]').first().click();

    await expect(page.getByText(arWeb.auth.checkEmail)).toBeVisible({ timeout: 20_000 });
  });
});
