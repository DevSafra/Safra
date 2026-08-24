import { expect, test, type Browser, type Page } from '@playwright/test';

import { ar as admin } from '../packages/i18n/src/messages/admin/ar.js';
import { errorMessage } from '../packages/i18n/src/errors.js';
import { ERROR } from '../packages/contracts/src/error-codes.js';
import { partnerAr as t } from '../packages/i18n/src/partner.js';
import { findReference } from './partner-fixtures.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';
import {
  PARTNER_BASE as BASE,
  PARTNER_EMAIL,
  PARTNER_PASSWORD,
  PARTNER_STATE,
  signInCodeFor,
} from './partner-session.js';

/**
 * What a SUSPENDED partner actually meets, in a browser.
 *
 * ## Why this spec exists
 *
 * The suspension policy (Bashar, 2026-08-24) was built across the API, the console and the portal,
 * and the console half was driven the same day. The PORTAL half never was — the notice, the refusal
 * on a write, the frozen transfers, the listings leaving search. `O-staff-4` recorded it as
 * compile-verified only, and a static read plus `refusal-coverage.test.ts` is what stood in for a
 * browser. Six defects in the enforcement work were found by USING a screen and none would have
 * failed a test, so "compile-verified" is not a state this feature is allowed to ship in.
 *
 * ## The fixture, and why it is the shared partner rather than a fresh one
 *
 * A dedicated suspended partner would be more isolated and was the first choice. It is not
 * possible without a seed change: the e2e layer reaches nothing but the browser and HTTP — no spec
 * touches the database — so a partner has to come from `seed-testbed.ts`, and re-running that seed
 * DELETES `partner_violations`, bookings, payouts and payments for every fixture partner. That
 * would destroy the waiver evidence `O-staff-4` cites as confirmed.
 *
 * A partner onboarded through the console instead — which the suite can do, `partner-onboarding`
 * does it every run — has no listings, no bookings and no payouts. Four of the seven things this
 * spec has to prove would be unprovable against it: there would be nothing to refuse an edit on,
 * nothing to remove from search, and no transfers to freeze. A fixture that cannot reach the field
 * it protects is worse than no fixture, because it reports coverage.
 *
 * So this suspends the partner whose session the suite already holds, and it owns the window:
 *
 * - `workers: 1` and `fullyParallel: false`, so no other spec runs inside the window;
 * - the suspension is lifted at the end AND unconditionally in `afterAll`, so a mid-spec failure
 *   does not leak a suspended partner into later specs or later runs;
 * - it lifts any suspension it finds BEFORE starting, so a previous crashed run self-heals rather
 *   than making every assertion here meaningless.
 *
 * Nothing is deleted and no audit evidence is touched: suspending and lifting ADD audit rows,
 * which is the correct record of what happened.
 *
 * ## It suspends the partner it is signed in as, and proves it
 *
 * The console registry deliberately does not search by email — the registry is meant to be safe to
 * leave open on a screen — so the partner is found by the display NAME the portal shows, and then
 * the email on the detail page is asserted against `PARTNER_EMAIL`. Without that assertion a
 * renamed or duplicated business would have this spec suspend the wrong one and pass.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

/* Long enough for a suspension to propagate through three apps, short enough to fail a hang. */
const WAIT = { timeout: 20_000 };

const enforcement = admin.sections.enforcement;
const REASON =
  'إيقاف اختباري آلي: التحقق من ظهور الإشعار ورفض الكتابة في لوحة الشريك ثم رفعه.';
const LIFT = 'رُفع الإيقاف الاختباري بعد انتهاء التحقق من سلوك الإيقاف في المتصفح.';

/** The refusal every blocked write must read as — resolved from the code, not written twice. */
const REFUSED = errorMessage(ERROR.PARTNER_SUSPENDED, 'ar');

/** The one listing that HAS an edit form: a published one is refused a form on its own merits. */
const DRAFT = 'qasr-al-sharq-lodge';
/** The seeded name every listing of this partner shares, for the search assertion. */
const LISTING_NAME = 'قصر الشرق';

/** The screen's own banner. Scoped to the `<p>` — Next renders an empty `role="alert"` announcer. */
const banner = (page: Page) => page.locator('p[role="alert"]');

