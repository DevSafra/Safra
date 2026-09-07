#!/usr/bin/env node
/**
 * The unattended browser run: every project, in order, and loud about anything that did not run.
 *
 * ## Why this exists rather than `playwright test`
 *
 * Playwright SKIPS a dependent project when its dependency has any failure. `signed-in` used to
 * depend on `chromium`, so one flaky test silently prevented twenty-plus Partner Portal and
 * cross-application specs from executing — and the run said «380 passed, 2 failed» with a quiet
 * «4 did not run» beside it. A fifth of the suite went unexecuted and the summary line did not
 * mention it. An unattended runner that reports a number nobody can trust is worse than no runner.
 *
 * So ORDERING is this script's job and SUCCESS is each project's. The projects are sequenced here —
 * partner specs after staff specs, because they share a database — and every project runs whatever
 * the one before it did.
 *
 * ## What makes it fail
 *
 * A failed test, obviously. But also, and this is the point: a project that produced NO results, a
 * test left `interrupted`, or an expected project missing from the run entirely. "Did not run" is a
 * failure here, never a footnote.
 *
 * ## Skips have a budget now (Bashar, 2026-09-07)
 *
 * «A skipped or unexecuted workflow should never look like a passed workflow.» Skips used to be
 * reported and never fail, on the reasoning that a spec which skips states its reason. Two things
 * were wrong with that. A ceiling nobody enforces is not a ceiling, so the number could climb
 * indefinitely while every run stayed green; and a skip with NO reason attached is invisible in a
 * summary line, indistinguishable from a test that ran and passed.
 *
 * So `test-budget.json` declares a ceiling per project, and three things fail a run:
 *
 * - more skips than the ceiling allows, each one named;
 * - any UNDECLARED skip — one carrying no `skip`/`fixme` annotation with a description, because
 *   that is the kind nobody can audit;
 * - a ceiling sitting more than `maxSlack` above what actually happened. That is the decay check:
 *   a budget of forty over five real skips is thirty-five future skips nobody will be told about,
 *   which is the direction `.claude/CLAUDE.md` says an exemption list always rots in.
 *
 * ## It resets the testbed first (Bashar, 2026-09-07)
 *
 * Four specs were skipping because the fixtures had been CONSUMED — «no booking awaits
 * confirmation», «every dispute here has already been taken», «this listing has no photographs».
 * Each is a spec that ran perfectly on a fresh testbed and then quietly stopped exercising anything
 * as earlier suites ate the rows it needed. An overnight run on drifted data reports the quality of
 * the fixtures, not the quality of the platform.
 *
 * So `--reset` runs `pnpm db:testbed` before the first project, and a FAILED reset fails the whole
 * run rather than being carried forward — a run whose starting state is unknown cannot tell the
 * truth about anything. Which mode ran is recorded in the summary, because it changes what the
 * numbers MEAN: a run on drifted fixtures is a useful local signal and a misleading overnight
 * report.
 *
 * ## Why it is OPT-IN and not yet the default
 *
 * Measured on the day it was built. Resetting first makes the suite WORSE, and the reason is the
 * point: `db:testbed` produces a database on which several workflows cannot be exercised at all.
 * Chromium went from 8 skips to 21 — «no bookable unit to reach checkout with», «no rendered
 * evidence in the queue», «every city is at its photograph cap», and fifteen on an empty media
 * bucket — and three payout and employee specs went from passing to FAILING.
 *
 * `payout-accounts.spec.ts` states the biggest cause itself: «This comes from the hourly
 * payout-accrual job, NOT from db:testbed — a freshly reset testbed has none until that job next
 * fires.» So the payout workflows are untestable from a clean database, and no spec can fix that
 * for itself: `POST /admin/payouts/accrue` exists but has no reachable surface, and a browser
 * session is not an API token, so calling it answers 401.
 *
 * Turning this on by default today would make every unattended run red for reasons that are real
 * but not the platform's, which trains people to stop reading it — the opposite of the point. So
 * the automation is here and off, and what it takes to switch it on is written down in
 * `docs/FUTURE-WORK.md` rather than guessed at.
 *
 * ## Output
 *
 * A human summary on stdout and `test-reports/e2e-summary.json` for a machine. Usage:
 *
 *     pnpm e2e:run              # runs everything against the database as it stands
 *     pnpm e2e:run --reset      # resets the testbed first; see the note above before trusting it
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

const BUDGET = JSON.parse(readFileSync('test-budget.json', 'utf8')).playwright;

/** In order. `setup` and `signed-in-setup` are pulled in as dependencies of these two. */
const PROJECTS = ['chromium', 'signed-in'];
/*
  `test-reports/`, NOT `test-results/`.

  Playwright EMPTIES its output directory at the start of every run, and a run here is two of
  them. So `chromium`'s report was written and then deleted by `signed-in` starting, leaving the
  overnight artefact describing half the suite — and it took the vitest summary with it. The
  `.gitignore` note beside `.e2e-secrets/` had already learnt this exact lesson and both runners
  wrote here anyway.
*/
const REPORT = 'test-reports/e2e-report.json';
const SUMMARY = 'test-reports/e2e-summary.json';

