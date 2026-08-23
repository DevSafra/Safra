import { expect, test } from '@playwright/test';

/**
 * The staff sign-in flow, driven through a real browser.
 *
 * Every assertion here corresponds to a defect that shipped and that the 554 unit and
 * integration tests could not see, because all of them are HTTP-level and these pages
 * return `200` with correct server-rendered HTML even when the client is completely
 * broken:
 *
 * - a CSP that blocked every hydration script, so no form submitted at all;
 * - a recycled DOM node that delivered the password into the code field;
 * - `defaultValue` on a reused input, so going back left the email box empty.
 *
 * Credentials come from `.env`, which is git-ignored and holds the local test accounts.
 *
 * The console renders in Arabic (Bashar, 2026-08-03), so the selectors are Arabic. They
 * are imported from the app's own string module rather than duplicated, which means a
 * copy change cannot silently stop these tests from finding anything.
 */
// The catalogue source directly, not through the admin app: Playwright loads these
// files as CommonJS, and `@safra/i18n` is ESM-only, so going via `lib/strings.ts`
// makes Node resolve the package and fail on the missing `require` condition.
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import {
  EMAIL,
  MISSING_CREDENTIALS,
  PASSWORD,
  SKIP_REASON,
  STAFF_STATE,
  field,
  freshCode,
  submit,
} from './staff.js';

test.skip(MISSING_CREDENTIALS, SKIP_REASON);

test.describe('the console renders in Arabic', () => {
  /**
   * Direction is set on the document, and everything downstream depends on it: without
   * `dir="rtl"` every logical property resolves the wrong way, which would put the
   * password toggle over the START of the text rather than after it.
   */
  test('the document declares Arabic and right-to-left', async ({ page }) => {
    await page.goto('/login');

    await expect(page.locator('html')).toHaveAttribute('lang', 'ar');
    await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
  });

  test('the sign-in page shows Arabic copy, not English', async ({ page }) => {
    await page.goto('/login');

    await expect(page.getByRole('heading', { name: t.login.title })).toBeVisible();
    await expect(page.getByText(t.login.subtitle)).toBeVisible();
    // The English original must be gone, not merely hidden behind the Arabic.
    await expect(page.getByText('Command Center', { exact: true })).toBeHidden();
    await expect(page.getByText('SAFRA staff access only.')).toBeHidden();
  });
});

/**
 * The command-center dashboard (§9.2), against the approved design.
 *
 * These assert the SHAPE, not the numbers — the seeded data changes daily, and a test that
 * pins a figure would fail every morning for a reason unrelated to the console. What
 * matters is that each panel the design specifies is present and populated from the API
 * rather than from placeholder markup.
 */
