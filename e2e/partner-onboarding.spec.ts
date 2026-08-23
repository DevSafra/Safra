import { expect, test, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * تسجيل شريك جديد — a super admin onboarding a partner end to end, in one sitting
 * (Bashar, 2026-08-23).
 *
 * ## Why a browser, and why the whole walk rather than four separate tests
 *
 * Because the thing being verified IS the walk. Every step is a separate endpoint with its own
 * permission, and each one is already covered by an integration test; what no server-side test can
 * see is whether an operator sitting with a partner can get from الشركاء to an approved partner
 * without leaving the console. That chain is a form POST, a client-side redirect that carries state
 * in the query string, a multipart upload through a BFF route, a base64 upload through a different
 * one, and a server component re-reading the partner after each. Half of it is hydration.
 *
 * `pnpm verify` passed green on all of it while none of these screens existed, which is the
 * standing reason this project does not treat an HTTP-level suite as verification of a client
 * change.
 *
 * ## The partner it creates is new on every run
 *
 * The email carries a timestamp, because onboarding REFUSES an address that is already a partner —
 * correctly — so a fixed fixture address would pass once and then fail for the right reason
 * forever. The rows are left behind deliberately: they are the same kind of local test data
 * `partner-fixtures.ts` writes, and a partner cannot be deleted (P-003).
 *
 * ## It does not touch the pagination bar
 *
 * The suite shares one account, so submitting the rows-per-page form leaks a saved preference into
 * later specs AND later runs. This spec only ever reads the registry.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);
test.use({ storageState: STAFF_STATE, viewport: { width: 1440, height: 900 } });

/** `PAR-000123`, as it appears in the URL after the form redirects. */
const REFERENCE_IN_PATH = /\/partners\/(PAR-\d+)\/onboarding/;

const onboarding = t.sections.partnerOnboarding;

/**
 * A fresh business, unique to this run.
 *
 * The timestamp is in the LOCAL part rather than the domain so the address stays a valid one and
 * the row is recognisable in الشركاء when somebody goes looking for what a test left behind.
 */
function newPartner(): {
  email: string;
  legalName: string;
  displayName: string;
} {
  const stamp = Date.now();

  return {
    email: `onboarding-e2e-${stamp}@safra.test`,
    legalName: `شركة اختبار التسجيل ${stamp}`,
    displayName: `فندق اختبار ${stamp}`,
  };
}

/**
 * Errors the page logged, collected from the moment this is called.
 *
 * Returns the LIVE array rather than a promise of a finished one: the listener stays attached for
 * the rest of the test and the caller reads it at the end. A hydration failure surfaces here and
 * nowhere else — it does not fail a request and it does not change the server's answer.
 */
function consoleErrors(page: Page): string[] {
  const errors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });

  return errors;
}

