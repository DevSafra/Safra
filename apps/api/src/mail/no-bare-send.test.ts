import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
  A mail that fails must never fail the request it belongs to (audit 2026-10-06).

  MailService.send throws since 2026-09-06, and fourteen call sites sent AFTER their write had
  committed with nothing around the call: an SMTP failure answered 500 for a gift card that was
  bought, a staff member who was invited, a contract that was sent. Every send in the API goes
  through sendBestEffort, the notification queue, or a try/.catch of its own.

  The floor is a source sweep: `this.mail.send(` with no `.catch(` just after it and no `try {` just
  before it is a bare send.
*/
const SRC = new URL('../', import.meta.url).pathname;

/* A send whose CALLER catches, with where. Each must still be a real send, or it leaves the list. */
const CAUGHT_BY_CALLER: Record<string, string> = {
  'admin/review.service.ts':
    'notifyPartnerApproved is only called as notifyPartnerApproved(…).catch(…)',
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return entry === 'mail' ? [] : sources(path);
    return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
  });
}

const BARE = /this\.mail\s*\.send\(/g;

describe('mail sends', () => {
  it('never lets a failed send fail the request', () => {
    const offenders = sources(SRC).flatMap((file) => {
      const relative = file.slice(SRC.length);
      if (relative in CAUGHT_BY_CALLER) return [];

      const text = readFileSync(file, 'utf8');

      return [...text.matchAll(BARE)]
        .filter((match) => {
          const after = text.slice(match.index, match.index + 600);
          const before = text.slice(Math.max(0, match.index - 400), match.index);

          return !/\)\s*\.catch\(/.test(after) && !/try\s*\{/.test(before);
        })
        .map(() => relative);
    });

    expect(
      offenders,
      'A bare this.mail.send answers 500 for work that already committed. Use sendBestEffort.',
    ).toEqual([]);
  });

  it('lists only files that still send', () => {
    for (const relative of Object.keys(CAUGHT_BY_CALLER)) {
      expect(readFileSync(join(SRC, relative), 'utf8'), relative).toMatch(BARE);
    }
  });

  it('reads the API it sweeps', () => {
    expect(sources(SRC).length).toBeGreaterThan(200);
  });
});

/*
  A log line carries ids, never addresses (CLAUDE.md §1; audit 2026-10-06): the mail failure log and
  the staff-invite log both printed the recipient's email. The development branch that prints the
  whole mail when no SMTP is configured is the one exception, because it cannot run in production
  (the API refuses to boot there without SMTP_URL) and a developer needs the link in it.
*/
describe('log lines', () => {
  const EVERYWHERE = new URL('../', import.meta.url).pathname;

  function all(dir: string): string[] {
    return readdirSync(dir).flatMap((entry) => {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) return all(path);
      return entry.endsWith('.ts') && !entry.endsWith('.test.ts') ? [path] : [];
    });
  }

  it('never interpolate an email address', () => {
    const offenders = all(EVERYWHERE).flatMap((file) => {
      const text = readFileSync(file, 'utf8');

      return [
        ...text.matchAll(/logger\.(?:log|warn|error|debug|verbose)\(([\s\S]*?)\);/g),
      ]
        .filter((call) => /\$\{[^}]*(?:email|\.to)\}/i.test(call[1] ?? ''))
        .filter((call) => !(call[1] ?? '').includes('[mail:not-sent]'))
        .map(() => file.slice(EVERYWHERE.length));
    });

    expect(offenders).toEqual([]);
  });
});
