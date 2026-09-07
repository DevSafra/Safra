import { expect, test } from '@playwright/test';

import { PARTNER_BASE, PARTNER_STATE } from './partner-session.js';
import { STAFF_STATE } from './staff.js';

/**
 * A dispute freezes a partner's money — and now says so, to the partner.
 *
 * ## The defect this holds
 *
 * The freeze bites twice and neither was visible to the person whose money it is:
 *
 *  1. A completed booking with an open dispute is excluded from accrual, so its payable simply
 *     never appears.
 *  2. A booking already ON a payout when the dispute opens makes `release` refuse the WHOLE
 *     payout — `PAYOUT_FROZEN_BY_DISPUTE`. One disputed stay stops every other booking's money
 *     with it.
 *
 * The console showed SAFRA «مستحقات مجمّدة: 19». The partner's own page carried the RULE as a
 * sentence and no figure, no list, and no sign that a transfer of thousands could not move. On
 * this database that was $5,031.30 across seventeen bookings, six of them disputed.
 *
 * So this opens a dispute the way an operator does, on a booking sitting on a partner's own open
 * transfer, and then goes and reads the partner's screen.
 */
const CONSOLE = 'http://localhost:3001';

test.describe.configure({ mode: 'serial' });

/** Discovered, never named: a fixture that is renamed must fail rather than skip. */
let bookingReference = '';
let payoutReference = '';
/** The dispute this spec OPENED, so it can put the world back. Empty when it reused an existing one. */
let openedDispute = '';

test('an operator opens a dispute on a booking that is already on a transfer', async ({
  browser,
}) => {
  /*
    THIS partner's own transfer, read off their own page first.

    The first version walked the console's transfer list and opened a dispute on whatever came
    first — which belonged to a different partner, so the assertion below looked at a screen with
    nothing on it and reported the feature broken. The console shows every partner; only the portal
    shows this one.
  */
  const partner = await browser.newContext({ storageState: PARTNER_STATE });
  const portal = await partner.newPage();

  try {
    await portal.goto(`${PARTNER_BASE}/payouts`, { waitUntil: 'domcontentloaded' });

    const found = /PYT-\d+/.exec(await portal.locator('main').innerText());

    expect(found, 'this partner has a transfer').not.toBeNull();
    payoutReference = found?.[0] ?? '';
  } finally {
    await partner.close();
  }

  /*
    Money ALREADY held will do.

    This spec is about what the partner can see; opening a dispute is only setup. The first version
    insisted on opening one, so a second run — with every booking on the transfer already disputed —
    found no candidate and reported the feature broken. Re-runnable now.
  */
  const already = await browser.newContext({ storageState: PARTNER_STATE });
  const held = await already.newPage();

  try {
    await held.goto(`${PARTNER_BASE}/payouts`, { waitUntil: 'domcontentloaded' });

    const section = held.locator('[data-withheld]');

    if ((await section.count()) > 0) {
      const found = /BKG-\d{4}-\d+/.exec(await section.innerText());

      if (found) {
        bookingReference = found[0];

        return;
      }
    }
  } finally {
    await already.close();
  }

  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const page = await staff.newPage();

  try {
    await page.goto(`${CONSOLE}/payouts/${payoutReference}`, {
      waitUntil: 'domcontentloaded',
    });

    const bookings = [
      ...(await page.locator('main').innerText()).matchAll(/BKG-\d{4}-\d+/g),
    ].map((m) => m[0]);

    expect(bookings.length, 'the transfer covers bookings').toBeGreaterThan(0);

    for (const candidate of bookings) {
      const opened = await page.request.post(
        `${CONSOLE}/api/bookings/${candidate}/dispute`,
        {
          data: {
            kind: 'not_as_described',
            title: 'فحص تجميد المستحقات',
            description:
              'نزاع أُنشئ أثناء اختبار آلي للتحقق من أن الشريك يرى تجميد مستحقاته.',
          },
        },
      );

      if (opened.ok()) {
        bookingReference = candidate;
        openedDispute = ((await opened.json()) as { reference?: string }).reference ?? '';
        break;
      }
    }

    expect(
      bookingReference,
      'a dispute was opened on a booking on the transfer',
    ).not.toBe('');
  } finally {
    await staff.close();
  }
});

test('the partner’s own page names what is held and which transfer it stops', async ({
  browser,
}) => {
  test.skip(bookingReference === '', 'no dispute was opened');

  const partner = await browser.newContext({ storageState: PARTNER_STATE });
  const page = await partner.newPage();

  try {
    await page.goto(`${PARTNER_BASE}/payouts`, { waitUntil: 'domcontentloaded' });

    const held = page.locator('[data-withheld]');

    await expect(held, 'money is held, so the page says so').toBeVisible();
    await expect(held, 'the stay is named').toContainText(bookingReference);

    /*
      And the CONSEQUENCE. A partner reading «$125.55 held» beside a transfer of thousands that
      will not move has been told a true fact and the wrong story: one disputed stay refuses the
      whole transfer at release, not just its own share.
    */
    await expect(held, 'and the transfer it stops').toContainText(payoutReference);

    /* A dispute reference, so support can be given a handle. */
    await expect(held, 'and the dispute').toContainText('DSP-');

    /*
      And NOT the customer. The partner is owed an account of their money; whether they should
      also read the complaint is a product decision nobody has taken, and the payload deliberately
      carries neither the guest's name nor what they wrote.
    */
    const shown = await held.innerText();

    expect(shown, 'no complaint text').not.toContain('نزاع أُنشئ أثناء اختبار');
  } finally {
    await partner.close();
  }
});

/**
 * Puts the world back.
 *
 * A dispute is a durable financial HOLD: while it is open, `release` refuses the whole payout with
 * `PAYOUT_FROZEN_BY_DISPUTE`. Leaving one behind changed another spec's outcome —
 * `payout-accounts.spec.ts` asserts a release refused for «no verified account» and got «frozen by
 * dispute» instead, because this file had frozen the payout it uses.
 *
 * `payout-accounts.spec.ts` states the discipline this was missing: «a fixture that only works from
 * one starting point is a fixture that works once». A spec that creates a hold lifts it.
 *
 * Only the dispute this run OPENED. One it merely read was somebody else's state and closing it
 * would be this file reaching outside its own work.
 */
test('closes the dispute it opened, so the transfer is not left frozen', async ({
  browser,
}) => {
  test.skip(openedDispute === '', 'this run reused an existing dispute');

  const staff = await browser.newContext({ storageState: STAFF_STATE });
  const page = await staff.newPage();

  try {
    const closed = await page.request.post(
      `${CONSOLE}/api/disputes/${openedDispute}/close`,
      {
        data: {
          outcome: 'rejected',
          resolution:
            'أُغلق تلقائياً في نهاية اختبار آلي؛ لا قرار حقيقي هنا، والغرض إعادة الحالة كما كانت.',
        },
      },
    );

    expect(closed.status(), 'the dispute was closed').toBeLessThan(300);

    /* And the money is no longer held — the assertion that makes the restoration mean something. */
    const partner = await browser.newContext({ storageState: PARTNER_STATE });
    const portal = await partner.newPage();

    try {
      await portal.goto(`${PARTNER_BASE}/payouts`, { waitUntil: 'domcontentloaded' });

      const held = portal.locator('[data-withheld]');

      if ((await held.count()) > 0) {
        await expect(
          held,
          'this booking is no longer among the held ones',
        ).not.toContainText(bookingReference);
      }
    } finally {
      await partner.close();
    }
  } finally {
    await staff.close();
  }
});
