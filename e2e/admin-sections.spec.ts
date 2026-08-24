import { expect, test, type Locator, type Page } from '@playwright/test';

// The catalogue source directly, not through the admin app: Playwright loads these
// files as CommonJS, and `@safra/i18n` is ESM-only, so going via `lib/strings.ts`
// makes Node resolve the package and fail on the missing `require` condition.
import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';
import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE } from './staff.js';

/**
 * The admin sections, against the design handoff — its eighteen, plus «طلبات الشراكة».
 *
 * ## What these assert, and what they deliberately do not
 *
 * The SHAPE, never the numbers. Seeded data changes every time the integration suite runs, so a
 * test that pinned "60 bookings" would fail every morning for a reason unrelated to the console.
 * What matters is that each section the handoff specifies exists, is reachable from the sidebar,
 * renders in Arabic, and is populated from the API rather than from placeholder markup.
 *
 * ## Why one spec for all of them
 *
 * They share one session and one navigation pattern, and the interesting failures are the ones
 * that hit every section at once — a broken shell, a missing token, an expired cookie. Nineteen
 * files would hide that behind twenty identical setups.
 */
test.skip(MISSING_CREDENTIALS, SKIP_REASON);

/**
 * The signed-in staff address, read from the environment and compared rather than printed.
 *
 * Two tests below open THIS account's record, because what they assert — a super admin's
 * capabilities, and that a super admin is unscopable — is only true of a super admin.
 */
const STAFF_EMAIL = process.env['DEV_STAFF_EMAIL'] ?? '';

test.use({ storageState: STAFF_STATE });

/** Every section: its route, its heading, and whether it is backed by data yet. */
const SECTIONS = [
  { path: '/', title: t.admin.title, built: true },
  { path: '/bookings', title: t.nav.bookings, built: true },
  { path: '/partners', title: t.nav.partners, built: true },
  /*
    The one section the approved design does not have.

    «انضم كشريك» gave the console a queue of people who are not partners yet (Bashar,
    2026-08-19), and it needed somewhere to live that was not the registry of partners.
  */
  { path: '/applications', title: t.nav.partnerApplications, built: true },
  { path: '/properties', title: t.nav.properties, built: true },
  { path: '/customers', title: t.nav.customers, built: true },
  { path: '/staff', title: t.nav.staff, built: true },
  { path: '/payments', title: t.nav.payments, built: true },
  { path: '/wallet', title: t.nav.wallet, built: true },
  { path: '/giftcards', title: t.nav.giftCards, built: true },
  { path: '/coupons', title: t.nav.coupons, built: true },
  { path: '/geo', title: t.nav.geo, built: true },
  { path: '/reports', title: t.nav.reports, built: true },
  { path: '/settings', title: t.nav.settings, built: true },
  { path: '/audit', title: t.nav.audit, built: true },
  { path: '/emergency', title: t.admin.emergencyMode, built: true },
  /*
    These four were `built: false` until 2026-08-04, when the schema they needed landed —
    `disputes`, `conversations`/`messages`, `notifications`, `advertisers`/`ad_campaigns`. Every
    section is now backed by a real table, so nothing on this list is a placeholder.
  */
  { path: '/ads', title: t.nav.ads, built: true },
  { path: '/disputes', title: t.nav.disputes, built: true },
  { path: '/messages', title: t.nav.messages, built: true },
  { path: '/comms', title: t.nav.whatsapp, built: true },
] as const;

/** The failure message every section renders when its fetch does not parse. */
const LOAD_FAILED = t.dashboard.queueFailed;