test.describe('onboarding a partner in person', () => {
  /**
   * The whole sitting: the form, the documents, the contract, the approval.
   *
   * Asserted in the order an operator does it, and each assertion is about what they can SEE —
   * the state word on a step, the document in the list, the approval control appearing — because
   * those are the things a broken redirect or a failed hydration takes away while every
   * server-side test stays green.
   */
  test('walks from the registry to an approved partner', async ({ page }) => {
    const errors = consoleErrors(page);
    const partner = newPartner();

    /* ── ① From الشركاء, by the control an operator would actually find ── */
    await page.goto('/partners');

    await page.getByRole('link', { name: t.sections.partners.onboard }).click();
    await expect(page).toHaveURL(/\/partners\/new$/);

    /*
      The password note is asserted, not incidental. It is the sentence that tells the operator
      they are not about to set a password, and it has to be on screen BEFORE the form — an
      operator who learns it at the end has already promised the partner something else.
    */
    await expect(page.getByText(onboarding.passwordNote)).toBeVisible();

    /* ── The form. Located by label, so a renamed field fails rather than silently skips ── */
    await page.getByLabel(onboarding.contactName).fill('أبو محمد');
    await page.getByLabel(onboarding.email).fill(partner.email);
    await page.getByLabel(onboarding.phone).fill('+963116414444');
    await page.getByLabel(onboarding.legalName).fill(partner.legalName);
    await page.getByLabel(onboarding.displayName).fill(partner.displayName);
    await page.getByLabel(onboarding.address).fill('شارع الاختبار 1');
    await page
      .getByLabel(onboarding.notes)
      .fill('اختبار آلي: وقّعنا العقد في المكتب بحضور الطرفين.');

    await page.locator('button[type="submit"]').click();

    /* ── ② The redirect lands on the stepped screen, carrying the created banner ── */
    await expect(page).toHaveURL(REFERENCE_IN_PATH, { timeout: 15_000 });

    const reference = REFERENCE_IN_PATH.exec(page.url())?.[1];

    expect(reference).toBeTruthy();

    /*
      The banner names the reference AND the address. Both matter: the reference is what the
      operator quotes, and the address is what they read back to the partner to confirm the
      invitation is going somewhere the partner can actually reach.
    */
    await expect(page.getByText(reference as string).first()).toBeVisible();
    await expect(page.getByText(partner.email, { exact: false })).toBeVisible();

    /* Step ② starts outstanding, and says WHICH documents are wanted rather than just "no". */
    await expect(
      page
        .getByText(t.enums.documentKind['identity'] as string, { exact: false })
        .first(),
    ).toBeVisible();

    /* ── The document upload, through the multipart BFF route ── */
    await page
      .getByLabel(onboarding.documentFile)
      .setInputFiles('e2e/fixtures/room-one.jpg');

    await page.getByRole('button', { name: onboarding.upload }).click();

    /*
      The uploaded document appears in the list below. Asserted on the LIST rather than on the
      success line, because the success line is client state and the list is the server's answer —
      only the second one proves the row exists.
    */
    await expect(
      page
        .locator('[data-document-kind], li')
        .filter({
          hasText: t.enums.documentKind['identity'] as string,
        })
        .first(),
    ).toBeVisible({ timeout: 15_000 });

    /* ── ③ The contract. Generating it is the step SAFRA does before anybody signs ── */
    await expect(page.getByText(onboarding.contractStateNone)).toBeVisible();

    await page.getByRole('button', { name: t.sections.partnerContract.generate }).click();

    /*
      `draft` — generated, and nobody has signed it. The panel and this checklist have to agree
      about that, which is the whole reason the state line is asserted here as well as in the
      contract spec: two components describing one state on one screen is where they drift.
    */
    await expect(page.getByText(onboarding.contractStateDraft)).toBeVisible({
      timeout: 30_000,
    });

    /*
      ── The signed copy: download what was generated, then upload it back ──

      This is not a shortcut around signing — it IS the workflow, minus the printer. SAFRA
      generates the agreement, a human signs the paper, and the scan goes back up; the bytes going
      down and coming back up is the only part a browser can perform, and it exercises everything
      that matters on this path — the download route, the base64 upload through the BFF, the 15MB
      JSON limit that a real ~540KB contract needs, and the state transition afterwards.

      A fixture PDF would have tested the upload against a 68-byte file, which is exactly how the
      body-limit defect of 2026-08-21 stayed hidden while every test passed.
    */
    const download = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: t.sections.partnerContract.download }).click(),
    ]).then(([event]) => event);

    const signedCopy = await download.path();

    expect(signedCopy).toBeTruthy();

    await page.getByLabel(t.sections.partnerContract.file).setInputFiles(signedCopy);

    await page
      .getByRole('button', { name: t.sections.partnerContract.uploadSigned })
      .click();

    /*
      `awaiting_partner_signature` — SAFRA has signed and the partner has been emailed.

      This is as far as ONE SITTING can honestly go, and the limit is deliberate rather than a gap
      in the test. The partner's own signature is uploaded from the PARTNER'S account, because
      `contract_signature_party = 'partner'` means "signed by hand and uploaded from their own
      account" — and during the sitting that account has no password yet, by design. Filing their
      signature for them would make that column say something untrue. See docs/FUTURE-WORK.md.
    */
    await expect(page.getByText(onboarding.contractStateAwaitingPartner)).toBeVisible({
      timeout: 30_000,
    });

    /* ── ⑤ The approval control is reachable, and approving takes ── */
    await expect(
      page.getByRole('button', { name: t.sections.verifyPartner.approve }),
    ).toBeVisible();

    await page.getByRole('button', { name: t.sections.verifyPartner.approve }).click();
    await page
      .getByRole('button', { name: t.sections.verifyPartner.confirmApproval })
      .click();

    /* The step reports done, which is the server's `verification` read back. */
    await expect(page.getByText(onboarding.approvalDone)).toBeVisible({
      timeout: 15_000,
    });

    /* Nothing in that walk was allowed to log an error — a hydration failure shows up here. */
    expect(errors.filter((line) => !line.includes('favicon'))).toStrictEqual([]);
  });

  /**
   * The refusals, seen by the operator rather than only by the service.
   *
   * The service's own refusals are covered in `partner-onboarding.integration.test.ts`. What this
   * adds is that the coded 400 arrives as an ARABIC sentence under the form instead of an English
   * message or a blank screen — the failure mode `apiError` exists to prevent.
   */
  test('refuses a staff address in Arabic, without leaving the form', async ({
    page,
  }) => {
    await page.goto('/partners/new');

    const stamp = Date.now();

    await page.getByLabel(onboarding.contactName).fill('اختبار');
    /*
      The signed-in staff account's own address — the one address this test can be certain belongs
      to a staff account without reading a credential out of `.env`.
    */
    await page
      .getByLabel(onboarding.email)
      .fill(process.env['DEV_STAFF_EMAIL'] as string);
    await page.getByLabel(onboarding.phone).fill('+963116414444');
    await page.getByLabel(onboarding.legalName).fill(`شركة ${stamp}`);
    await page.getByLabel(onboarding.displayName).fill(`فندق ${stamp}`);
    await page.getByLabel(onboarding.address).fill('شارع الاختبار 1');
    await page.getByLabel(onboarding.notes).fill('اختبار آلي للرفض.');

    await page.locator('button[type="submit"]').click();

    /*
      Scoped to `main`, because Next renders its own empty `role="alert"` route announcer as a
      sibling of it — an unscoped `getByRole('alert')` matches that one, finds it visible, reads
      an empty string out of it and passes every assertion below vacuously. Which it did.
    */
    const alert = page.locator('main [role="alert"]');

    /* The Arabic sentence for `partner_onboarding.email_is_staff`, and still on the form. */
    await expect(alert).toBeVisible({ timeout: 15_000 });
    await expect(page).toHaveURL(/\/partners\/new$/);

    /* Not English, and not a raw code. Both were real failure modes on this exact path. */
    const message = await alert.innerText();

    expect(message).not.toContain('partner_onboarding');
    expect(message).toMatch(/[؀-ۿ]/);
  });
});

/**
 * Both new screens at every width the console is checked at.
 *
 * 1024 is the one that regresses silently — wide enough to look fine in a screenshot, narrow
 * enough that a fourteen-field form's two-column grid stops fitting.
 */
test.describe('responsive', () => {
  for (const width of [390, 768, 1024, 1440]) {
    test(`the onboarding form does not scroll sideways at ${width}px`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/partners/new');

      await expect(page.getByText(onboarding.passwordNote)).toBeVisible();

      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );

      /*
        One pixel of slack for sub-pixel layout rounding, which is what a fractional grid gap
        produces at 390px and is not a horizontal scrollbar.
      */
      expect(overflow).toBeLessThanOrEqual(1);
    });
  }
});
