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
 * ## What it took to make this the default
 *
 * Turning it on the first time made the suite WORSE, which was the useful finding. `db:testbed`
 * produces a database on which several workflows cannot be exercised at all: chromium's skips rose
 * from 8 to 21 and three payout and employee specs went from passing to FAILING — they had been
 * passing on state left behind by earlier runs, which is not coverage, it is luck.
 *
 * The payout ones were the blocker. `payout-accounts.spec.ts` said so in its own failure: «This
 * comes from the hourly payout-accrual job, NOT from db:testbed.» No spec could fix it for itself
 * either, because `POST /admin/payouts/accrue` existed with no reachable surface and a browser
 * session is not an API token. So the console grew «تجميع المستحقات الآن» (Bashar, 2026-09-07),
 * and both specs now provision through the control an operator would press — see `e2e/accrual.ts`.
 *
 * The remaining fresh-testbed skips are declared and named in `test-budget.json`. They are real
 * gaps in what the seed provisions rather than anything this runner can decide.
 *
 * ## Output
 *
 * A human summary on stdout and `test-reports/e2e-summary.json` for a machine. Usage:
 *
 *     pnpm e2e:run              # resets the testbed, then runs everything
 *     pnpm e2e:run --no-reset   # against the database as it stands; marked as such in the summary
 */
import { spawnSync } from 'node:child_process';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
  writeSync,
  existsSync,
} from 'node:fs';

const BUDGET = JSON.parse(readFileSync('test-budget.json', 'utf8')).playwright;

/** In order. `setup` and `signed-in-setup` are pulled in as dependencies of these two. */
/**
 * Every project, and how many SHARDS each is run in.
 *
 * ## Why `signed-in` is sharded, and it is not about speed
 *
 * That project's specs all replay ONE saved partner session, and a saved session cannot survive a
 * long run. Three mechanisms, each established on 2026-09-09:
 *
 * 1. **Refresh reuse revokes the family.** `storageState` gives every context its own cookie jar
 *    seeded from the same snapshot, unlike a real browser where one jar is updated in place. The
 *    access token lives fifteen minutes, so the first context past that refreshes and rotates,
 *    the next presents the superseded token, and `TokenService.rotate` burns the whole lineage —
 *    taking the context that refreshed legitimately with it. Measured directly: refresh with the
 *    saved token → 200, the same token again → 401, and the freshly rotated token → 401.
 * 2. **The session cap retires it.** `MAX_CONCURRENT_SESSIONS` is ten, and the specs in this
 *    project sign in as the same partner repeatedly, so the setup's own family can be retired out
 *    from under them mid-run.
 * 3. **The sign-in code rides the queue the suite floods.** A partner's second factor is emailed
 *    through BullMQ, so the capture is least reliable exactly when the suite is busiest.
 *
 * Each shard is a SEPARATE `playwright test` invocation, so each re-runs `signed-in-setup` and
 * starts on a session minutes old rather than an hour. Unsharded this project reported 81 passed
 * and 40 failed; in three shards it reports 136 passed and none, in about three minutes.
 *
 * The cost is three partner sign-ins per run instead of one, which is well inside the ten-a-minute
 * limit when they are minutes apart — and the reason a shard count is a number here rather than a
 * flag somewhere is that raising it raises that cost.
 */
const PROJECTS = [
  { name: 'chromium', shards: 1 },
  { name: 'signed-in', shards: 3 },
];
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