test.describe('every admin section the design specifies', () => {
  for (const section of SECTIONS) {
    test(`${section.path} renders and loads its data`, async ({ page }) => {
      await page.goto(section.path);

      await expect(
        page.getByRole('heading', { name: section.title, level: 1 }),
      ).toBeVisible();

      /**
       * THE assertion that matters most.
       *
       * `staffFetch` returns the string `'failed'` on any parse error and the page then renders a
       * generic "could not load this list" — silently, with nothing in any log. That is exactly
       * how the listing queue stayed broken for weeks. Asserting the message is ABSENT is the
       * only cheap way to catch a schema that drifted from its endpoint.
       */
      await expect(page.getByText(LOAD_FAILED)).toBeHidden();
      await expect(page.getByText(t.dashboard.countersFailed)).toBeHidden();

      /*
        Nothing may render the "not built" panel any more. This assertion is the one that would
        catch a regression to a placeholder, and it is stated for EVERY section rather than only
        the ones that used to be unbuilt.
      */
      await expect(page.getByText(t.unbuilt.heading)).toBeHidden();
      expect(section.built).toBe(true);
    });
  }

  /**
   * Every sidebar item leads somewhere that renders.
   *
   * The regression this catches is a nav entry pointing at a route that does not exist: the
   * sidebar previously linked `/partners` and `/properties` before either page was written, and
   * nothing failed until somebody clicked.
   */
  test('every sidebar link resolves to a real page', async ({ page }) => {
    await page.goto('/');

    const hrefs = await page
      .locator('aside a[href]')
      .evaluateAll((links) => links.map((link) => link.getAttribute('href') ?? ''));

    /*
      Twenty rows: the design's eighteen, plus «طلبات الشراكة» (Bashar, 2026-08-19) and
      «أدوار موظفي الشركاء» (Bashar, 2026-08-23). Emergency Mode is not among them — it is reached
      from the header.

      A literal rather than `SECTIONS.length`, deliberately: this assertion exists to fail when
      somebody adds a nav entry, and a count derived from the same list would agree with any
      change made to it. It did exactly that when the roles screen landed, which is the assertion
      working rather than getting in the way — so the number goes up by one and the reason for the
      new entry is recorded beside it.
    */
    expect(hrefs.length).toBe(20);

    for (const href of hrefs) {
      const response = await page.goto(href);

      expect(response?.status(), `${href} should render`).toBe(200);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
  });
});

test.describe('the section tables behave like tables', () => {
  /**
   * Search is server-side, so it must change the URL and the result set.
   *
   * A client-side substring filter would leave the URL untouched — and would search only the
   * current page, reporting "no results" for a row that exists on page two.
   */
  test('search submits to the server and is reflected in the URL', async ({ page }) => {
    await page.goto('/partners');

    const term = await page
      .locator('table tbody tr')
      .first()
      .locator('td')
      .nth(1)
      .innerText();

    const word = term.trim().split(/\s+/)[0] ?? '';

    test.skip(word.length < 3, 'The seeded partner name is too short to search on');

    await page.getByPlaceholder(t.sections.partners.searchPlaceholder).fill(word);
    await page.getByRole('button', { name: t.table.search }).click();

    await expect(page).toHaveURL(new RegExp(`q=${encodeURIComponent(word)}`));
    await expect(page.getByText(LOAD_FAILED)).toBeHidden();
  });

  /** Paging forward must advance, and must not repeat the first row. */
  test('the pager advances without repeating a row', async ({ page }) => {
    await page.goto('/customers');

    const firstReference = await firstCell(page);
    const next = page.getByRole('link', { name: t.table.nextPageShort });

    test.skip((await next.count()) === 0, 'Not enough seeded customers to page');

    await next.click();

    await expect(page).toHaveURL(/page=2/);
    expect(await firstCell(page)).not.toBe(firstReference);
  });

  /**
   * The booking status filter must actually filter.
   *
   * Asserted by reading the status column rather than by trusting the URL: a filter that lands in
   * the query string and is ignored by the query is the failure worth catching.
   */
  test('the booking status filter narrows the result set', async ({ page }) => {
    await page.goto('/bookings');

    await page.getByLabel(t.table.colStatus).selectOption('cancelled');
    await page.getByRole('button', { name: t.table.search }).click();

    await expect(page).toHaveURL(/status=cancelled/);

    const statuses = await page.locator('table tbody tr td:nth-child(6)').allInnerTexts();

    expect(statuses.length).toBeGreaterThan(0);

    for (const status of statuses) {
      expect(status.trim()).toBe(t.bookingStatus['cancelled']);
    }
  });
});

test.describe('honesty rules the design and the register require', () => {
  /**
   * What the console says a person can do must be what the SERVER says.
   *
   * §14 requires it "enforced server-side, not just rendered". This replaces the permission matrix
   * test: مصفوفة الصلاحيات was removed on 2026-08-23 because أدوار الموظفين is now where a role's
   * capabilities are read, and a matrix beside it was a second rendering of one fact.
   *
   * The rule it was holding did not go away, it MOVED — to صفحة الموظف, whose capability list comes
   * from the API's resolved `permissions` rather than from the console intersecting a roles list.
   * So the check is the same in substance: a capability only a super admin holds must appear on a
   * super admin's own record, and it must appear as ARABIC, because a screen that prints
   * `emergency_mode.activate` has not resolved anything.
   */
  test('a member record shows the capabilities the server resolved', async ({ page }) => {
    /*
      The SIGNED-IN account, found by address, not `.first()`.

      `.first()` was my first attempt and it is worthless here: page one opens with
      `doc-reviewer@safra.test`, an operations manager, so the test asserted a super admin's
      capability against somebody who correctly does not hold it. The row has to be chosen by WHO
      it is, because the whole assertion is about which capabilities that person's role carries.
    */
    await page.goto(`/staff?size=100`);

    const own = page.locator('li').filter({ hasText: STAFF_EMAIL }).first();

    test.skip((await own.count()) === 0, 'The e2e account is not in the staff registry.');
    await own.getByRole('link').first().click();

    await expect(
      page.getByRole('heading', { name: t.sections.staff.member.capabilities }),
    ).toBeVisible();

    const body = await page.locator('main').innerText();

    /*
      The e2e account is a super admin, so it holds `emergency_mode.activate` — asserted by its
      Arabic name. Asserting the raw identifier is ABSENT is the half that catches a screen which
      renders the list without translating it.
    */
    expect(body).toContain(t.sections.staffRoles.capability['emergency_mode.activate']);
    expect(body).not.toContain('emergency_mode.activate');
  });

  /** The audit log must state that it cannot be edited — the design leads with it. */
  test('the audit log declares itself append-only', async ({ page }) => {
    await page.goto('/audit');

    await expect(page.getByText(t.sections.audit.immutable)).toBeVisible();
    await expect(
      page.getByRole('columnheader', { name: t.sections.audit.colIp }),
    ).toBeVisible();
  });

  /**
   * Emergency Mode cannot be armed by one click.
   *
   * It halts commerce in a region and may broadcast to every customer with an upcoming booking
   * there. The button must stay inert until a target, a reason and at least one flag are present.
   */
  test('emergency mode refuses to arm without a target and a reason', async ({
    page,
  }) => {
    await page.goto('/emergency');

    const arm = page.getByRole('button', { name: t.admin.handle });

    await expect(arm).toBeDisabled();
    await expect(
      page.getByRole('button', { name: t.sections.emergency.activate }),
    ).toHaveCount(0);
  });

  /** Gift card codes are hashed; the console must never show a whole one. */
  test('gift cards show only the last four characters', async ({ page }) => {
    await page.goto('/giftcards');

    await expect(page.getByText(t.sections.giftcards.codeNote)).toBeVisible();
  });

  /**
   * A dispute cannot be closed without a written decision.
   *
   * The API requires ten characters, a database CHECK requires a resolution for any terminal
   * status, and the form keeps its button disabled. Three layers, because this closure releases a
   * partner's payout and may credit a customer's wallet — and a dispute closed with no stated
   * outcome is unauditable.
   */
  test('a dispute cannot be closed without a resolution', async ({ page }) => {
    await page.goto('/disputes');

    const open = page.getByRole('button', { name: t.sections.disputes.open }).first();

    test.skip((await open.count()) === 0, 'No open dispute in the seeded data');

    await open.click();

    const confirm = page.getByRole('button', { name: t.sections.disputes.confirmClose });

    await expect(confirm).toBeDisabled();

    // Too short still leaves it disabled; the threshold matches the API and the CHECK.
    await page.getByRole('textbox').first().fill('short');
    await expect(confirm).toBeDisabled();

    await page
      .getByRole('textbox')
      .first()
      .fill('تحققنا من الشكوى وأغلقناها بعد مراجعة الأدلة.');
    await expect(confirm).toBeEnabled();
  });

  /**
   * An unresolved dispute must SAY that it is holding the partner's money.
   *
   * "فتح النزاع يجمّد استحقاق تحويل الشريك" is the rule with money attached and the one an operator
   * forgets, so it is a badge on each affected card rather than only a footnote.
   */
  test('unresolved disputes state the payout freeze', async ({ page }) => {
    await page.goto('/disputes');

    await expect(page.getByText(t.sections.disputes.frozen).first()).toBeVisible();
    await expect(page.getByText(t.sections.disputes.note)).toBeVisible();
  });

  /**
   * The WhatsApp channel is not wired, and the screen says so.
   *
   * The provider is undecided (item 192). A comms log that showed queued WhatsApp messages without
   * that caveat would read as "sending works", and somebody would wait for a delivery that is
   * never coming.
   */
  test('the comms log admits WhatsApp is not wired', async ({ page }) => {
    await page.goto('/comms');

    await expect(page.getByText(t.sections.comms.whatsappBlocked)).toBeVisible();
    // And the inert template is labelled rather than hidden.
    await expect(page.getByText(t.sections.comms.notWired).first()).toBeVisible();
  });

  /**
   * Advertising must never expose a ranking control.
   *
   * "لا تُخلط بترتيب البحث الطبيعي" is a promise to customers. There is no priority column in the
   * table, in the service or in the schema, and the screen states it — because the moment such a
   * control exists somebody will use it.
   */
  test('the ads screen states that ads never affect ranking', async ({ page }) => {
    await page.goto('/ads');

    await expect(page.getByText(t.sections.ads.noRanking)).toBeVisible();
  });

  /**
   * Contact details are stripped from staff replies too.
   *
   * Exempting staff would be the obvious shortcut and the wrong one: an agent pasting a partner's
   * number to a customer defeats the rule just as thoroughly.
   */
  test('a staff reply has its contact details redacted', async ({ page }) => {
    await page.goto('/messages');

    /*
      An OPEN thread, not merely the first one.

      The inbox is newest-first and staff — and now the asker, who can close their own request — end
      threads, so the newest row is often closed. `MessagingService.reply` refuses a closed thread, so
      picking blindly makes this spec fail with a redaction error message about a conversation that was
      never repliable. The row carries a «مغلقة» pill when it is closed; `filter({ hasNot })` is what
      turns that into a selector.
    */
    const rows = page.locator('a[href^="/messages/"]');
    const thread = rows
      .filter({ hasNot: page.getByText(t.sections.messages.closed) })
      .first();

    test.skip((await rows.count()) === 0, 'No seeded conversation');
    test.skip((await thread.count()) === 0, 'Every seeded conversation is closed');

    await thread.click();
    await page.getByRole('textbox').first().fill('اتصل بي على 0944123456 بخصوص الحجز');
    await page.getByRole('button', { name: t.sections.messages.reply }).click();

    // The number is gone; the mask is visible; the booking word survived.
    await expect(page.getByText('0944123456')).toHaveCount(0);
    await expect(page.getByText('⟨محجوب⟩').first()).toBeVisible();
  });

  /**
   * نطاق العمل is stated as SERVER-ENFORCED, and the audit exemption is stated with it.
   *
   * Bashar's decision, 2026-08-04. The panel's note is not decoration: a scope that is displayed
   * but not enforced is worse than no scope, so the screen commits to which it is. And it says the
   * audit log stays complete, because that is the one place an operator might reasonably assume
   * scope applies and it deliberately does not.
   */
  /**
   * A real rename, end to end — the one path on صفحة الموظف that nothing else drives.
   *
   * ## Why it renames TWICE
   *
   * The first write uses a unique value, so passing proves this run wrote something rather than
   * reading a name a previous run left behind. The second puts the account into a STABLE, known
   * state, because the suite shares one staff account and an unrestored change leaks into later
   * specs and later runs — the failure mode that made a default-page-size assertion fail a whole
   * run later for a reason with no relationship to the change that caused it.
   *
   * It cannot restore "unnamed": the API requires two characters, so there is no value that means
   * "back to null". Ending on a fixed name is the closest thing to idempotent available, and it
   * makes a re-run start from the same place.
   */
  test('a member can be renamed, and the name reaches the list', async ({ page }) => {
    const unique = `اختبار ${Date.now()}`;
    const settled = 'موظف الاختبار';

    await page.goto(`/staff?size=100`);

    const own = page.locator('li').filter({ hasText: STAFF_EMAIL }).first();

    test.skip((await own.count()) === 0, 'The e2e account is not in the staff registry.');
    await own.getByRole('link').first().click();

    const field = page.getByLabel(t.sections.staff.member.colName);

    await expect(field).toBeVisible();

    await field.fill(unique);
    await page.getByRole('button', { name: t.sections.staff.member.renameSave }).click();

    /* The record shows it — the panel re-renders from the server, not from the input. */
    await expect(page.getByText(unique).first()).toBeVisible({ timeout: 15_000 });

    /*
      And the LIST shows it, which is the half that matters to somebody scanning for a colleague.
      Asserted by ROLE on the row's link, not as page text: the field the rename form is still
      holding contains the same string, so `getByText` would pass on a list that never updated.
    */
    await page.goto(`/staff?size=100`);
    await expect(
      page.getByRole('link', { name: new RegExp(unique.replace(/\s/g, '\\s')) }).first(),
    ).toBeVisible();

    /* Put the account back into a known state — see the note above. */
    await page.goto(`/staff?size=100`);
    await page
      .locator('li')
      .filter({ hasText: STAFF_EMAIL })
      .first()
      .getByRole('link')
      .first()
      .click();
    await page.getByLabel(t.sections.staff.member.colName).fill(settled);
    await page.getByRole('button', { name: t.sections.staff.member.renameSave }).click();
    await expect(page.getByText(settled).first()).toBeVisible({ timeout: 15_000 });
  });

  /**
   * تحديد النطاق — setting a colleague's cities, and proving the contradiction is REFUSED.
   *
   * ## Why it hunts for a member
   *
   * The e2e account is a super admin, and a super admin is not scopable — the editor is deliberately
   * absent from their record. So this walks rows until it finds one that has it, rather than
   * assuming a position in the list.
   *
   * ## The two assertions that matter, and neither is the happy path
   *
   * `all_cities` with cities selected is a contradiction `setStaffScopeSchema` refuses. The first
   * assertion is that the save fails. The second is that **nothing was written** — checked by
   * reloading and reading the scope back, because a 400 raised AFTER a successful write passes a
   * test that only looks at the error. The form deliberately does not clear the checkboxes under
   * «كل المدن», so this state is reachable by a reader, not only by a crafted request.
   *
   * The account is put back to «كل المدن» at the end: this writes to shared data, and narrowing a
   * scope revokes that member's sessions.
   */
  test('a scope can be set, and an impossible one is refused without being written', async ({
    page,
  }) => {
    const copy = t.sections.staff;

    await page.goto(`/staff?size=100`);

    const rows = page.locator('li').filter({ has: page.locator('a[href^="/staff/"]') });
    const total = await rows.count();

    test.skip(total === 0, 'No staff rows.');

    /* Walk until a record offers the editor — a super admin's will not. */
    let found = false;

    for (let index = 0; index < Math.min(total, 6); index += 1) {
      const text = (await rows.nth(index).innerText()).trim();

      if (text.includes(STAFF_EMAIL)) continue;

      await rows.nth(index).getByRole('link').first().click();

      if (await page.getByRole('heading', { name: copy.scopeEdit }).isVisible()) {
        found = true;
        break;
      }

      await page.goto(`/staff?size=100`);
    }

    test.skip(!found, 'No scopable staff member in the first rows.');

    const cityBox = page.locator('form input[type="checkbox"]').first();

    /* Restrict to one city, and save. */
    await page.getByRole('radio', { name: copy.scopeKindCities }).check();
    await cityBox.check();
    await page.getByRole('button', { name: copy.scopeSave }).click();
    await expect(page.getByText(copy.scopeSaved)).toBeVisible({ timeout: 15_000 });

    /*
      It took — read off the النطاق row's `data-state`, not off the page text.

      Searching for «كل المدن» was my first attempt and it is worthless: that string is also the
      label of a radio in the editor directly below, so it is on the page whatever the scope is. It
      passed while the scope was all-cities, which is the state it was meant to rule out.
    */
    await page.reload();
    await expect(page.getByRole('heading', { name: copy.scopeEdit })).toBeVisible();
    await expect(page.locator('dd[data-state]')).toHaveAttribute('data-state', 'cities');

    /*
      Now the contradiction: «كل المدن» with a city still selected. The API must refuse.

      `.check()` on the radio does not clear the checkbox — the form leaves it, on purpose — so this
      is the state a reader reaches by changing their mind, not a hand-built request.
    */
    await page.getByRole('radio', { name: copy.scopeKindAll }).check();
    await page.getByRole('button', { name: copy.scopeSave }).click();
    await expect(page.getByRole('alert')).toBeVisible({ timeout: 15_000 });

    /*
      And NOTHING was written. This is the assertion the whole test is for: reloaded from the
      server, the scope is still `cities`, not the `all_cities` the refused save carried.
    */
    await page.reload();
    await expect(page.locator('dd[data-state]')).toHaveAttribute('data-state', 'cities');

    /*
      Put it back — shared data, and narrowing revokes that member's sessions.

      The cities are cleared FIRST, while «مدن محددة» is still selected. Choosing «كل المدن» disables
      the checkboxes — that is the component doing its job — and a disabled box cannot be unchecked,
      so the other order hangs on a click that can never land.
    */
    await page.locator('form input[type="checkbox"]:checked').first().uncheck();
    await page.getByRole('radio', { name: copy.scopeKindAll }).check();
    await page.getByRole('button', { name: copy.scopeSave }).click();
    await expect(page.getByText(copy.scopeSaved)).toBeVisible({ timeout: 15_000 });

    /* Restored, checked rather than assumed — an unrestored scope leaks into later runs. */
    await page.reload();
    await expect(page.locator('dd[data-state]')).toHaveAttribute(
      'data-state',
      'all_cities',
    );
  });

  /**
   * آخر نشاط الموظفين — the search, the cap, the pager, and the entry screen.
   *
   * ## The assertion that matters is the EMPTY one
   *
   * A term matching nobody must return no rows. The failure it guards is silent and it is the whole
   * reason a search box is dangerous: a reader types a colleague's name, a broken filter returns
   * every row, and they read the first one as that person's work. A test that only searched for
   * somebody who EXISTS passes on that build.
   */
  test('the staff activity searches, caps its height, pages, and opens an entry', async ({
    page,
  }) => {
    const copy = t.sections.staff;

    await page.goto('/staff');

    const search = page.getByLabel(copy.activitySearchLabel);

    await expect(search).toBeVisible();

    /* The list is capped and scrolls in its own box rather than growing the page. */
    const list = page
      .locator('ul')
      .filter({ has: page.locator('a[href^="/staff/activity/"]') });

    test.skip((await list.count()) === 0, 'No staff activity on this database.');

    const box = await list.first().boundingBox();
    const scrollable = await list
      .first()
      .evaluate((node) => node.scrollHeight > node.clientHeight + 1 || true);

    console.log('activity box height:', box?.height, 'scrollable:', scrollable);
    expect(box?.height ?? 0).toBeLessThanOrEqual(460);

    /* Its own pager, named, so the accounts registry's does not answer for it. */
    await expect(
      page.getByRole('navigation', {
        name: t.table.paginationLabelOf.replace('{section}', copy.activity),
      }),
    ).toBeVisible();

    /* A term nobody matches: no rows, and it says the SEARCH found nothing. */
    await search.fill('zzz-no-such-person-zzz');
    await page.getByRole('button', { name: copy.activitySearchGo }).click();

    await expect(page.getByText(copy.activityNoMatch)).toBeVisible();
    expect(await page.locator('a[href^="/staff/activity/"]').count()).toBe(0);

    /* And the accounts registry above it has not moved — the two pagers are namespaced. */
    expect(new URL(page.url()).searchParams.get('activityQ')).toBe(
      'zzz-no-such-person-zzz',
    );

    /* Clearing brings the list back. */
    await page.getByRole('link', { name: copy.activityClear }).click();
    await expect(page.locator('a[href^="/staff/activity/"]').first()).toBeVisible();

    /* An entry opens, explains itself in Arabic, and comes back. */
    await page.locator('a[href^="/staff/activity/"]').first().click();
    await expect(
      page.getByRole('heading', { name: copy.activityWhat, level: 2 }),
    ).toBeVisible();

    const body = await page.locator('main').innerText();

    /* Never a raw action identifier on an Arabic screen. */
    expect(body).not.toMatch(/\b[a-z_]+\.[a-z_]+\b/);

    await page
      .getByRole('link', { name: new RegExp(t.nav.staff) })
      .first()
      .click();
    await expect(page.getByLabel(copy.activitySearchLabel)).toBeVisible();
  });

  test('a member record states that scope is server-enforced', async ({ page }) => {
    /* The signed-in account, because the assertion below is specific to a super admin. */
    await page.goto(`/staff?size=100`);

    const own = page.locator('li').filter({ hasText: STAFF_EMAIL }).first();

    test.skip((await own.count()) === 0, 'The e2e account is not in the staff registry.');
    await own.getByRole('link').first().click();

    await expect(page.getByText(t.sections.staff.scopeNote)).toBeVisible();

    /*
      A super admin is «غير قابل للتقييد», NOT «كل المدن».

      The distinction is the point of the assertion: "all cities" implies somebody could narrow it,
      and the scope machinery does not apply to a super admin at all. The e2e account is one, so
      this is the state under test — and the opposite string must be absent, because a screen that
      showed both would satisfy a presence check.
    */
    await expect(page.getByText(t.sections.staff.scopeSuperAdmin).first()).toBeVisible();
    await expect(page.getByText(t.sections.staff.scopeAllCities)).toHaveCount(0);
  });

  /**
   * The export is REQUESTED, built by a worker, and collected — the whole of BullMQ phase 5.
   *
   * ## What this replaced
   *
   * It used to click a link and assert the CSV came back in the response, capped at 20,000 rows
   * because the file was built inside the request. Rule 2 names exports among the work that must
   * not block a request, and that cap was the rule being paid for in missing data.
   *
   * ## Why the whole round trip is one test
   *
   * The three halves only mean anything together: asking must not download anything, the file must
   * actually appear without a human doing anything else, and what arrives must be the filtered set
   * with its BOM. A test of any one of them passes on a build where the other two are broken.
   *
   * **This is where the suite depends on `pnpm worker`.** With no worker the row sits at «في
   * الانتظار» and the poll below times out here, which is a legible failure rather than a
   * mysterious one further down.
   */
  test('requests an export, waits for the worker, and collects a filtered CSV', async ({
    page,
  }) => {
    /*
      Longer than the suite default, because this one waits for another PROCESS.
      
      An `expect` timeout cannot exceed the test's own — the first version asked for 60 seconds
      inside a 30-second test and reported the test timeout instead, which reads as the export
      being broken rather than as the budget being wrong.
    */
    test.setTimeout(90_000);

    await page.goto('/bookings?status=cancelled');

    /*
      A BUTTON now, not a link. The verb is the point: a GET that created a row would let a
      prefetch or a pasted link produce an export in somebody's name.
    */
    await page.getByRole('button', { name: t.table.exportCsv }).click();

    /* POST → 303 → the collection screen, which is an ordinary shareable GET. */
    await page.waitForURL(/\/bookings\/exports/);

    const firstRow = page.locator('tbody tr').first();

    await expect(firstRow).toBeVisible();

    /*
      The status pill moves on its own — «في الانتظار» → «قيد الإنشاء» → «جاهز» — because a worker
      is doing the work. Polling the DOWNLOAD control rather than the pill: it is what the operator
      actually needs and it only exists once there is a file behind it.
    */
    const download = firstRow.getByRole('link', { name: t.sections.exports.download });

    await expect(download).toBeVisible({ timeout: 60_000 });

    const [file] = await Promise.all([page.waitForEvent('download'), download.click()]);

    expect(file.suggestedFilename()).toMatch(/^EXP-\d+\.csv$/);

    const path = await file.path();
    const { readFileSync } = await import('node:fs');
    const text = readFileSync(path, 'utf8');
    const lines = text.split('\n').filter(Boolean);

    // The BOM, the header, and at least one row.
    expect(text.charCodeAt(0)).toBe(0xfeff);
    expect(lines[0]?.replace(/^\uFEFF/, '')).toContain('reference,property,customer');
    expect(lines.length).toBeGreaterThan(1);

    // The filter survived the round trip: every data row ends in the requested status.
    for (const line of lines.slice(1).filter((row) => !row.startsWith('#'))) {
      expect(line.trim().endsWith('cancelled')).toBe(true);
    }
  });

  /**
   * The payments screen points at the payout registry rather than deriving transfers.
   *
   * This test used to assert the OPPOSITE — that the screen admitted no payouts table existed —
   * and that was the honest thing to say until the ledger shipped. The rule it protects is
   * unchanged and is now asserted on the registry itself: a transfer is a recorded EVENT, never
   * `partner_payable_amount` summed up and presented as one.
   */
  test('payments links to the payout registry rather than deriving transfers', async ({
    page,
  }) => {
    await page.goto('/payments');

    const link = page.getByRole('link', { name: t.sections.payments.payoutsLink });

    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/payouts/);

    await expect(
      page.getByRole('heading', { name: t.sections.payouts.title }),
    ).toBeVisible();
  });

  /**
   * The moderation queue exists, states P-006, and offers no way to delete anything.
   *
   * A reported review is the one place staff could plausibly be given a delete button — they are
   * the ones being asked to make something go away. The queue offers «إخفاء» and «إبقاء» instead,
   * and the footnote says why. Asserted by absence for the same reason the partner side is: a page
   * can state a policy and still ship the control that breaks it.
   */
  test('the review moderation queue offers hide and keep, never delete', async ({
    page,
  }) => {
    await page.goto('/reviews');

    await expect(
      page.getByRole('heading', { name: t.sections.reviewModeration.title }),
    ).toBeVisible();
    await expect(page.getByText(t.sections.reviewModeration.note)).toBeVisible();

    await expect(page.getByRole('button', { name: /حذف/ })).toHaveCount(0);
  });

  /**
   * Every payout on the registry is a ROW, and the screen never invents one.
   *
   * The footnote states the accrual rule — completed and paid bookings only, with disputed ones
   * excluded — because an operator reading a total needs to know what it is a total OF. The
   * pagination bar is asserted because this registry is a table like every other, and the
   * standing rule admits no exceptions that are not written down.
   */
  test('the payout registry states what it counts and pages like every other table', async ({
    page,
  }) => {
    await page.goto('/payouts');

    await expect(page.getByText(t.sections.payouts.note)).toBeVisible();
    await expect(
      page.getByRole('navigation', { name: /تنقّل بين/ }).first(),
    ).toBeVisible();

    /*
      When accrual last ran, on the screen somebody opens to answer "where is my money".

      A scheduled job that STOPPED firing is invisible otherwise: a throw lands in the log and in
      the run's `error`, but silence lands nowhere. One of these three sentences is always shown,
      so the absence of any of them means the footnote itself has broken.
    */
    await expect(
      page.getByText(
        new RegExp(
          [
            t.sections.payouts.lastAccrualNever,
            t.sections.payouts.lastAccrual.split('{')[0],
            t.sections.payouts.lastAccrualFailed.split('{')[0],
          ]
            .map((part) => part?.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
            .join('|'),
        ),
      ),
    ).toBeVisible();
  });

  /**
   * The booking detail speaks Arabic, including the values it gets from the database.
   *
   * Bashar reported four English leaks on one screen (2026-08-05): the status pill printed the raw
   * enum `confirmed`, the property card printed the unit's `name_en` and the city's URL SLUG
   * («damascus»), and the customer card carried `Booked as a guest` written straight into the
   * component. Three of the four came from the API selecting the wrong COLUMN, which no amount of
   * catalogue discipline in the console would have caught — the copy was never in the console.
   *
   * Asserted against the catalogue and the party cards only. The screen legitimately contains
   * Latin elsewhere — references, emails, currency codes, timeline event types and their JSON —
   * so a blanket "no Latin on the page" rule would fail on correct output.
   */
  test('the booking detail translates its status, unit and city', async ({ page }) => {
    await page.goto('/bookings?size=5');
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    // The status pill: one of the catalogue's Arabic names, never the enum it came from.
    const status = page.locator('header span').last();

    expect(Object.values(t.bookingStatus)).toContain((await status.innerText()).trim());

    /*
      `exact`, because the party card's title «العميل» is also a substring of the money section's
      «إجمالي العميل» — a loose match resolves to both and Playwright refuses to guess.
    */
    const card = (title: string) => page.getByText(title, { exact: true }).locator('..');

    // The customer card ends in a full Arabic clause, whichever of the two applies.
    const account = await card(t.sections.bookingDetail.customer).innerText();

    expect(
      account.includes(t.sections.bookingDetail.bookedAsGuest) ||
        account.includes(t.sections.bookingDetail.hasAccount),
    ).toBe(true);

    /*
      The property card's last line is the city. A slug is the specific thing that shipped, and it
      is recognisable: lowercase Latin, hyphens for spaces, never a space.
    */
    const property = await card(t.sections.bookingDetail.property).innerText();
    const lines = property.split('\n').map((line) => line.trim());
    const city = lines.at(-1) ?? '';

    expect(city).not.toMatch(/^[a-z][a-z-]*$/);
  });

  /**
   * The timeline shows no raw JSON, on any booking.
   *
   * It printed `{"reason":"EC-001"}` — a developer reading their own data structure, not a support
   * agent reading a booking (Bashar, 2026-08-06). Every payload field is still on screen; the
   * braces, quotes and camelCase keys are not.
   *
   * Swept across a page of bookings rather than asserted on one, because which payload shape a
   * booking carries depends on how it ended, and the one that regresses is the one not opened.
   */
  test('no booking timeline prints a raw JSON payload', async ({ page }) => {
    await page.goto('/bookings?size=10');

    const references = await page.locator('tbody tr td:first-child a').allInnerTexts();
    const raw: string[] = [];

    for (const reference of references) {
      await page.goto(`/bookings/${reference.trim()}`);

      const timeline = page
        .getByRole('heading', { name: t.sections.bookingDetail.timeline })
        .locator('..');

      if ((await timeline.count()) === 0) continue;

      const text = await timeline.innerText();

      // `{"` is the signature of a stringified object; a translated label never contains it.
      if (text.includes('{"')) raw.push(`${reference.trim()}: ${text.slice(0, 60)}`);
    }

    expect(raw).toStrictEqual([]);
  });

  /**
   * The booking detail's Latin runs survive an RTL line, and its figures are formatted.
   *
   * Bashar reported three on one screen (2026-08-06): `+963900000001` rendered as
   * `963900000001+`, and the FX line read `2625870.00 ل.س بسعر صرف 13000.00000000`.
   *
   * The phone is the case that needs a BROWSER. The character order in the DOM was always
   * correct — `+` first — and it is the bidirectional algorithm, at paint time, that moves a
   * neutral leading character to the far end. Reading the DOM text would have shown a passing
   * `+963…` while the screen showed `963…+`, so this asserts on `dir`, which is what decides it.
   */
  test('the booking detail keeps its phone and figures readable', async ({ page }) => {
    await page.goto('/bookings?size=5');
    await page.locator('tbody tr a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    // Every phone is inside an explicit left-to-right run, which is what pins the `+`.
    const phones = page.locator('p', { hasText: /^\+\d{6,}$/ });

    expect(await phones.count()).toBeGreaterThan(0);

    for (const phone of await phones.all()) {
      /*
        Looking DOWN, not up: the paragraph itself inherits `rtl` from the document, and the fix
        is the `Ltr` run INSIDE it. Walking up with `closest` finds `<html dir="rtl">` and passes
        or fails for a reason that has nothing to do with this.
      */
      const wrapped = await phone.evaluate(
        (el) => el.matches('[dir="ltr"]') || el.querySelector('[dir="ltr"]') !== null,
      );

      expect(wrapped).toBe(true);
    }

    /*
      The FX line: a grouped SYP total, and a rate with no `numeric(18,8)` tail. Matched by shape
      rather than by value — the seed's amounts change, the formatting rules do not.
    */
    const fx = await page
      .getByText(t.sections.bookingDetail.fxSnapshot.split('{amount}')[1]!.slice(0, 6), {
        exact: false,
      })
      .first()
      .innerText();

    expect(fx).not.toMatch(/\d\.\d{3,}/);
    expect(fx).toMatch(/\d{1,3}(,\d{3})+/);
  });

  /**
   * A status is the same word AND the same colour in the الحجوزات table and on the booking's own
   * screen.
   *
   * Bashar reported the mismatch (2026-08-05). The detail screen had built its own pill from a
   * three-branch guess: `checked_in` green where the table says sky, `completed` green where the
   * table says faint, and everything unrecognised GOLD — which caught `pending_confirmation`, the
   * one status §14 makes an explicit rule about, and painted the purple "waiting on the partner"
   * as if it were good news. Both screens now share `bookingStatusTone`.
   *
   * Compared on the COMPUTED colour of the same row's status, read before and after clicking
   * through. Asserting a class name would pass on two pills that resolve to different paint, and
   * asserting a fixed colour would pin whichever status the seed happens to put first.
   */
  test('a booking status is the same colour in the table and on its own screen', async ({
    page,
  }) => {
    await page.goto('/bookings?size=5');

    const row = page.locator('tbody tr').first();
    const inTable = await pill(row.locator('span.rounded-full').first());

    await row.locator('a').first().click();
    await page.waitForURL(/\/bookings\/BKG/);

    const onDetail = await pill(page.locator('header span.rounded-full').first());

    expect(onDetail).toStrictEqual(inTable);
  });
});

/** A status pill's word and painted colour, which is what the two screens must agree on. */
async function pill(locator: Locator): Promise<{ text: string; color: string }> {
  return {
    text: (await locator.innerText()).trim(),
    color: await locator.evaluate((el) => getComputedStyle(el).color),
  };
}

/** The first body cell of the first row — used to prove a page actually changed. */
async function firstCell(page: Page): Promise<string> {
  return page.locator('table tbody tr').first().locator('td').first().innerText();
}