/** Every test in a Playwright JSON report, flattened out of its suite tree. */
function flatten(suite, out = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.[test.results.length - 1];

      /*
        Why it skipped, if it says. `test.skip(condition, 'reason')` and `test.fixme` land in
        `annotations`; a bare `test.skip()`, or a skip from a failed dependency, carries none —
        and that is the difference this run has to be able to see.
      */
      const reason = (test.annotations ?? [])
        .filter((one) => one.type === 'skip' || one.type === 'fixme')
        .map((one) => one.description)
        .filter(Boolean)
        .join('; ');

      out.push({
        /* The JSON report carries plain fields, not the JS API's `titlePath()`. */
        title: `${suite.title ? `${suite.title} › ` : ''}${spec.title}`,
        file: spec.file,
        status: result?.status ?? 'did-not-run',
        expected: test.expectedStatus,
        reason,
      });
    }
  }

  for (const child of suite.suites ?? []) flatten(child, out);

  return out;
}

function runProject(project) {
  console.log(`\n── ${project} ──────────────────────────────────────────────`);

  const run = spawnSync(
    'npx',
    ['playwright', 'test', `--project=${project}`, '--reporter=json'],
    { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: process.env },
  );

  /* The JSON reporter writes to stdout; a crash before that leaves nothing to parse. */
  let report;

  try {
    report = JSON.parse(run.stdout);
  } catch {
    console.error(run.stdout?.slice(-2000) ?? '');
    console.error(run.stderr?.slice(-2000) ?? '');

    return { project, crashed: true, tests: [] };
  }

  writeFileSync(REPORT.replace('.json', `-${project}.json`), JSON.stringify(report));

  const tests = (report.suites ?? []).flatMap((suite) => flatten(suite));

  return {
    project,
    crashed: false,
    tests,
    exitCode: run.status,
    /*
      What Playwright itself complained about, kept for the no-results case below.

      A project that COLLECTS nothing is reported as «did not run», and until 2026-09-07 that was
      all it said — while the reason sat in the report's own `errors` array. It cost a whole run to
      learn that a duplicate `const` in one spec zeroes every test in its project: 109 of them, and
      the summary a person reads the next morning named the project and not the cause.
    */
    errors: (report.errors ?? []).map((one) => one.message ?? String(one)),
  };
}

mkdirSync('test-reports', { recursive: true });

const reset = process.argv.includes('--reset');
const problems = [];

if (reset) {
  console.log('\n── resetting the testbed ────────────────────────────────');

  const seeded = spawnSync('pnpm', ['db:testbed'], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: process.env,
  });

  if (seeded.status !== 0) {
    /*
      Stop here rather than run anyway. Every skip and every failure after a half-applied reset
      describes the fixtures instead of the product, which is the one thing this runner exists
      not to report.
    */
    console.error(
      `\ndb:testbed exited ${seeded.status}. Refusing to run: a suite on an unknown ` +
        'starting state cannot tell the truth about the platform.',
    );
    writeFileSync(
      SUMMARY,
      JSON.stringify(
        {
          at: new Date().toISOString(),
          reset: 'failed',
          counts: {},
          problems: ['db:testbed failed; no projects were run'],
        },
        null,
        2,
      ),
    );
    process.exit(1);
  }
} else {
  console.log('\n── testbed not reset (pass --reset to) ──────────────────');
}

const results = PROJECTS.map(runProject);

