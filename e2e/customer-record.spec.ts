import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * What a customer's record actually SAYS — not that it rendered.
 *
 * ## Why this file exists
 *
 * `customer-detail.integration.test.ts` holds the data: the true totals, the scope, the refusals.
 * `responsive.spec.ts` holds the widths. Neither can see the failure this screen kept producing,
 * which is that a section renders perfectly and says the wrong thing:
 *
 * - «ما أُرسل إليه» printed `support.replied` where «رد على طلب دعم» belonged, because a bad edit
 *   deleted the name and an empty `span` is valid in every test;
 * - النزاعات linked every row to a route that does not exist;
 * - a nightly rate read «95 / الليلة» with no currency, on a platform that settles in SYP and
 *   prices in USD.
 *
 * All three shipped through a green `pnpm verify`. What they have in common is that the page was
 * FINE and the words were wrong, which is a class only an assertion about the rendered text can
 * reach.
 *
 * ## The sweep is the point, not the samples
 *
 * The strongest assertion here is that no machine identifier appears anywhere on the record. A
 * missing catalogue entry falls back to the raw key by design — `label` does not prettify — so
 * `support.replied`, `sla_compensation` and `pending_confirmation` all reach the screen intact when
 * somebody forgets a translation. One regex over the whole record catches the entire class,
 * including the templates nobody has added yet.
 */
