#!/usr/bin/env node
/**
 * The unit and integration run, and it refuses to be quiet about what it did not execute.
 *
 * ## Why this exists rather than `vitest run`
 *
 * `pnpm verify` is the gate this project requires before every commit, because everything lands on
 * `main` directly and there is no review branch to catch a mistake. On 2026-09-07 it printed
 * «2164 passed» and exited 0 while **1,724 tests across 128 files had not run** — 44% of the suite.
 *
 * Nothing was broken. Every integration file carries its own
 * `const describeIfDb = DATABASE_URL ? describe : describe.skip`, and `pnpm test` did not source
 * `.env`, so the whole integration layer skipped. A skipped suite is indistinguishable from a
 * passing one in that summary line, which is exactly the property Bashar asked to remove.
 *
 * It cost eleven seconds to fix: 3,888 tests pass in 30.58s with the database against 19.74s
 * without it. So this runner sources the environment and then HOLDS the result to `test-budget.json`
 * — a skip beyond the declared ceiling fails the run, and so does a suite that stopped being
 * collected at all.
 *
 * ## What makes it fail
 *
 * - Any failing test, obviously.
 * - More skipped tests than `vitest.maxSkipped` allows, each one named.
 * - Fewer tests COLLECTED than `vitest.minTests` — a file lost to a rename or a bad glob skips
 *   nothing and fails nothing; the total just drops. This is the only thing that notices.
 * - Vitest exiting non-zero for a reason that produced no report at all.
 *
 * Usage: `pnpm test` (and therefore `pnpm verify`), or `node scripts/test-run.mjs` directly.
 */
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';

const BUDGET = JSON.parse(readFileSync('test-budget.json', 'utf8')).vitest;
/* `test-reports/`, not `test-results/` — Playwright empties the latter. See `e2e-run.mjs`. */
const REPORT = 'test-reports/vitest-report.json';
const SUMMARY = 'test-reports/vitest-summary.json';

mkdirSync('test-reports', { recursive: true });
/* A stale report from a crashed run must never be read as this run's result. */
if (existsSync(REPORT)) rmSync(REPORT);

const run = spawnSync(
  'npx',
  ['vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${REPORT}`],
  { stdio: ['ignore', 'inherit', 'inherit'], env: process.env },
);

if (!existsSync(REPORT)) {
  console.error(
    '\nvitest produced no report. Treating that as a failed run rather than a pass, ' +
      'whatever the exit code says.',
  );
  process.exit(1);
}

const report = JSON.parse(readFileSync(REPORT, 'utf8'));

/*
  Flattened from the JSON reporter's own shape. `testResults` is per FILE and `assertionResults`
  per test; a file that threw during collection has a `message` and no assertions, which is why
  the file-level status is inspected too rather than only the tests inside it.
*/
const files = report.testResults ?? [];
const tests = files.flatMap((file) =>
  (file.assertionResults ?? []).map((one) => ({
    file: file.name?.replace(`${process.cwd()}/`, '') ?? '(unknown)',
    title: [...(one.ancestorTitles ?? []), one.title].join(' › '),
    status: one.status,
  })),
);

const problems = [];

const failed = tests.filter((t) => t.status === 'failed');
const skipped = tests.filter((t) => t.status === 'skipped' || t.status === 'pending');

for (const t of failed) problems.push(`FAILED  ${t.file} › ${t.title}`);

for (const file of files) {
  if (file.status === 'failed' && (file.assertionResults ?? []).length === 0) {
    problems.push(`DID NOT RUN  ${file.name} — the file failed before any test ran`);
  }
}

if (skipped.length > BUDGET.maxSkipped) {
  problems.push(
    `${skipped.length} skipped, and the budget is ${BUDGET.maxSkipped}. ` +
      'A skipped test is not a passing test — run it, or raise the budget in test-budget.json ' +
      'with the reason in the commit message.',
  );

  /* Named, grouped by file, because «1724 skipped» is a number and this is a list of work. */
  const byFile = new Map();

  for (const t of skipped) byFile.set(t.file, (byFile.get(t.file) ?? 0) + 1);

  for (const [file, n] of [...byFile.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 25)) {
    problems.push(`  skipped ${n} in ${file}`);
  }

  if (byFile.size > 25) problems.push(`  …and ${byFile.size - 25} more files`);
}

/*
  The direction a skip budget cannot see. A file that is no longer COLLECTED contributes no
  skips and no failures; the total simply falls, and every other check here stays green.
*/
if (tests.length < BUDGET.minTests) {
  problems.push(
    `${tests.length} tests collected, and the floor is ${BUDGET.minTests} — ` +
      `${BUDGET.minTests - tests.length} fewer than this suite is declared to have. ` +
      'Either a file stopped being collected, or tests were deliberately removed and ' +
      'test-budget.json needs lowering.',
  );
}

const summary = {
  at: new Date().toISOString(),
  collected: tests.length,
  passed: tests.filter((t) => t.status === 'passed').length,
  failed: failed.length,
  skipped: skipped.length,
  files: files.length,
  budget: { maxSkipped: BUDGET.maxSkipped, minTests: BUDGET.minTests },
  problems,
};

writeFileSync(SUMMARY, JSON.stringify(summary, null, 2));

console.log('\n════ unit and integration run ════');
console.log(
  `  ${summary.passed} passed · ${summary.failed} failed · ${summary.skipped} skipped ` +
    `(of ${summary.collected} collected in ${summary.files} files)`,
);
console.log(
  `  budget: at most ${BUDGET.maxSkipped} skipped, at least ${BUDGET.minTests} collected`,
);

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s):`);
  for (const line of problems.slice(0, 40)) console.error(`  ${line}`);
  if (problems.length > 40) console.error(`  …and ${problems.length - 40} more`);
  console.error(`\nWritten to ${SUMMARY}`);
  process.exit(1);
}

/* A clean report and a non-zero exit still means something went wrong that this cannot see. */
if (run.status !== 0) {
  console.error(
    `\nvitest exited ${run.status} with nothing in the report to explain it.`,
  );
  process.exit(run.status ?? 1);
}

console.log(`\nEverything ran. Written to ${SUMMARY}`);