for (const { project, crashed, tests, errors } of results) {
  if (crashed) {
    problems.push(`${project}: the run crashed before producing a report`);
    continue;
  }

  /* A project that produced nothing did not run, whatever the exit code says. */
  if (tests.length === 0) {
    problems.push(`${project}: produced no results — the project did not run`);

    /* And WHY, first line of each, because «did not run» alone costs a night. */
    for (const message of (errors ?? []).slice(0, 5)) {
      problems.push(`${project}:   ${message.split('\n')[0]}`);
    }

    if ((errors ?? []).length === 0) {
      problems.push(
        `${project}:   Playwright reported no error either — check that the project still ` +
          'matches any spec files, and that its dependency produced a session',
      );
    }
  }

  for (const test of tests) {
    if (test.status === 'failed' || test.status === 'timedOut') {
      problems.push(`${project}: FAILED ${test.title}`);
    } else if (test.status === 'interrupted' || test.status === 'did-not-run') {
      problems.push(`${project}: DID NOT RUN ${test.title}`);
    }
  }

  const skipped = tests.filter((t) => t.status === 'skipped');
  const ceiling = BUDGET.maxSkipped?.[project];

  /*
    A project with no declared ceiling is itself a gap: somebody added a project and nobody
    decided what it is allowed to leave unrun.
  */
  if (ceiling === undefined) {
    problems.push(
      `${project}: no skip budget declared for this project in test-budget.json — ` +
        'decide what it may leave unexecuted rather than leaving it unbounded',
    );
  } else {
    if (skipped.length > ceiling) {
      problems.push(
        `${project}: ${skipped.length} skipped, and the budget is ${ceiling}. ` +
          'Run them, or raise the budget with the reason in the commit message.',
      );

      for (const test of skipped.slice(0, 15)) {
        problems.push(
          `${project}:   skipped ${test.title}${test.reason ? ` — ${test.reason}` : ''}`,
        );
      }
    }

    /* The decay check: a ceiling that has stopped describing the suite. */
    const slack = ceiling - skipped.length;

    if (slack > BUDGET.maxSlack) {
      problems.push(
        `${project}: the skip budget is ${ceiling} and only ${skipped.length} skipped, ` +
          `so ${slack} skips could appear without anybody being told. ` +
          `Lower it to ${skipped.length} in test-budget.json.`,
      );
    }
  }

  /* An undeclared skip is the one that reads as a pass. Zero of these, always. */
  const undeclared = skipped.filter((t) => !t.reason);

  if (undeclared.length > (BUDGET.maxUndeclared ?? 0)) {
    problems.push(
      `${project}: ${undeclared.length} skipped with no stated reason — ` +
        'a skip nobody can audit is indistinguishable from a test that ran',
    );

    for (const test of undeclared.slice(0, 15)) {
      problems.push(`${project}:   unexplained skip ${test.file} › ${test.title}`);
    }
  }
}

const counts = Object.fromEntries(
  results.map(({ project, tests }) => [
    project,
    {
      total: tests.length,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed' || t.status === 'timedOut')
        .length,
      skipped: tests.filter((t) => t.status === 'skipped').length,
      skipBudget: BUDGET.maxSkipped?.[project] ?? null,
      skippedWithoutReason: tests.filter((t) => t.status === 'skipped' && !t.reason)
        .length,
      didNotRun: tests.filter(
        (t) => t.status === 'interrupted' || t.status === 'did-not-run',
      ).length,
    },
  ]),
);

writeFileSync(
  SUMMARY,
  JSON.stringify(
    {
      at: new Date().toISOString(),
      /*
        Recorded, because it changes what the numbers MEAN. A run on drifted fixtures is a
        useful local signal and a misleading overnight report, and the difference between the
        two has to survive into the file somebody reads the next morning.
      */
      reset: reset ? 'done' : 'not requested',
      counts,
      problems,
    },
    null,
    2,
  ),
);

console.log('\n════ browser run ════');
console.log(
  `  testbed: ${reset ? 'reset before the run' : 'not reset — pass --reset for a known state'}`,
);

for (const [project, c] of Object.entries(counts)) {
  console.log(
    `  ${project.padEnd(12)} ${c.passed} passed · ${c.failed} failed · ` +
      `${c.skipped} skipped (budget ${c.skipBudget ?? '—'}, ` +
      `${c.skippedWithoutReason} unexplained) · ${c.didNotRun} did not run  (of ${c.total})`,
  );
}

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const line of problems.slice(0, 40)) console.error(`  ${line}`);
  if (problems.length > 40) console.error(`  …and ${problems.length - 40} more`);
  console.error(`\nWritten to ${SUMMARY}`);
  process.exit(1);
}

console.log(`\nEverything ran. Written to ${SUMMARY}`);

if (!existsSync(SUMMARY)) process.exit(1);