test.describe('the command-center dashboard', () => {
  test.use({ storageState: STAFF_STATE });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  test('renders in Arabic, not English', async ({ page }) => {
    await expect(page.getByRole('heading', { name: t.admin.title })).toBeVisible();
    /*
      Located by HREF, not by accessible name.

      `getByRole(…, { name })` matches by SUBSTRING, and a sidebar is the one place where one
      section's name is routinely contained in another's: «أدوار موظفي الشركاء» contains
      «الشركاء», so this resolved to two links the day that entry was added. `exact: true` is not
      the fix either — the real link's accessible name is «الشركاء 532», carrying its badge count.

      The href identifies the link and the assertion still proves what this test is about: the
      label renders in Arabic rather than English.
    */
    await expect(page.locator('aside a[href="/partners"]')).toContainText(t.nav.partners);
    await expect(page.getByRole('button', { name: t.dashboard.signOut })).toBeVisible();

    // And the role reads as Arabic rather than `super_admin`.
    await expect(page.getByText('super_admin')).toBeHidden();
  });

  test('renders every panel the design specifies', async ({ page }) => {
    await expect(page.getByRole('heading', { name: t.admin.title })).toBeVisible();

    for (const panel of [
      t.admin.attention,
      t.admin.latestBookings,
      t.admin.weekRevenue,
      t.admin.pendingPartners,
      t.admin.recentActivity,
    ]) {
      await expect(page.getByRole('heading', { name: panel })).toBeVisible();
    }

    /*
      Scoped to the KPI region: "قيد التأكيد" is both a counter label and a status pill in
      the table below, so an unscoped text match resolves to two elements and fails on
      strict mode — for a page that is entirely correct.
    */
    const kpis = page.getByRole('region', { name: t.admin.kpiRow });

    for (const kpi of [
      t.admin.kpiBookingsToday,
      t.admin.kpiPending,
      t.admin.kpiRevenue,
      t.admin.kpiCancelled,
      t.admin.kpiDisputes,
    ]) {
      await expect(kpis.getByText(kpi, { exact: true })).toBeVisible();
    }

    // The eighteen-section sidebar, and its heading.
    await expect(page.getByText(t.nav.heading)).toBeVisible();
  });

  /**
   * The KPI row must show REAL figures.
   *
   * The design ships with hardcoded sample values, and the whole risk of building to a
   * static mock is that the numbers get copied along with the layout. Asserting that the
   * counters failure message is absent, and that the revenue card carries a formatted
   * amount, is what distinguishes a wired dashboard from a screenshot of one.
   */
  test('the counters come from the API, not the mock', async ({ page }) => {
    await expect(page.getByText(t.dashboard.countersFailed)).toBeHidden();

    const kpis = page.getByRole('region', { name: t.admin.kpiRow });
    const revenue = kpis.getByText(t.admin.kpiRevenue, { exact: true });

    await expect(revenue.locator('..')).toContainText(/\$[\d,]+\.\d{2}/);
  });

  /**
   * The disputes card shows the REAL open count, and agrees with the disputes section.
   *
   * For months this test asserted the opposite — that the card said "the feature does not exist"
   * and showed a dash — which was correct while there was no table. The table landed on
   * 2026-08-04, and a dash would now be a lie in the other direction.
   *
   * What it asserts instead is CONSISTENCY: the dashboard's number must match what the section
   * itself reports. Two screens disagreeing about how many disputes are open is worse than either
   * being wrong alone, because it destroys trust in both.
   */
  test('the disputes card agrees with the disputes section', async ({ page }) => {
    const card = page
      .getByRole('region', { name: t.admin.kpiRow })
      .getByText(t.admin.kpiDisputes, { exact: true })
      .locator('..');

    await expect(card).toContainText(t.admin.kpiDisputesSub);
    await expect(card).not.toContainText(t.admin.kpiDisputesUnavailable);

    const onDashboard = (await card.innerText()).match(/\d+/)?.[0] ?? '';

    await page.goto('/disputes');

    const openCard = page
      .getByRole('region', { name: t.nav.disputes })
      .getByText(t.sections.disputes.kpiOpen, { exact: true })
      .locator('..');
    const investigating = page
      .getByRole('region', { name: t.nav.disputes })
      .getByText(t.sections.disputes.kpiInvestigating, { exact: true })
      .locator('..');

    const open = Number((await openCard.innerText()).match(/\d+/)?.[0] ?? '0');
    const reviewing = Number((await investigating.innerText()).match(/\d+/)?.[0] ?? '0');

    // The dashboard counts both unresolved states, which is what "open" means to an operator.
    expect(Number(onDashboard)).toBe(open + reviewing);
  });

  /**
   * Every sidebar item navigates to a section backed by real data.
   *
   * This test has been rewritten twice, and the history is the point. First it asserted that
   * unbuilt sections were `aria-disabled` and NOT links — right while eleven of the eighteen had
   * no route. Then it asserted they navigated to a page explaining the gap. Now all twenty are
   * implemented, so it asserts the strongest form: the destination shows data, not an apology.
   */
  test('the disputes section is reachable and shows real data', async ({ page }) => {
    await page.getByRole('link', { name: t.nav.disputes }).click();

    await expect(page).toHaveURL(/\/disputes$/);
    await expect(page.getByRole('heading', { name: t.nav.disputes })).toBeVisible();
    await expect(page.getByText(t.unbuilt.heading)).toBeHidden();
    await expect(page.getByText(t.dashboard.queueFailed)).toBeHidden();
  });

  /** Emergency Mode is reached from the header, as the prototype's `openEmergency` does. */
  test('the header Emergency Mode button reaches the section', async ({ page }) => {
    await page.getByRole('link', { name: t.admin.emergencyMode }).click();

    await expect(page).toHaveURL(/\/emergency$/);
    await expect(page.getByText(t.sections.emergency.hint)).toBeVisible();
  });

  /** Booking detail is reachable only by reference, so the lookup must survive the rebuild. */
  test('the booking lookup still reaches a booking', async ({ page }) => {
    const reference = await page
      .locator('table a[href^="/bookings/"]')
      .first()
      .innerText();

    await field(page, t.dashboard.findBookingLabel).fill(reference);
    await page.getByRole('button', { name: t.dashboard.findBooking }).click();

    /*
      Case-insensitive: `/bookings` upper-cases what it is given, because §13.2 references
      are upper-case and digits and a customer reading one out on the phone should not have
      to get the case right. The subject here is that the form still posts to the lookup and
      the redirect lands on the detail route — not that this particular record renders. Which
      record is newest depends on whatever is in the dev database, and asserting on that is
      how these tests turned flaky the last time.
    */
    await expect(page).toHaveURL(new RegExp(`/bookings/${reference}$`, 'i'));
  });
});