function runProject(project, shard = 1, shards = 1) {
  const label = shards > 1 ? `${project} (shard ${shard}/${shards})` : project;

  console.log(`\n── ${label} ──────────────────────────────────────────────`);

  const run = spawnSync(
    'npx',
    [
      'playwright',
      'test',
      `--project=${project}`,
      ...(shards > 1 ? [`--shard=${shard}/${shards}`] : []),
      '--reporter=json',
    ],
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

  /* One file per SHARD: `-signed-in.json` written three times would keep only the last third. */
  const suffix = shards > 1 ? `-${project}-${shard}of${shards}` : `-${project}`;

  writeFileSync(REPORT.replace('.json', `${suffix}.json`), JSON.stringify(report));

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

/*
  ONE run at a time, and the reason is a run this guard would have prevented.

  On 2026-09-09 a previous session's run was still executing when a second was started. The second
  ran `db:testbed` — truncating and reseeding — underneath the first's browser tests, and both then
  reported numbers about a database neither of them owned. Nothing in either summary said so: a
  spec whose fixture vanished mid-test fails exactly like a defect, which is the failure mode this
  whole runner exists to eliminate.

  So the lock is not about tidiness or wasted machine time. A suite sharing its database with
  another suite CANNOT tell the truth about the platform, and that is the same reason a failed
  reset stops the run below.

  A killed run leaves its lock behind — today's case, since the stale run was terminated rather
  than allowed to finish — so a lock whose process is gone is taken over rather than obeyed. That
  is safe in the direction that matters: the check is «is that pid alive», and a live pid is never
  overridden.
*/
const LOCK = 'test-reports/.e2e-run.lock';

function alive(pid) {
  try {
    /* Signal 0 tests for the process without touching it. */
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/*
  Refuses rather than falls through, which is the whole point of the retry count.

  Two runners can see the SAME stale lock, both unlink it, and one loses the `wx` race — so a
  retry is needed. But a loop that ends without claiming would return normally and the run would
  proceed unlocked, which is precisely the state this guard exists to prevent. So exhausting the
  attempts is a refusal: the fail-safe direction is «do not run», never «run anyway».
*/
const LOCK_ATTEMPTS = 5;

function claimLock() {
  for (let attempt = 0; attempt < LOCK_ATTEMPTS; attempt += 1) {
    try {
      const handle = openSync(LOCK, 'wx');

      writeSync(
        handle,
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
      );
      closeSync(handle);

      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;

      /*
        A lock this cannot READ is a stale lock, never a reason to refuse.

        The file is written by a process that can be killed between `openSync` and `writeSync`, so
        a truncated or empty one is reachable — and `JSON.parse` throwing here would wedge every
        future run with a parse error, which is a worse failure than the one being prevented. The
        rule is the same as below: only a LIVE pid stops a run.
      */
      const held = (() => {
        try {
          const parsed = JSON.parse(readFileSync(LOCK, 'utf8'));

          return typeof parsed?.pid === 'number' ? parsed : null;
        } catch {
          return null;
        }
      })();

      if (held !== null && alive(held.pid)) {
        console.error(
          `\nAnother browser run is in progress — pid ${held.pid}, started ${held.at}.\n` +
            'Refusing to start: two suites sharing one database report numbers about neither.',
        );
        process.exit(1);
      }

      console.log(
        held === null
          ? '\n── taking over an unreadable lock ───────────────────────'
          : `\n── taking over a stale lock from pid ${held.pid} (${held.at}) ──`,
      );
      unlinkSync(LOCK);
    }
  }

  console.error(
    `\nCould not claim ${LOCK} in ${LOCK_ATTEMPTS} attempts — another run keeps taking it.\n` +
      'Refusing to start rather than run unlocked.',
  );
  process.exit(1);
}

/*
  Released however this process ends — but ONLY if the lock is still ours.

  The unconditional version of this was a self-disarming guard, and the path is short: a second
  run starts, finds the first alive, and refuses with `process.exit(1)` — at which point this
  handler fired and deleted the FIRST run's lock. The guard would have worked exactly once, then
  removed itself and let a third run proceed alongside. It reads the lock and compares the pid for
  that reason, which also covers the rarer case of a later run having taken a lock we had left
  behind.
*/
process.on('exit', () => {
  try {
    const held = JSON.parse(readFileSync(LOCK, 'utf8'));

    if (held?.pid === process.pid) unlinkSync(LOCK);
  } catch {
    /* Gone, unreadable, or somebody else's — none of the three is ours to remove. */
  }
});

claimLock();

const reset = !process.argv.includes('--no-reset');
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
  console.log('\n── testbed NOT reset (--no-reset) ───────────────────────');
}

/*
  Shards are merged back into ONE result per project, so every count, budget and «did not run»
  check below still reasons about a project rather than about how it happened to be split.
*/
const results = PROJECTS.map(({ name, shards }) => {
  const parts = Array.from({ length: shards }, (_, index) =>
    runProject(name, index + 1, shards),
  );

  return {
    project: name,
    crashed: parts.some((part) => part.crashed),
    tests: parts.flatMap((part) => part.tests),
    exitCode: parts.reduce((worst, part) => Math.max(worst, part.exitCode ?? 0), 0),
    errors: parts.flatMap((part) => part.errors ?? []),
  };
});

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
      reset: reset ? 'done' : 'skipped (--no-reset)',
      counts,
      problems,
    },
    null,
    2,
  ),
);

console.log('\n════ browser run ════');
console.log(`  testbed: ${reset ? 'reset before the run' : 'NOT reset (--no-reset)'}`);

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
