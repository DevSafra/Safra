import { test as setup } from '@playwright/test';

import { MISSING_CREDENTIALS, SKIP_REASON, STAFF_STATE, signIn } from './staff.js';

/**
 * Signs in once and saves the session for the rest of the run.
 *
 * A setup PROJECT rather than a `beforeAll` hook, because Playwright restarts the worker
 * after a failing test and re-runs file-scoped hooks in the new one. With a rate-limited
 * login endpoint that turns one real failure into a cascade: the retry of the hook is
 * throttled, so every remaining test fails on a missing form instead of reporting the
 * defect that actually broke. A setup project runs exactly once, whatever the tests do.
 *
 * The sign-in flow keeps its own tests — see `staff-login.spec.ts` — so this shortcut never
 * hides a broken login. If this step fails, the whole run reports the reason here.
 */
setup.skip(MISSING_CREDENTIALS, SKIP_REASON);

setup('capture a staff session', async ({ page, context }) => {
  await signIn(page);

  await context.storageState({ path: STAFF_STATE });
});
