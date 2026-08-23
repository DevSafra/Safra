import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { fill } from '../packages/i18n/src/fill.js';

import { PARTNER_BASE, PARTNER_STATE, signInCodeFor } from './partner-session.js';

/**
 * الموظفون, walked end to end — invite, mail, activation, sign-in, and what an employee then sees.
 *
 * ## Why this walk and not four smaller specs
 *
 * Every fix the employees feature needed today lived at a SEAM, and each one was invisible from
 * either side of it:
 *
 *  - the activation page existed and the middleware bounced it to a sign-in that refuses the account
 *  - activation succeeded into an account with no permissions, then into one with a withdrawn role
 *  - the account could be activated and then could not sign in at all, three gates hard-coded to
 *    `=== 'partner'`
 *  - six owner-only routes were reachable because the boundary was a comment
 *  - the landing page told a receptionist what the business earns
 *
 * The suite was green through all five, because each side was tested alone. Only walking the whole
 * path crosses the seams, so this is one test that goes from an empty form to a signed-in employee
 * looking at a dashboard with no money on it.
 *
 * ## The employee is created fresh every run
 *
 * A unique address, because an account can hold one live employment and a re-run would otherwise
 * be refused with `employee.already_employed` — correctly. The rows accumulate, which is `O-e2e-3`;
 * the alternative is a spec that deletes its own evidence.
 */
const OWNER_STATE = PARTNER_STATE;
const MAILPIT = process.env['MAILPIT_URL'] ?? 'http://localhost:8025';
/**
 * The password this spec SETS, and it is deliberately not `TESTBED_PASSWORD`.
 *
 * The seeded accounts' password — `a-testbed-password-1` — has no uppercase letter, so it does not
 * satisfy `passwordSchema` and the activation form refuses it with «كلمة المرور لا تحقّق الشروط».
 * That is not a defect in either: the fixtures are seeded as HASHES, so they never pass through the
 * policy, while this account is created by a person filling in a form and must.
 *
 * Any future spec that SETS a password rather than typing an existing one needs its own compliant
 * value for the same reason.
 */
const EMPLOYEE_PASSWORD = 'Employee-Testbed-1!';

/**
 * The activation link SAFRA emailed to an invited employee.
 *
 * Matched on the URL in the body rather than on the subject, for the reason `signInCodeFor` gives:
 * a subject is localised and a helper must not break the day somebody rewords it. Polls, because
 * the mail goes out through the queue.
 */
async function activationLinkFor(
  request: APIRequestContext,
  address: string,
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

      const found = /https?:\/\/\S*\/employee-invitation\/([A-Za-z0-9_-]+)/.exec(
        body.Text ?? '',
      );

      if (found?.[0]) return found[0];
    }

    await new Promise((resolve) => setTimeout(resolve, 400));
  }

  throw new Error(
    `No employee invitation arrived for ${address} after ${since.toISOString()}. ` +
      'Is the BullMQ worker running? The mail goes out through the queue.',
  );
}

/**
 * The payout line's opening words, taken from the catalogue rather than typed here.
 *
 * `payoutScheduled` is a template — «تحويل مستحقات {amount} مجدول يوم {date}» — so asserting the
 * whole string finds nothing whatever the screen says, and the test passes while proving nothing.
 * The text before the first placeholder is the stable part, and deriving it keeps the assertion
 * true when somebody rewords the sentence.
 */
function payoutPrefix(): string {
  return t.dashboard.payoutScheduled.split('{')[0]?.trim() ?? '';
}

/**
 * Makes sure this partner has at least one role, and returns nothing.
 *
 * ## Why the tests cannot assume one exists
 *
 * Roles became the PARTNER's on 2026-08-23 and migration 0042 emptied both tables — no backfill was
 * possible, because inventing an owner for a role means guessing which business it belongs to. So
 * the fixture partner starts with none, and the invite form correctly refuses to offer an empty
 * picker: «لا يمكنك دعوة موظّف قبل تعريف دور واحد على الأقل».
 *
 * That is the screen working. A test that assumed otherwise was asserting yesterday's data.
 *
 * ## It reuses rather than creating one per run
 *
 * The first run creates a role; every run after finds it and creates nothing. A helper that made a
 * fresh one each time would grow the list forever (`O-e2e-3`) — and unlike a dispute, a role that
 * somebody holds cannot be tidied away afterwards, because the API refuses to delete a held one.
 */
async function ensureRole(page: Page): Promise<void> {
  await page.goto('/employee-roles');

  if ((await page.locator('#employee-roles-list li').count()) > 0) return;

  await page.getByLabel(t.employeeRoles.nameLabel).fill('فريق الاختبار');
  await page
    .getByLabel(t.employeeRoles.capability['booking.read_own'] ?? 'booking.read_own')
    .check();
  await page.getByRole('button', { name: t.employeeRoles.create }).click();

  await expect(page.locator('#employee-roles-list li')).not.toHaveCount(0, {
    timeout: 15_000,
  });
}