test.describe('a customer record', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);
  test.use({ storageState: STAFF_STATE });

  /**
   * A customer who has actually done something.
   *
   * The registry shows a bookings count, so the first row with one above zero is a record with
   * sections to read. A customer with nothing renders every section as «لا شيء بعد», and every
   * assertion below would then pass without inspecting anything — the vacuous pass this suite's
   * own history warns about.
   */
  async function openBusyCustomer(page: Page): Promise<string> {
    await page.goto('/customers?size=25');

    const rows = page.locator('tbody tr');
    const count = await rows.count();

    for (let index = 0; index < count; index += 1) {
      const cells = await rows.nth(index).locator('td').allInnerTexts();
      /* Column four is «حجوزات» — see the registry's own column order. */
      const bookings = Number((cells[3] ?? '').replace(/[^\d]/g, ''));

      if (bookings > 0) {
        const href = await rows
          .nth(index)
          .locator('a[href^="/customers/CUS-"]')
          .getAttribute('href');

        await page.goto(href ?? '');

        return href ?? '';
      }
    }

    return '';
  }

  test('never prints a machine identifier where a name belongs', async ({ page }) => {
    const opened = await openBusyCustomer(page);

    test.skip(opened === '', 'No customer with bookings to read.');

    const text = await page.locator('main').innerText();

    /*
      A dotted or underscored lower-case token — `support.replied`, `sla_compensation`,
      `pending_confirmation`. Bounded by whitespace so an email address, a URL and a file name are
      not mistaken for one; those are values a record legitimately shows.
    */
    const identifiers = [
      ...new Set(
        (text.match(/(?<![\w@/.-])[a-z][a-z0-9]*[._][a-z][a-z0-9_.]*(?![\w@/.-])/g) ?? [])
          /* An email address is a legitimate value on this screen, and contains a dot. */
          .filter((token) => !text.includes(`${token}@`) && !token.includes('@')),
      ),
    ];

    expect(
      identifiers,
      'These reached the screen untranslated. `label` falls back to the raw key, so each is a ' +
        'missing catalogue entry rather than a rendering fault.',
    ).toStrictEqual([]);
  });

  /**
   * Every status pill reads as a word, and the same status is always the same word.
   *
   * `data-status-pill` marks them and nothing else, which is why the standing rule requires the
   * shared component rather than a hand-rolled span.
   */
  test('shows each status as Arabic, consistently', async ({ page }) => {
    const opened = await openBusyCustomer(page);

    test.skip(opened === '', 'No customer with bookings to read.');

    const pills = await page.locator('[data-status-pill]').allInnerTexts();

    expect(pills.length, 'the record shows statuses at all').toBeGreaterThan(0);

    for (const pill of pills) {
      const word = pill.trim();

      expect(word, 'a status is never blank').not.toBe('');
      /* No Latin letters at all: a status word here is Arabic, or it is an untranslated key. */
      expect(word, `«${word}» is not a translated status`).not.toMatch(/[A-Za-z]/);
    }
  });

  /**
   * The identity block names what it shows, and distinguishes the two absences.
   *
   * «لا محفظة» and a zero balance are different facts, and so are «لا حساب مرتبط» and an account
   * whose status is unknown. A screen that rendered a blank for either would look tidy and tell an
   * operator nothing.
   */
  test('labels the identity block and says what is absent', async ({ page }) => {
    const opened = await openBusyCustomer(page);

    test.skip(opened === '', 'No customer with bookings to read.');

    const c = t.sections.customerDetail;
    const main = page.locator('main');

    for (const heading of [c.identity, c.bookings, c.notifications]) {
      await expect(main, `«${heading}» is on the record`).toContainText(heading);
    }

    for (const field of [c.email, c.phone, c.type, c.accountStatus, c.joined, c.wallet]) {
      await expect(main, `«${field}» is labelled`).toContainText(field);
    }

    const text = await main.innerText();

    /* The account is one of the two known words, never a raw `active`. */
    expect(
      [c.guest, c.registered].some((word) => text.includes(word)),
      'the customer is named as a guest or a registered account',
    ).toBe(true);

    /* And the wallet is either an amount with a currency, or the sentence that says there is none. */
    const walletLine = text.slice(text.indexOf(c.wallet), text.indexOf(c.wallet) + 60);

    expect(
      walletLine.includes(c.noWallet) || /[\d٠-٩]/.test(walletLine),
      'the wallet row states a balance or states that there is none',
    ).toBe(true);
  });

  /**
   * Money never appears without its currency.
   *
   * The standing rule, on the screen where it is easiest to break: SYP and USD differ by four
   * orders of magnitude, so «١٠٩٫٠٠» alone is a number nobody can act on. Checked over the whole
   * record rather than one section, because every section that shows money must obey it.
   */
  test('writes no amount without its currency', async ({ page }) => {
    const opened = await openBusyCustomer(page);

    test.skip(opened === '', 'No customer with bookings to read.');

    const bare = await page.locator('main').evaluate((root) => {
      const found: string[] = [];

      for (const element of Array.from(root.querySelectorAll('*'))) {
        if (element.children.length > 0) continue;

        const text = (element.textContent ?? '').trim();

        /* A decimal figure — the shape a price takes. Dates are dashed, so they do not match. */
        if (!/^[+−-]?[\d,]+\.\d{2}$/.test(text)) continue;

        /*
          A currency SYMBOL, or a code from the list SAFRA actually prices in.

          This read `[A-Z]{3}` and every booking row passed — because the reference beside the
          figure is `BKG-2026-000388`, and `BKG` is three capitals. The test reported that a bare
          amount was accompanied by its currency when what it had found was the booking number.
          Caught by mutating the page to drop the currency and watching this stay green.
        */
        const near = (element.parentElement?.textContent ?? '').trim();
        const currency = /\b(?:USD|EUR|SYP|SAR|JOD|TRY|AED|GBP)\b|[$€£]|ل\.س/;

        if (!currency.test(near)) found.push(text);
      }

      return found;
    });

    expect(bare, 'these figures carry no currency').toStrictEqual([]);
  });

  /**
   * A bounded section states a real bound.
   *
   * «أحدث 10 من 57» is the sentence that stops a reader concluding a customer has ten bookings. The
   * failure it guards against is a total taken from `items.length`, which reads «أحدث 10 من 10» —
   * present, plausible, and useless.
   *
   * ## Western digits, deliberately
   *
   * This first asserted Arabic-Indic numerals and was WRONG: `ARABIC_WESTERN_DIGITS` pins
   * `ar-SY-u-nu-latn` for the whole console, and the reasoning is recorded where the constant is —
   * Arabic-Indic zero is a small raised dot that reads as a stray bullet, every figure here gets
   * reconciled against a ledger or a bank statement that renders Latin digits, and references like
   * `BKG-2026-000388` are Latin by construction so a row would otherwise mix both systems. The
   * assertion is kept, pointing the other way, so the convention is held rather than assumed.
   */
  test('states a real bound on what it is not showing', async ({ page }) => {
    const opened = await openBusyCustomer(page);

    test.skip(opened === '', 'No customer with bookings to read.');

    const text = await page.locator('main').innerText();
    const notes = text.match(/أحدث[^\n]*/g) ?? [];

    test.skip(notes.length === 0, 'This customer has fewer than a page of everything.');

    for (const note of notes) {
      const figures = (note.match(/[\d,]+/g) ?? []).map((n) =>
        Number(n.replace(/,/g, '')),
      );

      expect(figures, `«${note}» names two figures`).toHaveLength(2);

      const [shown, total] = figures;

      /* The whole point: the note exists BECAUSE there is more than is shown. */
      expect(total, `«${note}» reports more than it shows`).toBeGreaterThan(shown ?? 0);

      /* The console's own numerals — see the note above. */
      expect(note, `«${note}» uses the console's digits`).not.toMatch(/[٠-٩]/);
    }
  });

  /**
   * Dates read as dates.
   *
   * The record shows a registration date and a timestamp per row, all through `shortDate` and
   * `shortDateTime`. A raw ISO string reaching the screen is the shape of a formatter that was
   * never called — it renders, it is even legible, and it is wrong.
   */
  test('formats every date rather than printing a timestamp', async ({ page }) => {
    const opened = await openBusyCustomer(page);

    test.skip(opened === '', 'No customer with bookings to read.');

    const text = await page.locator('main').innerText();

    expect(text, 'no ISO timestamp reaches the screen').not.toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(text, 'no timezone suffix either').not.toMatch(/\d{2}:\d{2}:\d{2}\.\d+/);
  });
});
