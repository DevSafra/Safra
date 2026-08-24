import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { authenticator } from 'otplib';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * A console role that opens ONE section, watched refusing somebody.
 *
 * ## Why this exists, and what green means without it
 *
 * On 2026-08-24 the console's section pages were built and the helper that gates them was never
 * consumed by any of them: a staff member holding one capability saw every nav link, and every one
 * answered «انتهت الجلسة» — a reader with a perfectly good session told to sign in again over a
 * permission that signing in cannot change. Nothing failed. It was found by asking.
 *
 * Thirty-four guards then landed and the suite went green. **That green does not mean the gating
 * works.** Every other console spec runs as a SUPER ADMIN, who holds everything, so every guard
 * answers `open` and not one refusal has ever rendered. Without this file, the first person to see
 * a refusal is the person the feature was built for, on their own screen.
 *
 * ## It is written to be idempotent, not clean
 *
 * A staff account cannot be deleted — suspended, never removed, which the console says in its own
 * copy. A spec that created one per run would leave one behind every time, the same accumulation
 * as `O-e2e-3`. So this creates the role and the account on the FIRST run and signs in as them on
 * every run after, which is why it reads before it writes.
 *
 * What it reads for is the part worth stating, because the first version got it wrong: it asks
 * whether the account is REDEEMED, not whether it exists. An invited-but-unredeemed account exists
 * — it holds the role and has no password — so a run that got as far as inviting and then failed
 * left one behind, and every run after skipped the redemption, signed in with a password nobody had
 * set, and failed at enrolment. Since the account cannot be deleted, that state could not clear
 * itself. Each branch below can now recover from the state before it: unredeemed is resent and
 * redeemed, un-enrolled is enrolled, and an enrolled account signs in with a kept secret.
 *
 * ## The control is the important half
 *
 * A gating change that refuses EVERYBODY passes every "is it refused" assertion perfectly, and that
 * is the shape a hurried thirty-four-page wiring actually produces. The last test proves the super
 * admin still reaches the very section the narrow reader was refused.
 */
const ROLE_NAME = 'e2e-audit-only';
const STAFF_EMAIL = 'e2e-audit-only@safra.com';
const STAFF_NAME = 'قارئ السجل';

/** Set by this spec, so it must satisfy `passwordSchema` — the seeded testbed password does not. */
const STAFF_PASSWORD = 'Console-Testbed-1!';

const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';

/**
 * The narrow account's TOTP secret, kept BETWEEN runs.
 *
 * Deliberately not under `test-results/`, which is where it started and where it does not work:
 * Playwright empties `outputDir` at the start of every run, so the file was written by the run that
 * enrolled and gone before the run that needed it — the spec then reported the account as enrolled
 * with no way to generate a code, which is true and is not a gating result.
 *
 * Git-ignored, and it holds a credential for a local test account only.
 */
const TOTP_FILE = '.e2e-secrets/narrow-totp.json';

/**
 * The ONE capability this role carries: read the audit log.
 *
 * `audit_log.read` opens exactly one section and nothing else, so the nav assertion has one link to
 * find and the rest to prove absent. It is also read-only, so a runaway spec cannot change data.
 */
const CAPABILITY = t.sections.staffRoles.capability['audit_log.read'] ?? 'audit_log.read';