/**
 * The customer search, with EXPLICIT dates.
 *
 * The default is today, and «حجوزات اليوم أُغلقت» closes same-day booking after the city's cutoff
 * hour — so a run after 17:00 Damascus time gets «لا نتائج» for every partner on the platform and
 * the listing assertion below would pass while proving nothing about suspension. Three days out is
 * clear of the cutoff whatever time the suite runs at.
 */
function searchUrl(): string {
  const day = (offset: number): string =>
    new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);

  return (
    'http://localhost:3000/ar/search?citySlug=damascus' +
    `&checkIn=${day(3)}&checkOut=${day(5)}&adults=2`
  );
}

/**
 * Lifts a suspension if there is one, and says whether it did.
 *
 * Used three times: to self-heal before the run, to lift at the end, and unconditionally in
 * `afterAll`. Idempotent by construction — it reads the banner first, because posting an unsuspend
 * to a partner who is not suspended is a 400 and would turn cleanup into a failure.
 */
async function lift(page: Page, reference: string): Promise<boolean> {
  await page.goto(`/partners/${reference}`);

  if ((await page.locator('[data-partner-suspended]').count()) === 0) return false;

  await page.getByLabel(enforcement.unsuspendReasonLabel).fill(LIFT);
  await page.getByRole('button', { name: enforcement.unsuspend }).click();
  await expect(page.getByText(enforcement.unsuspended)).toBeVisible(WAIT);
  await page.reload();
  await expect(page.locator('[data-partner-suspended]')).toHaveCount(0);

  return true;
}

/**
 * The console reference of the partner the suite is signed in as, proven by a listing it owns.
 *
 * ## Why not by email
 *
 * That was the first version and it failed for an instructive reason. The console's record shows
 * `partners.email` — the address on the APPLICATION — while the account that signs in is
 * `users.email`, and for the main fixture those diverged when the partner was handed a new address
 * on 2026-08-21: the record reads `partner1@safra.test` and the session belongs to
 * `partner1-legacy@safra.test`. The assertion was comparing the right partner against the wrong
 * field. (That divergence is a finding of its own — enforcement mail goes to `partners.email` — and
 * it is recorded in FUTURE-WORK rather than worked around here.)
 *
 * ## A property reference is exact
 *
 * `findReference` resolves the draft listing through the PARTNER's own session, so the reference
 * belongs to this partner by construction, and only the owning partner's record lists it. Names are
 * not identifiers — the search for «قصر الشرق» is a starting point, and every candidate is checked.
 */
async function resolveReference(
  browser: Browser,
): Promise<{ reference: string; draft: string }> {
  const partnerContext = await browser.newContext({ storageState: PARTNER_STATE });
  const portal = await partnerContext.newPage();

  await portal.goto(`${BASE}/`);

  const name = (await portal.locator('[data-partner-name]').first().innerText()).trim();
  const draft = await findReference(portal, DRAFT);

  await partnerContext.close();

  expect(name, 'The portal rendered no partner name to search the console by.').not.toBe(
    '',
  );
  expect(draft, 'Could not resolve the draft listing from the partner session.').not.toBe(
    '',
  );

  const staffContext = await browser.newContext({ storageState: STAFF_STATE });
  const console_ = await staffContext.newPage();

  await console_.goto(`/partners?q=${encodeURIComponent(name)}&size=25`);

  const hrefs = await console_
    .locator('a[href^="/partners/PAR-"]')
    .evaluateAll((links) =>
      links.map((a) => (a as HTMLAnchorElement).getAttribute('href')),
    );

  const candidates = [
    ...new Set(hrefs.map((href) => /PAR-\d+/.exec(href ?? '')?.[0]).filter(Boolean)),
  ] as string[];

  expect(candidates.length, `الشركاء found no partner named «${name}».`).toBeGreaterThan(
    0,
  );

  for (const candidate of candidates) {
    await console_.goto(`/partners/${candidate}`);

    if ((await console_.getByText(draft, { exact: false }).count()) > 0) {
      await staffContext.close();

      return { reference: candidate, draft };
    }
  }

  await staffContext.close();

  throw new Error(
    `None of ${candidates.join(', ')} lists ${draft}. Refusing to suspend a business ` +
      'that may not be the one this suite is signed in as.',
  );
}