test.use({ baseURL: PARTNER_BASE });

test.describe('الموظفون', () => {
  test.describe('as the account owner', () => {
    test.use({ storageState: OWNER_STATE });

    test('invites somebody, and the row says they have not signed in yet', async ({
      page,
      request,
    }) => {
      const address = `e2e-emp-${Date.now()}@safra.test`;
      const since = new Date();

      await ensureRole(page);
      await page.goto('/employees');

      /* The screen renders at all — the assertion both of today's 500s would have failed. */
      await expect(
        page.getByRole('heading', { name: t.employees.inviteTitle }),
      ).toBeVisible();

      await page.getByLabel(t.employees.fullName).fill('رنا الاستقبال');
      await page.getByLabel(t.employees.email).fill(address);

      /*
        The first REAL role, not the placeholder. By INDEX rather than by label, because the names
        are the partner's own — `ensureRole` creates one only when the account has none, so which
        name is there depends on what earlier runs left behind and is not this spec's to know.
      */
      await page.getByLabel(t.employees.role).selectOption({ index: 1 });
      await page.getByRole('button', { name: t.employees.inviteSubmit }).click();

      await expect(page.getByText(t.employees.inviteSent)).toBeVisible({
        timeout: 15_000,
      });

      /*
        TWO facts, not one. «لم يفعّل حسابه بعد» would be true of an expired invitation too, and
        the reader's action differs — wait, versus invite again. Collapsing them is the mistake the
        in-person onboarding screen made when it showed five green steps to somebody locked out.
      */
      const row = page.locator('li').filter({ hasText: address });

      await expect(row).toContainText(t.employees.invitationPending);
      await expect(row).not.toContainText(t.employees.statusSuspended);

      /* And the invitation genuinely went out — the row means nothing if no mail followed it. */
      const link = await activationLinkFor(request, address, since);

      expect(link).toContain('/employee-invitation/');
    });
  });

  /**
   * The other half: a person who has been invited, activating and then signing in.
   *
   * A fresh context with NO storage state — the owner's session must play no part, and an employee
   * who inherited one would prove nothing about their own admission.
   */
  test.describe('as the invited employee', () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test('activates, signs in, and sees a dashboard with no money on it', async ({
      page,
      request,
      browser,
    }) => {
      const address = `e2e-emp-${Date.now()}-b@safra.test`;
      const invitedAt = new Date();

      /* The invitation has to be issued by the OWNER, so that half runs in its own context. */
      const ownerContext = await browser.newContext({
        storageState: OWNER_STATE,
        baseURL: PARTNER_BASE,
      });
      const ownerPage = await ownerContext.newPage();

      await ensureRole(ownerPage);
      await ownerPage.goto('/employees');

      await ownerPage.getByLabel(t.employees.fullName).fill('سامر الاستقبال');
      await ownerPage.getByLabel(t.employees.email).fill(address);
      await ownerPage.getByLabel(t.employees.role).selectOption({ index: 1 });
      await ownerPage.getByRole('button', { name: t.employees.inviteSubmit }).click();
      await expect(ownerPage.getByText(t.employees.inviteSent)).toBeVisible({
        timeout: 15_000,
      });
      await ownerContext.close();

      // ── Activation ──────────────────────────────────────────────────────────
      const link = await activationLinkFor(request, address, invitedAt);

      await page.goto(link);

      /*
        Reachable WITHOUT a session. The middleware bounced this to `/login` until
        `/employee-invitation` joined `PUBLIC_PATHS` — and a sign-in refuses the account, because
        it is still a customer until this form is submitted. That is the 2026-08-20 dead end, one
        role down, and this is the assertion that catches it coming back.
      */
      await expect(
        page.getByRole('heading', { name: t.employeeInvitation.title }),
      ).toBeVisible();

      /*
        `exact`, because «تأكيد كلمة المرور» CONTAINS «كلمة المرور» and `getByLabel` matches a
        substring by default — without it the password locator resolves to both fields and both eye
        toggles. The same ambiguity that broke three admin specs when a nav item gained a label
        containing another section's name.
      */
      await page
        .getByLabel(t.employeeInvitation.password, { exact: true })
        .fill(EMPLOYEE_PASSWORD);
      await page
        .getByLabel(t.employeeInvitation.confirm, { exact: true })
        .fill(EMPLOYEE_PASSWORD);
      await page.getByRole('button', { name: t.employeeInvitation.submit }).click();

      await expect(page.getByText(t.employeeInvitation.done)).toBeVisible({
        timeout: 20_000,
      });

      // ── Sign-in, with the second factor Bashar asked for on 2026-08-23 ──────
      const signedInAt = new Date();

      await page.goto('/login');
      await page.getByLabel(t.login.email).fill(address);
      await page.getByLabel(t.login.password, { exact: true }).fill(EMPLOYEE_PASSWORD);
      await page.getByRole('button', { name: t.login.submit }).click();

      /*
        An employee proves a second factor exactly as a partner does — `TWO_FACTOR_ROLES` spreads
        `PARTNER_APP_ROLES`, so a role admitted to the portal cannot be admitted without one. If
        this step is ever skipped, that spread has been unpicked.
      */
      await page
        .getByLabel(t.login.codeTitleEmail)
        .fill(await signInCodeFor(request, address, signedInAt));
      await page.getByRole('button', { name: t.login.codeSubmit }).click();

      await page.waitForURL(`${PARTNER_BASE}/`, { timeout: 20_000 });

      // ── What they may see ───────────────────────────────────────────────────

      /*
        No money. `kpis.earnings` and the payout line are both withheld from a caller without
        `PAYOUT_READ_OWN`, which is precisely what `PARTNER_EMPLOYEE_PERMISSIONS` says it withholds
        — "a receptionist should not learn what the business earns".
      */
      await expect(page.locator('body')).not.toContainText(payoutPrefix(), {
        timeout: 10_000,
      });

      /*
        And no الموظفون in the sidebar: `PARTNER_EMPLOYEE_MANAGE` is the owner's, so a hidden
        control and a refused request agree. A receptionist who could hire could promote themselves.
      */
      await expect(page.locator('nav')).not.toContainText(t.nav.employees);

      /* Reached DIRECTLY, the owner-only screens say so rather than «انتهت الجلسة». */
      await page.goto('/payouts');
      await expect(page.getByText(t.employees.ownerOnly)).toBeVisible();

      await page.goto('/employees');
      await expect(page.getByText(t.employees.ownerOnly)).toBeVisible();
    });
  });

  /**
   * The controls that CHANGE somebody, driven through the browser — `O-emp-2`.
   *
   * ## Why these three needed their own test
   *
   * `partner-employees.integration.test.ts` already proves the behaviour against a real database:
   * suspending revokes every session, removing ends the employment and puts `users.role` back to
   * `customer`, and neither can touch another partner's employee. What that cannot see is whether
   * the CONTROLS are wired to any of it — a button posting the wrong body, a `PATCH` that never
   * fires, a confirmation that swallows the click. That is the class this feature produced seven
   * times in one day, every one at a seam between two halves that were each correct alone.
   *
   * ## One employee, three transitions, in order
   *
   * They run as a sequence inside one test rather than as three, because each needs the previous
   * state and a fresh invitation per case would leave three employments behind instead of one
   * (`O-e2e-3`). The order is the real one: suspend, restore, remove.
   */
  test.describe('the controls that change somebody', () => {
    test.use({ storageState: OWNER_STATE });

    test('suspends, restores and removes, and the row follows each one', async ({
      page,
    }) => {
      const address = `e2e-emp-${Date.now()}-c@safra.test`;

      await ensureRole(page);
      await page.goto('/employees');

      await page.getByLabel(t.employees.fullName).fill('ليلى الاستقبال');
      await page.getByLabel(t.employees.email).fill(address);
      await page.getByLabel(t.employees.role).selectOption({ index: 1 });
      await page.getByRole('button', { name: t.employees.inviteSubmit }).click();
      await expect(page.getByText(t.employees.inviteSent)).toBeVisible({
        timeout: 15_000,
      });

      const row = page.locator('li').filter({ hasText: address });

      await expect(row).toContainText(t.employees.statusActive);

      // ── Suspend ─────────────────────────────────────────────────────────────
      /*
        By its ACCESSIBLE NAME, which carries the person's name. A list of employees offers one
        «إيقاف» per row and they are indistinguishable to a screen reader without it — so asserting
        through the named label proves the accessibility affordance as well as the transition.
      */
      await row
        .getByRole('button', {
          name: fill(t.employees.suspendLabel, { name: 'ليلى الاستقبال' }),
        })
        .click();

      await expect(row).toContainText(t.employees.statusSuspended, { timeout: 15_000 });

      // ── Restore ─────────────────────────────────────────────────────────────
      await row
        .getByRole('button', {
          name: fill(t.employees.restoreLabel, { name: 'ليلى الاستقبال' }),
        })
        .click();

      await expect(row).toContainText(t.employees.statusActive, { timeout: 15_000 });

      // ── Remove, which asks first ────────────────────────────────────────────
      /*
        Removing is the one that cannot be undone, so the browser's own dialogue stands in front of
        it. Accepting it here proves the confirmation is wired to the request rather than merely
        rendered — a dialogue nobody handles blocks the click and the row would simply stay.
      */
      page.once('dialog', (dialog) => void dialog.accept());

      await row
        .getByRole('button', {
          name: fill(t.employees.removeLabel, { name: 'ليلى الاستقبال' }),
        })
        .click();

      await expect(page.locator('li').filter({ hasText: address })).toHaveCount(0, {
        timeout: 15_000,
      });
    });

    /**
     * «عرض المزيد» pages, and the second page is not the first one again.
     *
     * The control is a plain link carrying a cursor, so this needs no JavaScript to work — but a
     * cursor that does not ADVANCE looks identical to one that does until you compare the rows.
     * That is exactly how `O-e2e-2` hid for a week, so the assertion is that the two pages share
     * no row rather than that a second page rendered.
     */
    test('pages to a second page that is not the first one again', async ({ page }) => {
      await page.goto('/employees');

      const more = page.getByRole('link', { name: t.employees.loadMore });

      test.skip(
        (await more.count()) === 0,
        'Fewer than one page of employees; nothing to page through.',
      );

      const firstPage = await page.locator('#employees-list li').allTextContents();

      await more.click();
      await page.waitForURL(/cursor=/);

      const secondPage = await page.locator('#employees-list li').allTextContents();

      expect(secondPage.length).toBeGreaterThan(0);
      expect(secondPage).not.toStrictEqual(firstPage);
    });
  });

  /**
   * أدوار الموظفين — the FIRST-RUN journey, which is now define-a-role before invite-anybody.
   *
   * ## Why this is one test and not two
   *
   * The two halves only mean something together. A role created and never assigned proves a form
   * posts; an invite against a pre-existing role proves nothing about the screen that made it. The
   * defect this crosses is the one the rework created: roles are now the PARTNER's, so a partner
   * arriving with none cannot invite anybody, and the path out of that has to work end to end or
   * the feature has no first day.
   *
   * ## The role name is unique per run and per partner
   *
   * `(partner_id, lower(name))` is the index — two partners may both have «استقبال», one partner may
   * not have it twice. A fixed name would pass once and then collide with itself on every re-run,
   * which reads as a broken form rather than a spent fixture.
   */
  test.describe('defining a role and hiring against it', () => {
    test.use({ storageState: OWNER_STATE });

    test('creates a role, then invites somebody into it', async ({ page }) => {
      const roleName = `دور-${Date.now()}`;
      const address = `e2e-emp-${Date.now()}-d@safra.test`;

      await page.goto('/employee-roles');

      await expect(
        page.getByRole('heading', { name: t.employeeRoles.createTitle }),
      ).toBeVisible();

      await page.getByLabel(t.employeeRoles.nameLabel).fill(roleName);

      /*
        One real capability, chosen through its ARABIC label — which proves the label map resolves.
        A checkbox found by its permission string would pass while the screen showed
        `booking.read_own` to a human.
      */
      await page
        .getByLabel(t.employeeRoles.capability['booking.read_own'] ?? 'booking.read_own')
        .check();

      await page.getByRole('button', { name: t.employeeRoles.create }).click();

      const roleRow = page
        .locator('#employee-roles-list li')
        .filter({ hasText: roleName });

      await expect(roleRow).toBeVisible({ timeout: 15_000 });

      /* Nobody holds it yet, and the delete control is therefore offered. */
      await expect(roleRow).toContainText(t.employeeRoles.heldNobody);

      // ── And it can immediately be hired against ─────────────────────────────
      await page.goto('/employees');

      await page.getByLabel(t.employees.fullName).fill('نور الاستقبال');
      await page.getByLabel(t.employees.email).fill(address);
      await page.getByLabel(t.employees.role).selectOption({ label: roleName });
      await page.getByRole('button', { name: t.employees.inviteSubmit }).click();

      await expect(page.getByText(t.employees.inviteSent)).toBeVisible({
        timeout: 15_000,
      });

      /*
        Back on the roles screen the count has moved and the delete control is GONE, replaced by
        the sentence explaining why. That is the constraint being legible before the press rather
        than reported as a refusal after it.
      */
      await page.goto('/employee-roles');

      const heldRow = page
        .locator('#employee-roles-list li')
        .filter({ hasText: roleName });

      await expect(heldRow).toContainText(t.employeeRoles.inUse);
      await expect(
        heldRow.getByRole('button', {
          name: fill(t.employeeRoles.removeLabel, { name: roleName }),
        }),
      ).toHaveCount(0);
    });
  });
});
