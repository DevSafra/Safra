import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { NOTIFICATION_TEMPLATES } from './notification-templates.js';

/**
 * A template may only claim to be implemented if something actually sends it.
 *
 * ## The defect this holds shut
 *
 * `implemented` is documented as "whether the send path is implemented today", and سجل القوالب
 * renders it to staff. Three entries claimed `true` with no send path anywhere — `booking.invoice`
 * has no template at all, `wallet.compensation` names a mail that was folded into another, and
 * `partner.deadline_reminder` describes a second nudge nobody wrote. Found by the final booking
 * audit on 2026-08-25, not by any test, because a boolean in a list agrees with whatever it says.
 *
 * That is the shape this codebase keeps meeting: **built, green, and connected to nothing**, with
 * a flag asserting otherwise. A claim about the code has to be checked against the code.
 *
 * ## Why it reads the SOURCE
 *
 * The keys are string literals passed to `NotificationService.notify`, so there is no symbol to
 * import and no registry to enumerate — the binding between a catalogue entry and its sender is
 * the literal itself. Grepping for it is what "does anything send this?" actually means here.
 *
 * A floor, not a ceiling: a key assembled at runtime would be invisible to this, as would a call
 * site that is dead code. Both are worse problems than the one being prevented.
 */
const SOURCE_ROOTS = ['apps/api/src'];

/** From `apps/api/src/admin` up to the repository root. */
const REPO = join(import.meta.dirname, '..', '..', '..', '..');

describe('the notification catalogue', () => {
  const source = readSource();

  it('never claims a template is implemented when nothing sends it', () => {
    const lying = NOTIFICATION_TEMPLATES.filter(
      (template) => template.implemented && !sends(source, template.key),
    ).map((template) => template.key);

    expect(
      lying,
      'These are marked implemented and no notify() call sends them. ' +
        'Either wire the send path or set implemented: false.',
    ).toStrictEqual([]);
  });

  /**
   * The opposite control, and the reason the test above means anything.
   *
   * If `sends()` matched nothing — a changed call shape, a bad path, a regex that quietly stopped
   * working — the assertion above would pass for every entry in the catalogue and report perfect
   * health. So at least one key must be found, and it is asserted by NAME: `booking.confirmed` is
   * the most important message the platform sends and it is sent through `notify`.
   */
  it('can actually find a send path, so the check above can fail', () => {
    expect(sends(source, 'booking.confirmed'), 'booking.confirmed is sent').toBe(true);
    expect(sends(source, 'booking.refunded'), 'booking.refunded is sent').toBe(true);
    /*
      And a key nothing sends is NOT found, so the matcher is not simply saying yes.

      This named `booking.invoice` until that mail was built — the control has to point at
      something genuinely unsent, and swapping it when the gap closes is the maintenance this kind
      of assertion costs. `partner.deadline_reminder` is the remaining one: §6.3 step 5's FIRST
      notice is sent as `booking.needs_action`, and a second nudge mid-window does not exist.
    */
    expect(
      sends(source, 'partner.deadline_reminder'),
      'partner.deadline_reminder is not',
    ).toBe(false);
  });

  /** Every entry marked unimplemented is a real gap somebody can look up. */
  it('leaves the unimplemented ones in the list rather than deleting them', () => {
    const pending = NOTIFICATION_TEMPLATES.filter((t) => !t.implemented);

    expect(pending.length, 'the catalogue still names what is missing').toBeGreaterThan(
      0,
    );
  });
});

/** Does any source file pass this key to `notify`? */
function sends(source: string, key: string): boolean {
  /*
    The key as a quoted literal, followed by a comma — the first argument to `notify`. Matching the
    bare string would find the catalogue's own entry and every comment that mentions it, which
    would make this test say yes to everything.
  */
  return new RegExp(`notify\\(\\s*(?:/\\*[\\s\\S]*?\\*/\\s*)?'${key}'\\s*,`).test(source);
}

/** Every non-test TypeScript file under the API, concatenated. */
function readSource(): string {
  const files = execFileSync(
    'git',
    ['ls-files', ...SOURCE_ROOTS.map((root) => `${root}/**/*.ts`)],
    { cwd: REPO, encoding: 'utf8' },
  )
    .split('\n')
    .filter((path) => path !== '' && !path.includes('.test.'));

  expect(files.length, 'the sweep found source to read').toBeGreaterThan(50);

  return files.map((path) => readFileSync(join(REPO, path), 'utf8')).join('\n');
}