test.describe('the suspension a partner meets', () => {
  let reference = '';
  let draft = '';

  test.beforeAll(async ({ browser }) => {
    ({ reference, draft } = await resolveReference(browser));

    /* Self-heal: a previous crashed run must not make every assertion below vacuous. */
    const staff = await browser.newContext({ storageState: STAFF_STATE });
    const page = await staff.newPage();

    if (await lift(page, reference)) {
      console.log(`lifted a leaked suspension on ${reference} before starting`);
    }

    await staff.close();
  });

  /*
    Unconditional, and it runs even when the test above fails.

    This is the line that makes suspending a SHARED fixture acceptable: the window cannot outlive
    the spec. Without it a timeout halfway through leaves the partner suspended, and every later
    spec that expects a trading business fails for a reason with no relationship to its own subject.
  */
  test.afterAll(async ({ browser }) => {
    const staff = await browser.newContext({ storageState: STAFF_STATE });
    const page = await staff.newPage();

    if (await lift(page, reference)) {
      console.log(`afterAll lifted the suspension on ${reference}`);
    }

    await staff.close();
  });

  test('signs in, reads why, is refused every write, and recovers when it is lifted', async ({
    browser,
  }) => {
    const staffContext = await browser.newContext({ storageState: STAFF_STATE });
    const staff = await staffContext.newPage();
    const partnerContext = await browser.newContext({ storageState: PARTNER_STATE });
    const portal = await partnerContext.newPage();
    const publicContext = await browser.newContext();
    const site = await publicContext.newPage();

    /* ── ⓪ Before: the listing is in search and the draft can be edited ───── */
    await site.goto(searchUrl());
    await expect(site.getByText(LISTING_NAME).first()).toBeVisible(WAIT);

    /* ── ① Suspend, from the console ──────────────────────────────────────── */
    await staff.goto(`/partners/${reference}`);
    await staff.getByLabel(enforcement.suspendReasonLabel).fill(REASON);
    await staff.getByRole('button', { name: enforcement.suspend }).click();
    await expect(staff.getByText(enforcement.suspended)).toBeVisible(WAIT);

    /* ── ② The notice, and the REASON, on the partner's own dashboard ──────── */
    await portal.goto(`${BASE}/`);

    const notice = portal.locator('[data-suspension-notice]');

    await expect(notice).toBeVisible(WAIT);
    await expect(notice).toContainText(t.suspension.title);
    /* The reason they opened the portal to find — the operator's words, not a generic line. */
    await expect(notice).toContainText(REASON);
    /*
      And the sentence the notice exists for, before the list of what stopped: their guests are
      safe. A notice that lists four blocked things first has already caused the panic it was
      written to prevent.
    */
    await expect(notice).toContainText(t.suspension.guestsSafe);

    /* ── ③ It is rendered by the SHELL, so no screen can omit it ───────────── */
    await portal.goto(`${BASE}/properties`);
    await expect(portal.locator('[data-suspension-notice]')).toBeVisible();
    await portal.goto(`${BASE}/violations`);
    await expect(portal.locator('[data-suspension-notice]')).toBeVisible();

    /*
      And المخالفات shows WORDS, not only a category and a number.

      Reported from the screen on 2026-08-24: the partner could read that they had been cited and
      never what for. The description was required by the console's form, labelled «يقرأه الشريك»,
      audited and stored nowhere. Asserted as "some violation on this page carries prose" rather
      than against a specific sentence, because which violations this fixture partner holds depends
      on what earlier specs raised — what must never happen again is a page of citations with no
      explanation anywhere on it.
    */
    const described = portal
      .locator('main li')
      .filter({ hasText: /[\u0600-\u06FF]{25,}/ });

    await expect(
      described.first(),
      'المخالفات shows no violation carrying a description — the partner cannot tell what they ' +
        'were cited for.',
    ).toBeVisible(WAIT);

    /* ── ④ A WRITE is refused, and it says the account is on hold ──────────── */
    await portal.goto(`${BASE}/properties/${draft}/edit`);

    const address = portal.getByLabel(t.editProperty.address);

    await expect(address).toBeVisible();

    const original = await address.inputValue();

    await address.fill(`${original} — تعديل اختباري`);
    await portal.getByRole('button', { name: t.editProperty.save }).click();

    /*
      The SUSPENSION sentence, not «تعذّر الحفظ».

      This is the assertion the whole refusal machinery exists for. `partnerFetch` maps the API's
      403 to 'unauthenticated', so a refusal that falls through renders «انتهت الجلسة» and sends
      somebody to sign in again over a state signing in cannot change. Nothing about that failure is
      visible to a type checker or to a passing API test.
    */
    await expect(banner(portal)).toContainText(REFUSED, WAIT);

    /* And it did NOT save — a refusal that stores the value is worse than one that does not. */
    await portal.reload();
    await expect(portal.getByLabel(t.editProperty.address)).toHaveValue(original);

    /* ── ⑤ المحفظة says the transfers are FROZEN, not missing ──────────────── */
    await portal.goto(`${BASE}/payouts`);
    await expect(portal.getByText(t.suspension.payoutsFrozen)).toBeVisible(WAIT);

    /* ── ⑥ The listings have left search — no new booking can be started ───── */
    await site.goto(searchUrl());
    /*
      Absent, while the page still shows OTHER results.

      Both halves matter: an empty results page would satisfy "the listing is gone" for the wrong
      reason — a broken search looks identical to a hidden listing. Damascus has five published
      listings and three are this partner's, so the other two are the control.
    */
    await expect(site.getByText(LISTING_NAME)).toHaveCount(0);
    await expect(site.locator('a[href*="/property/"]').first()).toBeVisible(WAIT);

    /* ── ⑦ A suspended partner can still SIGN IN, from a cold session ─────── */
    const coldContext = await browser.newContext();
    const cold = await coldContext.newPage();
    const since = new Date();

    await cold.goto(`${BASE}/login`);
    await cold.getByLabel(t.login.email).fill(PARTNER_EMAIL);
    await cold.getByLabel(t.login.password, { exact: true }).fill(PARTNER_PASSWORD);
    await cold.getByRole('button', { name: t.login.submit }).click();

    const code = await signInCodeFor(cold.request, PARTNER_EMAIL, since);

    /* `codeTitleEmail` and `codeSubmit` — step two words itself for the factor that was asked for. */
    await cold.getByLabel(t.login.codeTitleEmail).fill(code);
    await cold.getByRole('button', { name: t.login.codeSubmit }).click();

    /*
      Signing in is PERMITTED while suspended, and this is the half of the policy that is easiest to
      break by accident: suspension used to strip `partnerId` from the token, so the portal rendered
      as though the business did not exist and the one person who most needs to know why could not
      be told. A cold sign-in is the only way to see that — the stored session above was issued
      before the suspension.
    */
    await expect(cold.locator('[data-suspension-notice]')).toBeVisible(WAIT);
    await expect(cold.locator('[data-suspension-notice]')).toContainText(REASON);

    await coldContext.close();

    /* ── ⑧ Lift it, and everything comes back ─────────────────────────────── */
    expect(await lift(staff, reference)).toBe(true);

    await portal.goto(`${BASE}/`);
    await expect(portal.locator('[data-suspension-notice]')).toHaveCount(0);

    await portal.goto(`${BASE}/payouts`);
    await expect(portal.getByText(t.suspension.payoutsFrozen)).toHaveCount(0);

    /*
      Recovery is proven by the WRITE succeeding, not by the banner going away.

      The banner disappearing only says the profile read changed. The edit that was refused a moment
      ago is the thing the partner actually lost, so it is the thing that has to come back — and it
      is put straight back afterwards so the next run starts where this one did.
    */
    await portal.goto(`${BASE}/properties/${draft}/edit`);
    await portal.getByLabel(t.editProperty.address).fill(`${original} — تعديل اختباري`);
    await portal.getByRole('button', { name: t.editProperty.save }).click();
    await expect(banner(portal)).toContainText(t.editProperty.saved, WAIT);

    await portal.getByLabel(t.editProperty.address).fill(original);
    await portal.getByRole('button', { name: t.editProperty.save }).click();
    await expect(banner(portal)).toContainText(t.editProperty.saved, WAIT);
    await portal.reload();
    await expect(portal.getByLabel(t.editProperty.address)).toHaveValue(original);

    /* And the listings are discoverable again. */
    await site.goto(searchUrl());
    await expect(site.getByText(LISTING_NAME).first()).toBeVisible(WAIT);

    await staffContext.close();
    await partnerContext.close();
    await publicContext.close();
  });
});