/** The newest link matching a pattern in an address's inbox. Polls: mail goes through the queue. */
async function linkFor(
  request: APIRequestContext,
  address: string,
  pattern: RegExp,
  since: Date,
): Promise<string> {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const listed = (await (
      await request.get(`${MAILPIT}/api/v1/messages?limit=40`)
    ).json()) as {
      messages?: { ID: string; Created: string; To: { Address: string }[] }[];
    };

    for (const message of listed.messages ?? []) {
      if (!message.To.some((to) => to.Address === address)) continue;
      if (Date.parse(message.Created) < since.getTime() - 1000) continue;

      const body = (await (
        await request.get(`${MAILPIT}/api/v1/message/${message.ID}`)
      ).json()) as { Text?: string };

      const found = pattern.exec(body.Text ?? '');

      if (found?.[0]) return found[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(`No mail matching ${String(pattern)} arrived for ${address}.`);
}

/**
 * A TOTP code with a full window ahead of it.
 *
 * A code generated with a moment left expires between being typed and being submitted, and that
 * fails as a WRONG CODE — a flake indistinguishable from a broken form. `e2e/staff.ts` carries the
 * same guard, for the same reason.
 */
async function codeFor(secret: string): Promise<string> {
  if (authenticator.timeRemaining() < 5) {
    await new Promise((resolve) => setTimeout(resolve, 6000));
  }

  return authenticator.generate(secret);
}

/** The first step of the sign-in: who, and the password. */
async function credentials(page: Page): Promise<void> {
  await page.goto('/login');
  await page.getByLabel(t.login.email).fill(STAFF_EMAIL);
  await page.getByLabel(t.login.password, { exact: true }).fill(STAFF_PASSWORD);
  await page.getByRole('button', { name: t.login.submitCredentials }).click();
}

/** The second step, from the secret kept at enrolment. */
async function submitCode(page: Page): Promise<void> {
  expect(
    existsSync(TOTP_FILE),
    `${TOTP_FILE} is missing and this account is already enrolled, so no code can be generated. ` +
      'Recover with one of the recovery codes issued at enrolment, or clear ' +
      '`totp_secret_encrypted` for this account in the dev database.',
  ).toBe(true);

  const stored = JSON.parse(readFileSync(TOTP_FILE, 'utf8')) as { secret: string };

  await page.getByLabel(t.login.code).fill(await codeFor(stored.secret));
  await page.getByRole('button', { name: t.login.submitCode }).click();
}

/**
 * Sets the first password on an invited account, in a context of its OWN.
 *
 * The super admin's session must play no part: a redemption carried out while holding somebody
 * else's cookie proves nothing about the invitee.
 *
 * It ASSERTS the confirmation. A redemption that silently failed — a weak password, an expired
 * token — would otherwise leave an account with no password and hand the failure to the sign-in
 * three steps later, which is exactly how this spec came to be unrecoverable.
 */
async function redeem(page: Page, link: string): Promise<void> {
  /*
    The EMPTY `storageState` is the load-bearing argument, and leaving it out is a SILENT failure.

    `browser.newContext()` inside a test inherits that test's `use` options, so this context was
    born holding the super admin's session — the describe sets `storageState: STAFF_STATE`. The
    middleware then sends a fully authenticated visitor away from `/invitation` (`middleware.ts`:
    "the sign-in and enrolment pages have nothing left to offer"), so the redemption never loaded
    the form at all: a 307 to `/`, then a timeout on a password field that was never on the page.

    The comment here previously read "a fresh context: the invitation is redeemed by the invitee,
    not by the super admin". That was true of the intent and false of the code, and nothing could
    show the difference — the browser reported 307 where the probe reported 200, and only the trace
    said so.
  */
  const invitee = await page
    .context()
    .browser()!
    .newContext({ storageState: { cookies: [], origins: [] } });
  const inviteePage = await invitee.newPage();

  await inviteePage.goto(link);

  /*
    ON the invitation page. Without this a redirect fails three lines down as a missing field,
    which reads as a broken FORM rather than as never having arrived.
  */
  await expect(
    inviteePage,
    'the invitation page redirected — the redeeming context is carrying a session it should not',
  ).toHaveURL(/\/invitation\//, { timeout: 20_000 });
  await inviteePage
    .getByLabel(t.sections.invitation.newPassword, { exact: true })
    .fill(STAFF_PASSWORD);
  await inviteePage
    .getByLabel(t.sections.invitation.confirmPassword, { exact: true })
    .fill(STAFF_PASSWORD);
  await inviteePage
    .getByRole('button', { name: t.sections.panels.invitationSubmit })
    .click();

  await expect(
    inviteePage.getByText(t.sections.invitation.passwordSet),
    'the invitation was not redeemed, so the account has no password to sign in with',
  ).toBeVisible({ timeout: 20_000 });

  await invitee.close();
}

test.describe('a console role that opens one section', () => {
  test.skip(MISSING_CREDENTIALS, SKIP_REASON);

  /**
   * The fixture, built by a SUPER ADMIN and reused on every later run.
   *
   * First in the file because everything after needs the account to exist. It reads before it
   * writes: a role already named `e2e-audit-only` is used as-is, and an address already invited is
   * left alone.
   */
  test.describe('setting up the narrow account', () => {
    test.use({ storageState: STAFF_STATE });

    test('creates the role and invites into it, once', async ({ page, request }) => {
      /*
        The default 30s is not enough for THIS test, and only this one.

        It is a fixture, not an assertion: two registry navigations, a detail screen, a mail POLL
        that waits on the queue, and a second browser context that loads the invitation page and
        submits it. The first run of the repaired reuse check spent its whole budget and stopped
        INSIDE the redemption, which then failed the sign-in test underneath it — a fixture running
        out of time is indistinguishable, from the report, from the feature being broken.
      */
      test.setTimeout(120_000);

      const since = new Date();

      await page.goto('/staff-roles');

      const role = page.locator('li, tr').filter({ hasText: ROLE_NAME });

      if ((await role.count()) === 0) {
        await page
          .getByRole('button', { name: t.sections.staffRoles.create })
          .first()
          .click();
        await page.getByLabel(t.sections.staffRoles.nameLabel).fill(ROLE_NAME);
        await page.getByLabel(CAPABILITY).check();
        await page
          .getByRole('button', { name: t.sections.staffRoles.create })
          .last()
          .click();

        await expect(role.first()).toBeVisible({ timeout: 15_000 });
      }

      await page.goto('/staff');

      /*
        REDEEMED, not merely PRESENT — and the difference is what made this spec unable to recover.

        The check was `getByText(STAFF_EMAIL).count() > 0`, which treats an account's EXISTENCE as
        proof it is usable. An invited-but-unredeemed account exists: it holds the role and has no
        password. So the first run that got as far as inviting and then failed left one behind, and
        every run after early-returned past the redemption, signed in with a password nobody had
        set, and failed at enrolment — a symptom three steps from its cause. `has_password = f` in
        the database is what it actually looked like.

        A staff account cannot be deleted, so this could not clear itself either. Nothing here was
        wrong when it was written; the condition tested something ADJACENT to what it meant, and
        adjacent held right up until it did not.

        الموظفون marks exactly this state «دعوة معلقة», so the ROW is the thing to read.
      */
      const row = page.locator('li').filter({ hasText: STAFF_EMAIL });
      const pending = row.filter({ hasText: t.sections.staff.invitationPending });

      if ((await row.count()) > 0 && (await pending.count()) === 0) {
        test
          .info()
          .annotations.push({ type: 'note', description: 'Account redeemed; reused.' });

        return;
      }

      /*
        Present but unredeemed: resend rather than invite again. The address is taken, so a second
        invitation is refused — and leaving it is precisely what made this unrecoverable.

        The resend control is on the DETAIL screen, not on the row: the registry renders the pill
        and `StaffMemberActions` renders the button. So this opens the row it just found.
      */
      if ((await pending.count()) > 0) {
        await pending.locator('a').first().click();
        await page.waitForURL(/\/staff\/[^/]+$/, { timeout: 20_000 });

        await page.getByRole('button', { name: t.sections.staff.inviteResend }).click();

        await redeem(
          page,
          await linkFor(request, STAFF_EMAIL, /https?:\/\/\S*\/invitation\/\S+/, since),
        );

        return;
      }

      /*
        No disclosure to open — «دعوة موظف جديد» is the section's HEADING, not a button.

        This clicked `getByRole('button', { name: t.sections.staff.invite })` and hung for the full
        timeout. The catalogue key is right and the string is on the page; the ROLE is not. The form
        renders unconditionally on الموظفون, so the first field is reachable straight away.
      */
      await page.getByLabel(t.sections.staff.inviteName).fill(STAFF_NAME);
      await page.getByLabel(t.sections.staff.inviteEmail).fill(STAFF_EMAIL);
      await page
        .getByLabel(t.sections.staff.inviteRole)
        .selectOption({ label: ROLE_NAME });
      await page.getByRole('button', { name: t.sections.staff.inviteSend }).click();

      const link = await linkFor(
        request,
        STAFF_EMAIL,
        /https?:\/\/\S*\/invitation\/\S+/,
        since,
      );

      await redeem(page, link);
    });
  });

  /**
   * The refusals themselves — the thing nobody has watched happen.
   *
   * A fresh context with NO storage state: the super admin's session must play no part, or every
   * assertion below would be about the wrong reader.
   */
  test.describe('as the narrow reader', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('sees its one section, is refused the rest, and keeps the two sentences apart', async ({
      page,
    }) => {
      await credentials(page);

      /*
        Staff are in `AUTHENTICATOR_ROLES`, so this account must hold a TOTP app — and that is the
        one part of this fixture that CANNOT be repeated. Enrolment happens once and issues a
        secret once; from the second run onwards the sign-in asks for a CODE instead. A spec that
        only knew how to enrol would work exactly once and then be stuck for good, which is the
        very trap the reuse check above was already sitting in.

        So the secret is kept. `test-results/` is git-ignored and already holds a live session
        cookie (`STAFF_STATE`), so a local test account's TOTP secret is not a new kind of thing to
        put there.

        Losing the file with the account enrolled is recoverable rather than fatal: enrolment
        issues RECOVERY CODES and `POST /auth/login` accepts one in place of a code. The message
        below says so, because a spec that strands itself with no stated way out is what this whole
        file spent the morning fixing.
      */
      const secret = page.locator('[data-totp-secret]');
      const codeField = page.getByLabel(t.login.code);

      await expect(
        secret.or(codeField).first(),
        'the narrow account could not sign in — its invitation is probably unredeemed, which is ' +
          'the fixture above failing, not the gating',
      ).toBeVisible({ timeout: 20_000 });

      if (await secret.isVisible()) {
        /*
          First run. The enrolment screen renders the secret as TEXT rather than a QR — its own
          docblock gives the reason, that a QR means either an external image service or a bundled
          library — and that is the only thing that makes this reachable from a browser test.
          `data-totp-secret` marks the element so this does not walk the DOM: a wrapper added around
          that paragraph would otherwise break the spec with a timeout that reads as a broken
          enrolment.
        */
        const value = ((await secret.textContent()) ?? '').replace(/\s/g, '');

        await page
          .getByLabel(t.sections.twoFactor.sixDigitCode)
          .fill(await codeFor(value));
        await page
          .getByRole('button', { name: t.sections.panels.twoFactorSubmit })
          .click();

        /*
          Enrolment is TWO controls, not one, and reading only the second cost a run: «تفعيل
          المصادقة الثنائية» submits the code, and «حفظتها — متابعة» acknowledges the RECOVERY CODES
          that appear afterwards. Waiting for the second while the first was still on screen spent
          the whole timeout on a button that had not been rendered yet.
        */
        const codes = page.locator('ul li');

        await expect(codes.first()).toBeVisible({ timeout: 20_000 });

        /*
          The recovery codes are kept WITH the secret, so the fallback named above is a real one.
          They are shown exactly once — `two-factor.service.ts` stores only Argon2id hashes — so a
          run that clicked past this screen without keeping them would have thrown away the only way
          back into an account that cannot be deleted.
        */
        mkdirSync(dirname(TOTP_FILE), { recursive: true });
        writeFileSync(
          TOTP_FILE,
          JSON.stringify({ secret: value, recoveryCodes: await codes.allTextContents() }),
          'utf8',
        );

        await page
          .getByRole('button', { name: t.sections.twoFactor.savedContinue })
          .click();

        /*
          NOTHING here re-signs in, and that absence is the assertion.

          Until O-sec-14 was fixed on 2026-08-24 this branch cleared the cookies and signed in a
          second time, because enrolling did not make the session enrolled: `enable` revoked every
          session — including the caller's own — and returned no replacement, so «حفظتها — متابعة»
          pushed to `/` and the middleware sent it straight back to `/enrol-2fa`.

          `enable` now returns a `session` minted after that revocation, with claims rebuilt from
          the row it just wrote, and the BFF route writes it to the cookie. So the reader who just
          enrolled simply carries on — which is what the next line checks, by going somewhere and
          expecting to arrive.
        */
      } else {
        /* Every run after: enrolled already, so the second step asks for a code. */
        await submitCode(page);
      }

      /*
        LANDED on the section the role opens. `booking.read_all` is absent, so `/` redirects rather
        than rendering an overview of a business this reader cannot see.
      */
      await page.waitForURL(/\/audit/, { timeout: 20_000 });

      /*
        The nav, asserted on `aside nav` and never on page text. A section label appears in
        headings, breadcrumbs and table captions — three assertions in this suite were already
        vacuous that way, matching «كل المدن» in a radio beneath the row they claimed to check.
      */
      const nav = page.locator('aside nav');

      await expect(nav).toContainText(t.nav.audit);

      for (const absent of [
        t.nav.bookings,
        t.nav.partners,
        t.nav.staff,
        t.nav.settings,
      ]) {
        await expect(nav).not.toContainText(absent);
      }

      /*
        The SENTENCE, not merely the absence of the section. «انتهت الجلسة» and «دورك الحالي لا
        يشمل هذا القسم» both mean "you did not get the page", and only one is correct — an assertion
        that cannot tell them apart passes against the very bug this work fixes.
      */
      await page.goto('/bookings');
      await expect(page.locator('main')).toContainText(t.sections.gate.role);
      await expect(page.locator('main')).not.toContainText(t.dashboard.sessionExpired);

      /* And a section NO named role may carry gets the OTHER sentence, because asking cannot help. */
      await page.goto('/staff-roles');
      await expect(page.locator('main')).toContainText(t.sections.gate.closed);
      await expect(page.locator('main')).not.toContainText(t.sections.gate.role);
    });
  });

  /**
   * THE CONTROL, and the reason everything above means anything.
   *
   * A gate that refuses everybody satisfies every refusal assertion perfectly. This proves the
   * super admin still opens the very section the narrow reader was refused.
   */
  test.describe('the control', () => {
    test.use({ storageState: STAFF_STATE });

    test('still lets a super admin open the section the narrow role was refused', async ({
      page,
    }) => {
      await page.goto('/bookings');

      await expect(page.locator('main')).not.toContainText(t.sections.gate.role);
      await expect(page.locator('main')).not.toContainText(t.dashboard.sessionExpired);
      await expect(page.getByRole('heading').first()).toBeVisible();
    });
  });
});
