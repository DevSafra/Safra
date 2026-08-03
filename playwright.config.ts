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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
