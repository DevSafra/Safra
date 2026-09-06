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
 * Skips are reported but do not fail — a spec that skips states its reason in the skip message, and
 * several legitimately depend on fixture state (an empty media bucket, exhausted inventory).
 *
 * ## Output
 *
 * A human summary on stdout and `test-results/e2e-summary.json` for a machine. Usage:
 *
 *     pnpm e2e:run
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';

/** In order. `setup` and `signed-in-setup` are pulled in as dependencies of these two. */
const PROJECTS = ['chromium', 'signed-in'];
const REPORT = 'test-results/e2e-report.json';
const SUMMARY = 'test-results/e2e-summary.json';

/** Every test in a Playwright JSON report, flattened out of its suite tree. */
function flatten(suite, out = []) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests ?? []) {
      const result = test.results?.[test.results.length - 1];

      out.push({
        /* The JSON report carries plain fields, not the JS API's `titlePath()`. */
        title: `${suite.title ? `${suite.title} › ` : ''}${spec.title}`,
        file: spec.file,
        status: result?.status ?? 'did-not-run',
        expected: test.expectedStatus,
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

  return { project, crashed: false, tests, exitCode: run.status };
}

mkdirSync('test-results', { recursive: true });

const results = PROJECTS.map(runProject);
const problems = [];

for (const { project, crashed, tests } of results) {
  if (crashed) {
    problems.push(`${project}: the run crashed before producing a report`);
    continue;
  }

  /* A project that produced nothing did not run, whatever the exit code says. */
  if (tests.length === 0) {
    problems.push(`${project}: produced no results — the project did not run`);
  }

  for (const test of tests) {
    if (test.status === 'failed' || test.status === 'timedOut') {
      problems.push(`${project}: FAILED ${test.title}`);
    } else if (test.status === 'interrupted' || test.status === 'did-not-run') {
      problems.push(`${project}: DID NOT RUN ${test.title}`);
    }
  }
}

const counts = Object.fromEntries(
  results.map(({ project, tests }) => [
    project,
    {
      total: tests.length,
      passed: tests.filter((t) => t.status === 'passed').length,
      failed: tests.filter((t) => t.status === 'failed' || t.status === 'timedOut').length,
      skipped: tests.filter((t) => t.status === 'skipped').length,
      didNotRun: tests.filter(
        (t) => t.status === 'interrupted' || t.status === 'did-not-run',
      ).length,
    },
  ]),
);

writeFileSync(
  SUMMARY,
  JSON.stringify({ at: new Date().toISOString(), counts, problems }, null, 2),
);

console.log('\n════ browser run ════');

for (const [project, c] of Object.entries(counts)) {
  console.log(
    `  ${project.padEnd(12)} ${c.passed} passed · ${c.failed} failed · ` +
      `${c.skipped} skipped · ${c.didNotRun} did not run  (of ${c.total})`,
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
