import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { isRedrivable } from './notification-redrive.service.js';

/**
 * Every email the platform records in `notifications` has somewhere for a re-drive to send it.
 *
 * ## Why this reads the source
 *
 * The re-drive used to choose a link with a conditional whose last branch was the customer's
 * reviews page, and every template it did not name went there — twelve of sixteen. The table that
 * replaced it refuses an unknown template rather than guessing, which is the safe failure; this
 * makes the next template somebody adds fail HERE instead of reaching a stranded row in production
 * that the sweep can only report.
 *
 * The keys are string literals passed to `notify`, and the enforcement notices pass theirs to a
 * private `send`, so there is no registry to enumerate — the literal is the binding, as
 * `notification-catalogue.test.ts` explains for the same reason.
 */
const REPO = join(import.meta.dirname, '..', '..', '..', '..');

describe('the notification re-drive', () => {
  const keys = sentKeys();

  it('has a destination for every template the platform sends', () => {
    expect(keys.filter((key) => !isRedrivable(key))).toStrictEqual([]);
  });

  /** The opposite control: the sweep found the senders, so the check above can fail. */
  it('can find the templates it is checking', () => {
    expect(keys).toContain('booking.needs_action');
    expect(keys).toContain('partner.fined');
    expect(keys.length).toBeGreaterThanOrEqual(18);
    expect(isRedrivable('redrive.test.unknown')).toBe(false);
  });
});

/** Every key passed to `notify(…)` or to the enforcement notifier's `send(…)`. */
function sentKeys(): string[] {
  const source = execFileSync('git', ['ls-files', 'apps/api/src/**/*.ts'], {
    cwd: REPO,
    encoding: 'utf8',
  })
    .split('\n')
    .filter((path) => path !== '' && !path.includes('.test.'))
    .map((path) => readFileSync(join(REPO, path), 'utf8'))
    .join('\n');

  const patterns = [
    /notify\(\s*(?:\/\*[\s\S]*?\*\/\s*)?'([a-z_]+\.[a-z_.]+)'\s*,/g,
    /this\.send\(\s*actor,\s*partnerId,\s*'([a-z_]+\.[a-z_.]+)'/g,
  ];

  const found = new Set<string>();

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      if (match[1]) found.add(match[1]);
    }
  }

  return [...found].sort();
}