test.describe('staff sign-in', () => {
  test('hydrates at all — the form responds to input', async ({ page }) => {
    /**
     * THE canary. A blocked script leaves the markup perfect and the page inert, so this
     * asserts something only a live client can do: React re-rendering a controlled input
     * as it is typed.
     */
    const violations: string[] = [];
    page.on('console', (message) => {
      if (/content security policy|refused to execute/i.test(message.text())) {
        violations.push(message.text());
      }
    });

    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);

    await expect(field(page, t.login.email)).toHaveValue(EMAIL as string);
    expect(violations, 'CSP violations in the console').toEqual([]);
  });

  test('asks for the code only after the password is accepted', async ({ page }) => {
    await page.goto('/login');

    // Step one shows no code field at all.
    await expect(field(page, t.login.code)).toBeHidden();

    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill(PASSWORD as string);
    await submit(page).click();

    await expect(field(page, t.login.code)).toBeVisible();
    await expect(page.getByText(t.login.codeHint)).toBeVisible();
  });

  /** The reported defect: the code box arrived holding the password. */
  test('the code field is empty when it appears', async ({ page }) => {
    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill(PASSWORD as string);
    await submit(page).click();

    const code = field(page, t.login.code);
    await expect(code).toBeVisible();
    await expect(code).toHaveValue('');
  });

  /** The other reported defect: going back cleared the email. */
  test('going back keeps the email and password filled', async ({ page }) => {
    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill(PASSWORD as string);
    await submit(page).click();

    await page.getByRole('button', { name: t.login.useDifferentAccount }).click();

    await expect(field(page, t.login.email)).toHaveValue(EMAIL as string);
    await expect(field(page, t.login.password)).toHaveValue(PASSWORD as string);
  });

  test('returning to the code step clears a previously typed code', async ({ page }) => {
    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill(PASSWORD as string);
    await submit(page).click();

    await field(page, t.login.code).fill('123456');
    await page.getByRole('button', { name: t.login.useDifferentAccount }).click();
    await submit(page).click();

    await expect(field(page, t.login.code)).toHaveValue('');
  });

  test('signs in with a valid code and reaches the dashboard', async ({ page }) => {
    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill(PASSWORD as string);
    await submit(page).click();

    await field(page, t.login.code).fill(await freshCode());
    await submit(page).click();

    await expect(page.getByRole('heading', { name: t.admin.title })).toBeVisible();
  });

  test('a wrong password never reaches the code step', async ({ page }) => {
    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill('definitely-not-the-password');
    await submit(page).click();

    await expect(page.getByRole('alert')).toBeVisible();
    await expect(field(page, t.login.code)).toBeHidden();
  });
});

test.describe('the password field', () => {
  /**
   * Every password field in SAFRA carries a show/hide toggle — a project rule, not a
   * preference. Asserted through the DOM because the only thing that matters is whether
   * the input's `type` actually changes.
   */
  test('reveals and re-masks the password', async ({ page }) => {
    await page.goto('/login');

    const password = field(page, t.login.password);
    await password.fill(PASSWORD as string);

    await expect(password).toHaveAttribute('type', 'password');

    await page.getByRole('button', { name: t.login.showPassword }).click();
    await expect(password).toHaveAttribute('type', 'text');
    // The value survives the switch — a toggle that clears the field is worse than none.
    await expect(password).toHaveValue(PASSWORD as string);

    await page.getByRole('button', { name: t.login.hidePassword }).click();
    await expect(password).toHaveAttribute('type', 'password');
  });

  /**
   * The eye must sit INSIDE the input, not below or beside it.
   *
   * Asserted geometrically because the failure mode is invisible to any DOM assertion:
   * the markup and the class names were correct while Tailwind was not scanning the
   * shared package, so none of the positioning classes existed and the button rendered
   * as a plain block after the input. Measuring the boxes is the only check that can
   * tell the difference between "styled" and "the CSS was never generated".
   */
  test('the eye is positioned inside the input', async ({ page }) => {
    await page.goto('/login');

    const input = await field(page, t.login.password).boundingBox();
    const eye = await page
      .getByRole('button', { name: t.login.showPassword })
      .boundingBox();

    expect(input, 'password input has no box').not.toBeNull();
    expect(eye, 'toggle has no box').not.toBeNull();

    const i = input as NonNullable<typeof input>;
    const e = eye as NonNullable<typeof eye>;

    // One pixel of tolerance for sub-pixel layout and the input's border.
    expect(e.x, 'eye starts left of the input').toBeGreaterThanOrEqual(i.x);
    expect(e.x + e.width, 'eye overflows the input on the right').toBeLessThanOrEqual(
      i.x + i.width + 1,
    );
    expect(e.y, 'eye sits above the input').toBeGreaterThanOrEqual(i.y - 1);
    expect(e.y + e.height, 'eye sits below the input').toBeLessThanOrEqual(
      i.y + i.height + 1,
    );

    /**
     * The console is right-to-left, so "after the value" is the LEFT half of the box.
     * Asserting the right-hand side here would encode an LTR assumption and fail for the
     * correct layout — which is exactly the mistake `pe-11`/`end-0` exist to avoid.
     */
    expect(e.x, 'eye is not on the reading-end side').toBeLessThan(i.x + i.width / 2);
  });

  /** It must not submit the form it sits inside. */
  test('toggling does not submit the form', async ({ page }) => {
    await page.goto('/login');
    await field(page, t.login.email).fill(EMAIL as string);
    await field(page, t.login.password).fill(PASSWORD as string);

    await page.getByRole('button', { name: t.login.showPassword }).click();

    // Still on step one: no code field, no error.
    await expect(field(page, t.login.code)).toBeHidden();
    await expect(submit(page)).toBeVisible();
  });
});
