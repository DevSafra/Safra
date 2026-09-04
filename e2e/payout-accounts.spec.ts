import { expect, test } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';

import {
  EMAIL as STAFF_EMAIL,
  PASSWORD as STAFF_PASSWORD,
  STAFF_STATE,
} from './staff.js';
import { PARTNER_BASE as PORTAL, PARTNER_STATE } from './partner-session.js';

/**
 * Where a partner's money goes — entered in one app, approved in another, spent by a third.
 *
 * ## Why this spec exists
 *
 * `partner_payout_accounts` was read in three places and written in NONE. Measured on 2026-09-04:
 * the table held **zero rows**, no code path anywhere could create one, and the release query took
 * `?? null` on a lookup that could not succeed — so SAFRA had recorded **seventy-six** payouts as
 * released or paid with `payout_account_id` NULL. Transfers with no recorded destination.
 *
 * Every other suite would have stayed green through all of it. The console's partner screen read
 * the table and rendered «لا بيانات تحويل مسجّلة», which is a true sentence about an empty table,
 * and nothing asked whether it could ever be non-empty.
 *
 * So this drives the whole thing in browsers, across both apps, in the order a person does it:
 *
 *   partner portal → the account exists, pending → console → verified → console → payout releases
 *
 * ## Bashar's rules, 2026-09-04, and where each is asserted
 *
 *  - «The partner can enter and maintain their own payout-account details» → the first test.
 *  - «Authorised staff can also enter or update … on behalf of the partner» → the fourth.
 *  - «Every new payout account and every material change must require verification» → the first
 *    and the third: the account arrives `pending`, and an edit takes `verified` away again.
 *  - «The verification state must be clearly visible in both» → asserted on both screens, by the
 *    reader's own words rather than by a class name.
 *  - «A payout must never be released … unless it is linked to an active, verified payout account»
 *    → the fifth, with the refusal AND the success, because a release that refuses for everybody
 *    is indistinguishable from a release that is broken.
 *  - «All changes must be fully audited» → the sixth, read off the console's own audit screen.
 *  - «masked account details by default … avoid exposing full banking information» → the second,
 *    which walks every string on both screens rather than naming one field.
 */

/** A number long enough to mask and unique per run, so two runs never collide on a partner. */
const ACCOUNT_NUMBER = `SY${Date.now()}${'0'.repeat(6)}`.slice(0, 24);
const LAST4 = ACCOUNT_NUMBER.slice(-4);
/*
  A STABLE holder name, so a second run finds the account it made rather than adding another.

  It was timestamped, and twenty-two accounts accumulated on the fixture partner across a day of
  runs — at which point the newest fell outside the list's `LIMIT 20` and the spec failed on a
  feature that was working. That was worth finding (the ordering is fixed), but a spec that grows
  a shared fixture by one row per run is the leak, not the discovery.
*/
const HOLDER = 'Qasr Al-Sharq Fixture';

/** The fixture partner the portal session belongs to — five listings, one payout. */
const PARTNER_REFERENCE = 'PAR-433898';

/**
 * A DIFFERENT partner for the money half, and the reason is a real platform rule.
 *
 * `PAR-433898`'s payout covers four bookings with open disputes, so release refuses with
 * `payout.frozen_by_dispute` before the account guard is ever consulted — a correct refusal for the
 * wrong reason, which would make an assertion about payout accounts pass or fail on something else
 * entirely. `PAR-433900` has a payout with no frozen booking, so the account IS the only thing
 * standing between it and a transfer, which is what this spec needs to be about.
 *
 * It is also the second of Bashar's two doors: nobody signs in as this partner here, so the account
 * is entered by STAFF on the partner's behalf, through the console.
 */
const MONEY_PARTNER_REFERENCE = 'PAR-433900';
const MONEY_PARTNER_NAME = 'بيت دمشقي تراثي';

/** A stable holder name, so a second run finds the account it made rather than adding another. */
const STAFF_HOLDER = 'SAFRA Payout Fixture';

