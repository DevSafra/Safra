import { defineConfig, devices } from '@playwright/test';

/**
 * Browser tests.
 *
 * ## Why this exists
 *
 * `pnpm verify` runs 554 tests and passed green while the staff sign-in form was
 * unusable in a browser — twice. A Content-Security-Policy blocked every hydration
 * script, so no form worked at all; and the login form recycled a DOM node, so the code
 * field arrived holding the password. Both were invisible to every check in the suite,
 * because every check was HTTP-level: the pages returned `200` with correct-looking
 * server-rendered HTML in each case.
 *
 * These tests exercise the DOM the way a person does. They are the only tests here that
 * can see a client-side regression, so they are deliberately few and aimed at exactly
 * the failures that got through.
 *
 * ## Run
 *
 *   pnpm e2e            # headless
 *   pnpm e2e:headed     # watch it happen
 *
 * The apps must already be running (`pnpm dev` or the built servers). A `webServer`
 * block was considered and rejected: it would rebuild and restart both Next apps on
 * every run, turning a ten-second check into minutes.
 */
export default defineConfig({
  testDir: './e2e',
  // Not parallel: these share one database and one set of accounts, and the login tests
  // consume the per-IP rate limit. Racing them produces 429s, not signal.
  workers: 1,
  fullyParallel: false,
  // Fail the run rather than paper over a flake — a retried browser test hides exactly
  // the intermittent hydration problems this harness exists to catch.
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3001',
    // Captured only for a failure, so a green run leaves nothing behind.
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  /*
    A note on WHICH limit binds here, because 2026-08-20 changed the other one and the two are easy
    to confuse. The per-IP ceiling on `/auth/login` went from 40 to 300 and now counts only FAILED
    sign-ins (`O-sec-3`), so it is no longer anywhere near this suite's budget. What binds is the
    per-(IP, ACCOUNT) throttler at ten a minute — unchanged, never refunded, and the reason the
    signing-in specs are still sequenced out of the crowded window below. Raising the per-IP number
    did not buy this suite a single extra sign-in.
  */
  projects: [
    /**
     * Signs in once and saves the session (`e2e/auth.setup.ts`).
     *
     * `POST /auth/login` allows ten calls a minute per (IP, ACCOUNT) and a two-step sign-in spends
     * two, so tests that live behind the login replay this session instead of signing in
     * again. Doing it here rather than in a `beforeAll` matters: Playwright restarts the
     * worker after a failing test and re-runs file hooks, so a hook-based sign-in gets
     * throttled on the retry and turns one real failure into a whole-suite cascade.
     */
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      /*
        The specs that need a PARTNER SESSION are their own project, LAST — see below. They are
        excluded here rather than left to sort themselves out: `partner.setup.ts` writes the session
        in a project that depends on this one, so a partner spec collected here would read a state
        file that does not exist yet.
      */
      testIgnore:
        /(partner|partner-arrivals|partner-images|partner-screens|partner-sidebar|partner-calendars|partner-employees|partner-suspension|customer-review|customer-invoices|customer-gifts|partner-support|auth-throttle|three-apps-together|payout-accounts)\.spec\.ts/,
    },
    /**
     * Everything that SIGNS IN, run after everything else.
     *
     * Not a style preference — a budget one. `POST /auth/login` allows ten calls a minute per
     * (IP, ACCOUNT), and this suite makes FOURTEEN against the SAME few accounts: two for the staff session, eight in `staff-login.spec.ts`
     * which tests the form itself, three on the partner side since 2FA made that sign-in two
     * steps, and one for the customer review flow. Fourteen does not fit in a two-minute run
     * however they are ordered, so everything that signs in is moved out of the crowded window
     * rather than squeezed alongside it — mid-suite they pushed the last staff test over the
     * limit, which fails as «محاولات كثيرة», a message with no relationship to the code tested.
     *
     * Ordering them last means these sign-ins can starve nothing: there is nothing after them.
     * `dependencies` is what expresses that, rather than relying on filenames sorting the way we
     * happen to want today.
     */
    /**
     * The partner sign-in, captured after everything else has finished signing in.
     *
     * Its own project rather than part of `setup` because of a hard budget: `POST /auth/login`
     * allows ten calls a minute per (IP, ACCOUNT), and this suite makes THIRTEEN — two for the
     * staff session,
     * eight in `staff-login.spec.ts` which tests the form itself, and three on the partner side
     * since 2FA made that sign-in two steps. Thirteen in a seventy-second run does not fit however
     * they are ordered, so the partner ones are moved out of the crowded window rather than
     * squeezed alongside it.
     *
     * See the wait inside `partner.setup.ts` for the part that makes this deterministic. Raising
     * the limiter to make a test suite pass was considered and rejected: it is a live control
     * against credential stuffing, and the suite is the thing that should bend.
     */
    {
      name: 'signed-in-setup',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['chromium'],
      testMatch: /partner\.setup\.ts/,
    },
    {
      name: 'signed-in',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['signed-in-setup'],
      testMatch:
        /(partner|partner-arrivals|partner-images|partner-screens|partner-sidebar|partner-calendars|partner-employees|partner-suspension|customer-review|customer-invoices|customer-gifts|partner-support|auth-throttle|three-apps-together|payout-accounts)\.spec\.ts/,
    },
  ],
});