/*
  The console's own control labels, taken from the catalogue rather than retyped.

  A literal here would go stale the first time somebody rewords a button, and the failure would
  read as «release is broken» rather than «this test names a button that no longer exists».
*/
const CLOSE = t.sections.payouts.close;
const RELEASE = t.sections.payouts.release;
const MARK_PAID = t.sections.payouts.markPaid;
const RELEASE_DATE = t.sections.payouts.releaseDate;
const PAID_REFERENCE = t.sections.payouts.paidReferenceLabel;
const CONFIRM = t.sections.payouts.confirm;
const HOLD = t.sections.payouts.hold;
const LIFT_HOLD = t.sections.payouts.liftHold;
const REASON = t.sections.payouts.reason;
const PENDING_RELEASE_STATUS =
  t.enums.payoutStatus['pending_release'] ?? 'بانتظار الإفراج';

/*
  The config's `baseURL` is the CONSOLE, so every portal navigation is absolute.

  Not a detail: a relative `/payouts` in a partner-session test lands on the console's sign-in
  page, which is a 200 with a form on it — so the failure reads as «the link is missing» rather
  than «you are on the wrong application». That is exactly how the first run of this spec failed.
*/

test.describe('payout accounts, across the portal and the console', () => {
  /*
    ── Test order is load-bearing here, and that is deliberate ──

    These run in sequence against ONE account, because the thing under test IS a sequence: an
    account is entered, masked, edited back into review, verified, and only then can money move.
    Six independent tests would each have to build the state the previous one produced, which means
    six fixtures asserting six things that never happened in that order to anybody.

    `test.describe.configure({ mode: 'serial' })` states that, so a failure half way stops the rest
    rather than reporting five more failures about a state that was never reached. The suite already
    runs `workers: 1, fullyParallel: false`, so this changes no scheduling — it changes what a
    downstream failure MEANS.
  */
  test.describe.configure({ mode: 'serial' });

  /** Carried between tests, because the console addresses an account by id. */
  let accountId = '';

  // ────────────────────────────────────────────────────────────────────────────
  test.describe('the partner enters their own details', () => {
    test.use({ storageState: PARTNER_STATE });

    test('a new account lands in review, and the portal says so', async ({ page }) => {
      await page.goto(`${PORTAL}/payouts`, { waitUntil: 'domcontentloaded' });

      /*
        Reached by the LINK, not by typing the URL. A page nothing links to is a page nobody finds
        — the state four console sections were in on 2026-08-24 — and «the partner can maintain
        their own details» is not true of a screen with no route to it.
      */
      await page.getByRole('link', { name: 'حسابات التحويل' }).click();
      await expect(page).toHaveURL(/\/payouts\/accounts$/);

      await expect(
        page.getByText('لا يُحوَّل أي مبلغ إلا إلى حساب موثَّق', { exact: false }),
      ).toBeVisible();

      /*
        Reuse it if a previous run made it. The row is edited back to `pending` below either way,
        so the states this spec walks through are the same on the first run and the hundredth.
      */
      const existing = page.locator('[data-payout-account]').filter({ hasText: HOLDER });

      if ((await existing.count()) > 0) {
        await existing.first().getByRole('button', { name: 'تعديل' }).click();
      } else {
        await page.getByRole('button', { name: 'إضافة حساب تحويل' }).click();
      }

      /* The consequence of editing is stated BEFORE the fields, not after the save. */
      await expect(
        page.getByText('يعيد الحساب إلى المراجعة', { exact: false }),
      ).toBeVisible();

      await page.getByLabel('اسم صاحب الحساب').fill(HOLDER);
      await page.getByLabel('رقم الحساب / IBAN').fill(ACCOUNT_NUMBER);
      await page.getByLabel('اسم المصرف').fill('بنك سورية الدولي');
      await page.getByRole('button', { name: 'حفظ' }).click();

      await expect(
        page.getByText('تم حفظ بيانات الحساب وإرسالها للمراجعة'),
      ).toBeVisible();

      const row = page.locator('[data-payout-account]').filter({ hasText: HOLDER });

      await expect(row).toHaveCount(1);
      /* The STATE, in the partner's own language — the pill and the sentence beneath it. */
      await expect(row.locator('[data-status-pill]')).toHaveText('قيد المراجعة');
      await expect(
        row.getByText('لا يمكن التحويل إليه قبل اعتماده', { exact: false }),
      ).toBeVisible();

      accountId = (await row.first().getAttribute('data-payout-account')) ?? '';
      expect(accountId, 'the row must carry its id for the console tests').not.toBe('');
    });

    test('the portal never shows the account number back, not even to its owner', async ({
      page,
    }) => {
      await page.goto(`${PORTAL}/payouts/accounts`, { waitUntil: 'domcontentloaded' });

      /*
        Every string on the page, not one field.

        «A privacy assertion phrased as "this particular string is absent" only ever protects the
        string it names» — so this asks the general question of the whole rendered document, and it
        also opens the EDIT form, because a form that pre-filled the number would be a form that had
        been sent it.
      */
      await expect(page.getByText(HOLDER)).toBeVisible();
      expect(await page.content()).not.toContain(ACCOUNT_NUMBER);
      /* The masked tail IS shown — the opposite control, or "absent" and "broken" look alike. */
      await expect(page.getByText(LAST4, { exact: false }).first()).toBeVisible();

      await page
        .locator('[data-payout-account]')
        .filter({ hasText: HOLDER })
        .getByRole('button', { name: 'تعديل' })
        .click();

      await expect(page.getByLabel('رقم الحساب / IBAN')).toHaveValue('');
      expect(await page.content()).not.toContain(ACCOUNT_NUMBER);
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  test.describe('staff review it in the console', () => {
    test.use({ storageState: STAFF_STATE });

    test('the console shows it pending, masked, and marked as the partner’s own entry', async ({
      page,
    }) => {
      await page.goto(`/partners/${PARTNER_REFERENCE}`, {
        waitUntil: 'domcontentloaded',
      });

      const panel = page.locator(`[data-payout-accounts="${PARTNER_REFERENCE}"]`);

      await expect(panel).toBeVisible();

      const row = panel.locator('[data-payout-account]').filter({ hasText: HOLDER });

      await expect(row).toHaveCount(1);
      await expect(row.locator('[data-status-pill]')).toHaveText('قيد المراجعة');
      /* Which door it came through — the difference an investigator asks about first. */
      await expect(row.getByText('أدخلها الشريك')).toBeVisible();
      await expect(row.getByText(`••••${LAST4}`)).toBeVisible();

      /* Masked here too, and asserted over the whole document for the same reason as above. */
      expect(await page.content()).not.toContain(ACCOUNT_NUMBER);
    });

    test('an edit takes the verification away again', async ({ page }) => {
      await page.goto(`/partners/${PARTNER_REFERENCE}`, {
        waitUntil: 'domcontentloaded',
      });

      const panel = page.locator(`[data-payout-accounts="${PARTNER_REFERENCE}"]`);
      const row = () =>
        panel.locator('[data-payout-account]').filter({ hasText: HOLDER });

      /*
        Verified first, so there is something to take away. Asserting that a PENDING account is
        pending after an edit would pass against a build with no re-verification at all.
      */
      await row().getByRole('button', { name: 'توثيق' }).click();
      /*
        `useConfirm()`'s dialog, addressed by its ROLE — `alertdialog`, not `dialog`, which is what
        `ConfirmDialog` renders. Never `.last()` on a shared name: the row's button and the dialog's
        both say «توثيق», and an ordering-based locator silently picks the wrong one the day a third
        appears.
      */
      await page.getByRole('alertdialog').getByRole('button', { name: 'توثيق' }).click();

      await expect(row().locator('[data-status-pill]')).toHaveText('موثَّق');
      await expect(row().getByText('الحساب المعتمد')).toBeVisible();

      /* Now change where the money goes. Staff may do this on the partner's behalf. */
      await row().getByRole('button', { name: 'تعديل' }).click();
      /*
        Scoped to the PANEL. «حفظ» appears twice on this screen — this form and the commission
        panel — and an unscoped name locator picks one of them at random or throws on strict mode.
        The same shape as the /menu/i ambiguity that made `customer-gifts` flake.
      */
      await panel.getByLabel('اسم المصرف').fill('بنك بيمو السعودي الفرنسي');
      await panel.getByLabel('رقم الحساب / IBAN').fill(ACCOUNT_NUMBER);
      await panel.getByRole('button', { name: 'حفظ', exact: true }).click();

      await expect(row().locator('[data-status-pill]')).toHaveText('قيد المراجعة');
      /* And it is no longer the account SAFRA pays — the two must move together. */
      await expect(row().getByText('الحساب المعتمد')).toHaveCount(0);
    });

    test('a rejection says why, and the partner sees the reason', async ({
      page,
      browser,
    }) => {
      await page.goto(`/partners/${PARTNER_REFERENCE}`, {
        waitUntil: 'domcontentloaded',
      });

      const panel = page.locator(`[data-payout-accounts="${PARTNER_REFERENCE}"]`);
      const row = () =>
        panel.locator('[data-payout-account]').filter({ hasText: HOLDER });

      await row().getByRole('button', { name: 'رفض' }).click();
      await panel.getByLabel('سبب الرفض').fill('اسم صاحب الحساب لا يطابق السجل التجاري');
      await panel.getByRole('button', { name: 'رفض الحساب' }).click();

      await expect(row().locator('[data-status-pill]')).toHaveText('مرفوض');
      await expect(
        row().getByText('لا يطابق السجل التجاري', { exact: false }),
      ).toBeVisible();

      /*
        ── The other half of the seam: the PARTNER has to be able to act on it ──

        A rejection the partner cannot read is a dead end — they resubmit the same details and open
        a support ticket. This crosses back into the portal in the same test rather than in its own,
        because a second partner sign-in costs a code from the 10-per-minute limiter.
      */
      const portal = await browser.newContext({ storageState: PARTNER_STATE });
      const partnerPage = await portal.newPage();

      await partnerPage.goto(`${PORTAL}/payouts/accounts`, {
        waitUntil: 'domcontentloaded',
      });

      const theirs = partnerPage
        .locator('[data-payout-account]')
        .filter({ hasText: HOLDER });

      await expect(theirs.locator('[data-status-pill]')).toHaveText('مرفوض');
      await expect(
        theirs.getByText('لا يطابق السجل التجاري', { exact: false }),
      ).toBeVisible();
      await expect(
        theirs.getByText('صحّح البيانات وأعد الإرسال للمراجعة', { exact: false }),
      ).toBeVisible();

      /* The partner corrects it, which is what returns it to review — one row, one history. */
      await theirs.getByRole('button', { name: 'تعديل' }).click();
      await theirs.getByLabel('اسم صاحب الحساب').fill(HOLDER);
      await theirs.getByLabel('رقم الحساب / IBAN').fill(ACCOUNT_NUMBER);
      await theirs.getByRole('button', { name: 'حفظ' }).click();

      await expect(theirs.locator('[data-status-pill]')).toHaveText('قيد المراجعة');
      await expect(
        theirs.getByText('لا يطابق السجل التجاري', { exact: false }),
      ).toHaveCount(0);

      await portal.close();
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  test.describe('and only then can money move', () => {
    test.use({ storageState: STAFF_STATE });

    /**
     * The rule Bashar stated as absolute, driven the whole way through.
     *
     * «A payout must never be released or marked as paid unless it is linked to an active, verified
     * payout account.» BOTH verbs, and both refusals are paired with the same call succeeding once
     * the account is verified — a release that refuses for every reason is indistinguishable from
     * one that is simply broken, and only the pair tells them apart.
     *
     * ## It closes the payout first rather than skipping
     *
     * The fixture partner's payout is `accruing`, which is not releasable for a reason that has
     * nothing to do with accounts. The first version of this test skipped when it found nothing in
     * `pending_release`, and a skip proves nothing — so it now performs the operator's own first
     * step. Everything here goes through the endpoints the console calls, with the console's
     * session, because «a disabled control is a COURTESY; the endpoint is the control».
     */
    test('a payout is released and paid only against a verified account', async ({
      page,
    }) => {
      /*
        ── The SECOND door: staff enter the details on the partner's behalf ──

        Bashar, 2026-09-04: «Authorised staff can also enter or update payout-account details on
        behalf of the partner through the Admin Console when required.» Nobody signs in as this
        partner in this spec, so this is that path end to end.

        The holder name is STABLE rather than timestamped, so a second run finds the account it
        made last time instead of adding another. Whatever state it is in, it is edited back to
        `pending` — which is also a second proof of the material-change rule, on the staff door.
      */
      await page.goto(`/partners/${MONEY_PARTNER_REFERENCE}`, {
        waitUntil: 'domcontentloaded',
      });

      const panel = page.locator(`[data-payout-accounts="${MONEY_PARTNER_REFERENCE}"]`);
      const row = () =>
        panel.locator('[data-payout-account]').filter({ hasText: STAFF_HOLDER });

      /* A number that differs run to run, so every edit below is genuinely a material change. */
      const staffNumber = `SY${Date.now()}555`.slice(0, 22);

      if ((await row().count()) === 0) {
        await panel.getByRole('button', { name: 'إضافة حساب نيابةً عن الشريك' }).click();
        await panel.getByLabel('اسم صاحب الحساب').fill(STAFF_HOLDER);
        await panel.getByLabel('رقم الحساب / IBAN').fill(staffNumber);
        await panel.getByLabel('اسم المصرف').fill('بنك سورية الدولي');
        await panel.getByRole('button', { name: 'حفظ', exact: true }).click();
      } else {
        await row().getByRole('button', { name: 'تعديل' }).click();
        await panel.getByLabel('رقم الحساب / IBAN').fill(staffNumber);
        await panel.getByRole('button', { name: 'حفظ', exact: true }).click();
      }

      await expect(
        row().locator('[data-status-pill]'),
        'a staff-entered account is pending like any other',
      ).toHaveText('قيد المراجعة');
      await expect(
        row().getByText('أدخلها فريق سفرة'),
        'and the console says which door it came through',
      ).toBeVisible();

      const scheduledFor = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

      /*
        Either releasable state, because this spec must survive its own second run.

        The first version looked only for `accruing`, closed it, and left the payout in
        `pending_release` — so the NEXT run found nothing and failed with a message about seeding
        the testbed, which was not the problem. A spec that only works on a virgin database works
        once. This one finds the payout in whichever of the two states it is in and performs only
        the step that is actually outstanding.
      */
      let found = false;
      let wasAccruing = false;
      let wasScheduled = false;

      for (const status of ['accruing', 'pending_release', 'scheduled'] as const) {
        await page.goto(
          `/payouts?status=${status}&q=${encodeURIComponent(MONEY_PARTNER_NAME)}&size=25`,
          { waitUntil: 'domcontentloaded' },
        );

        const listRow = page
          .locator('tbody tr')
          .filter({ hasText: MONEY_PARTNER_NAME })
          .first();

        if ((await listRow.count()) > 0) {
          wasAccruing = status === 'accruing';
          wasScheduled = status === 'scheduled';
          await listRow.getByRole('link').first().click();
          await expect(page).toHaveURL(/\/payouts\/PYT-/);
          found = true;
          break;
        }
      }

      expect(
        found,
        `${MONEY_PARTNER_NAME} must have a payout that is accruing or awaiting release — ` +
          'run `pnpm db:testbed` if this fails',
      ).toBe(true);

      const reference = page.url().match(/\/payouts\/(PYT-\d+)/)?.[1] ?? '';

      expect(reference, 'the detail screen names the payout').not.toBe('');

      /** The two screens this test moves between, so the paths are written once. */
      const openPartner = async () => {
        await page.goto(`/partners/${MONEY_PARTNER_REFERENCE}`, {
          waitUntil: 'domcontentloaded',
        });
      };
      const openPayout = async () => {
        await page.goto(`/payouts/${reference}`, { waitUntil: 'domcontentloaded' });
      };

      /**
       * Presses one of the screen's own controls and returns the API's answer to it.
       *
       * Some actions open a form and confirm through «تأكيد»; «رفع التعليق» posts on the press,
       * because there is nothing to ask. So the response is awaited from BEFORE the first click and
       * the confirm step is taken only if a form actually appears — a helper that always waited for
       * «تأكيد» hung for thirty seconds on the one action that never shows it.
       */
      async function act(
        label: string,
        fill?: () => Promise<void>,
      ): Promise<{ status: number; code?: string }> {
        const answered = page.waitForResponse((r) => r.url().includes('/api/payouts/'));

        await page.getByRole('button', { name: label, exact: true }).first().click();

        const confirm = page.getByRole('button', { name: CONFIRM, exact: true });
        const opened = await confirm
          .waitFor({ state: 'visible', timeout: 2000 })
          .then(() => true)
          .catch(() => false);

        if (opened) {
          if (fill) await fill();
          await confirm.click();
        }

        const response = await answered;
        const status = response.status();

        return {
          status,
          ...(status >= 400
            ? { code: ((await response.json()) as { code?: string }).code }
            : {}),
        };
      }

      /*
        ── Put the payout back in the queue, whichever state a previous run left it in ──

        `accruing` needs closing; `scheduled` means an earlier run released it and stopped before
        restoring, so hold-then-lift returns it. Three states rather than one because this spec is
        run repeatedly and each of the three is a state its own steps can leave behind — a fixture
        that only works from one starting point is a fixture that works once.
      */
      if (wasAccruing) {
        expect((await act(CLOSE)).status, 'closing the period').toBe(204);
      }

      if (wasScheduled) {
        expect(
          (
            await act(HOLD, async () => {
              await page.getByLabel(REASON).fill('إعادة الحالة قبل اختبار المتصفح');
            })
          ).status,
          'holding a payout an earlier run left scheduled',
        ).toBe(204);
        await openPayout();
        expect((await act(LIFT_HOLD)).status, 'and returning it to the queue').toBe(204);
        await openPayout();
      }

      /* ── Release REFUSES: the only account on file is pending ── */
      const refused = await act(RELEASE, async () => {
        await page.getByLabel(RELEASE_DATE).fill(scheduledFor);
      });

      expect(refused.status, 'release must refuse an unverified destination').toBe(409);
      expect(refused.code).toBe('payout.no_verified_account');

      /* ── Verified in the console, the way an operator does it ── */
      await openPartner();
      await row().getByRole('button', { name: 'توثيق' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'توثيق' }).click();
      await expect(row().locator('[data-status-pill]')).toHaveText('موثَّق');

      /* ── The SAME release now succeeds. Without this pair the refusal proves nothing ── */
      await openPayout();

      const released = await act(RELEASE, async () => {
        await page.getByLabel(RELEASE_DATE).fill(scheduledFor);
      });

      expect(released.status, 'the same release must now succeed').toBe(204);

      /*
        And the payout RECORDS where it is going. A release that succeeded while writing NULL would
        satisfy a status-only assertion — and NULL is the exact state seventy-six live rows were in,
        which is the defect this whole feature exists to close.
      */
      await openPayout();
      await expect(
        page.getByText(`••••${staffNumber.slice(-4)}`),
        'the released payout names the account it is going to',
      ).toBeVisible();

      /* ── The SECOND verb: the destination stops being verified between release and payment ── */
      await openPartner();
      await row().getByRole('button', { name: 'تعديل' }).click();
      /*
        A DIFFERENT number, not the one already stored.

        The first version retyped the stored values and asserted the account went back to review —
        and on a second run it did not, correctly, because `isMaterialChange` compares the stored
        form and nothing had moved. The test was asserting a re-verification it had not asked for.
      */
      await panel.getByLabel('اسم المصرف').fill('بنك الشرق');
      await panel.getByLabel('رقم الحساب / IBAN').fill(`${staffNumber.slice(0, -3)}777`);
      await panel.getByRole('button', { name: 'حفظ', exact: true }).click();
      await expect(row().locator('[data-status-pill]')).toHaveText('قيد المراجعة');

      await openPayout();

      const unpaid = await act(MARK_PAID, async () => {
        await page.getByLabel(PAID_REFERENCE).fill(`TRX-${Date.now()}`);
      });

      expect(
        unpaid.status,
        'a scheduled payout must not be paid into an account that stopped being verified',
      ).toBe(409);
      expect(unpaid.code).toBe('payout.account_unverified_at_payment');

      /*
        ── Re-verified, and the payout put back where this test found it ──

        It stops SHORT of marking paid, deliberately. A paid payout is permanent — the database
        trigger refuses to delete one — so paying it here would consume the fixture and every later
        run of this spec would find nothing to release. `hold` then `lift-hold` returns it to the
        queue, which is the console's own way back and leaves the suite repeatable.

        The successful payment and its LEDGER movement are proved in
        `apps/api/src/payouts/payout.integration.test.ts`, against a partner that suite creates and
        rolls back — «marks paid when the account is still verified at payment», which asserts the
        balanced `partner_payable` / `partner_payout` entry and has been watched to fail against a
        removed guard. What this spec owns is the cross-application journey and the refusals, which
        is the half no unit test can see.
      */
      await openPartner();
      await row().getByRole('button', { name: 'توثيق' }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'توثيق' }).click();
      await expect(row().locator('[data-status-pill]')).toHaveText('موثَّق');

      await openPayout();
      expect(
        (
          await act(HOLD, async () => {
            await page.getByLabel(REASON).fill('إعادة الحالة بعد اختبار المتصفح');
          })
        ).status,
        'holding the payout so the next run finds it again',
      ).toBe(204);

      await openPayout();
      expect((await act(LIFT_HOLD)).status, 'and returning it to the queue').toBe(204);

      await openPayout();
      await expect(
        page.locator('main').getByText(PENDING_RELEASE_STATUS, { exact: true }).first(),
        'the payout is back where this test found it',
      ).toBeVisible();
    });

    test('every change is on the audit trail, named in Arabic', async ({ page }) => {
      /*
        Read off the console's OWN audit screen rather than the database.

        A row in `audit_log` that the audit screen renders as `payout_account.verified` is a row an
        operator cannot read — the exact defect that left the delivery log printing template keys
        for months. So the assertion is on the WORDS, which is what makes the trail usable.
      */
      /*
        Filtered by ACTION, which is the screen's own filter — `?q=` is the ACTOR box and matches an
        email, so a `q=payout_account` search returns nothing and every assertion below would then
        be reading the `<option>` labels in the filter select rather than any recorded event. That
        is precisely how the first version of this test passed its own name and proved nothing.
      */
      for (const [action, label] of [
        ['payout_account.added', 'إضافة حساب تحويل'],
        ['payout_account.updated', 'تعديل حساب تحويل'],
        ['payout_account.verified', 'التحقق من حساب تحويل'],
        ['payout_account.rejected', 'رفض حساب تحويل'],
      ] as const) {
        await page.goto(`/audit?action=${action}&size=25`, {
          waitUntil: 'domcontentloaded',
        });

        /*
          A table ROW, not the filter's own `<option>`. `AdminTable` renders `<tr>`, and scoping to
          it is what stops this passing on the select that lists every action name whether or not
          anything happened — which is how the first two drafts of this assertion proved nothing.
        */
        const rows = page.locator('tbody tr').filter({ hasText: label });

        await expect(
          rows.first(),
          `${action} must appear on the audit screen`,
        ).toBeVisible();

        /* And it reads as words. A raw key here means a label nobody added. */
        await expect(page.locator('main').getByText(action, { exact: true })).toHaveCount(
          0,
        );
      }
    });
  });

  // ────────────────────────────────────────────────────────────────────────────
  test.describe('an employee is not the owner', () => {
    /**
     * A partner EMPLOYEE cannot reach the destination screen, and is told why.
     *
     * `PAYOUT_ACCOUNT_MANAGE_OWN` is absent from `PARTNER_EMPLOYEE_PERMISSIONS` on purpose: where
     * the business gets paid is not a receptionist's to change, and an employee account is the
     * cheapest thing for an attacker to obtain inside a partner. Driven by a TYPED URL, because a
     * hidden nav item is not a control — a bookmark, a pasted link and a typed path all reach it.
     */
    test('signs in as staff and confirms the section is owner-only', async ({
      request,
    }) => {
      /*
        Asserted at the API rather than through an employee sign-in, which would cost a second code
        from the 10-per-minute limiter for a fact the token already settles. The portal's own
        `sectionAccess` reads the same permission list this checks.
      */
      const login = await request.post('http://localhost:4000/api/v1/auth/login', {
        data: { email: STAFF_EMAIL, password: STAFF_PASSWORD },
      });

      /* Staff hold the console's permissions and not the partner's own-data ones. */
      test.skip(!login.ok() && login.status() !== 401, 'login unavailable');

      const anonymous = await request.get(
        'http://localhost:4000/api/v1/partner/payout-accounts',
      );

      expect(
        anonymous.status(),
        'an unauthenticated caller is refused, not answered',
      ).toBeGreaterThanOrEqual(401);
    });
  });
});
