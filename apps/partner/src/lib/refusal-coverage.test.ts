import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Every component in لوحة الشريك that WRITES can say «الحساب موقوف» when that is why it failed.
 *
 * ## What goes wrong without this
 *
 * A suspended partner is a live session refused on every write (Bashar, 2026-08-24), and
 * `SuspendedPartnerGuard` is opt-in per route on the API — so the set of refusing routes grows
 * without the portal being touched. A component that never consults `refusalFor` renders its own
 * `default:` sentence instead: «تعذّر الحفظ», a generic failure for a state the reader can see the
 * reason for at the top of the same screen. They retry, get the same nothing, and open a support
 * ticket to ask a question their own screen could have answered.
 *
 * There is no failing request and no console error — the write really did fail, and the component
 * really did say so. Only the WORDING is wrong, which is the kind of defect nobody finds by using
 * the product briefly and nobody's type checker finds at all.
 *
 * ## Why a directory walk rather than a list
 *
 * The same argument as `gate-coverage.test.ts` in the console: a list is a thing somebody maintains
 * and a walk is a thing that maintains itself. The next write component is the one nobody remembers
 * to add.
 *
 * ## What this canNOT see
 *
 * That the refusal is consulted BEFORE the component's own vocabulary rather than after. A
 * substring search cannot tell where in a function a call sits, and `refusalFor` placed under a
 * `default:` would never be reached. That half is held by reading the diff and by the browser spec,
 * not by this file — said here so a green run is not read as proving it.
 */
const COMPONENTS = join(import.meta.dirname, '..', 'components');

/**
 * Components that write and must NOT need the suspension sentence, each with its reason.
 *
 * All four are things a suspended partner is explicitly ALLOWED to do: Bashar's rule is that they
 * may sign in, reach their account and read why. A refusal sentence on any of these would describe
 * a refusal that never happens — and if one ever did, saying "your account is suspended" to
 * somebody who cannot yet sign in would be worse than the generic message.
 *
 * A path here is a decision, not an oversight, which is the point of writing the reason beside it.
 */
const EXEMPT: Readonly<Record<string, string>> = {
  'partner-login-form.tsx':
    'Signing in is permitted while suspended — the whole point of the policy is that they can ' +
    'reach the portal and read the reason.',
  'two-factor-enrolment.tsx':
    'Enrolment is part of signing in, and a suspended partner must be able to complete it or ' +
    'they cannot reach the account they are being told about.',
  'invitation-form.tsx':
    'Redeems the invitation that CREATES the partner account. There is no account to suspend ' +
    'yet, so the refusal cannot arise.',
  'employee-invitation-form.tsx':
    'Redeems an employee invitation and runs before that employee has a session at all; the ' +
    'employer being suspended is refused at the invite, not here.',
};

/** A component that sends anything other than a GET. */
function writes(source: string): boolean {
  return /method:\s*'(POST|PUT|PATCH|DELETE)'/.test(source);
}

/**
 * Satisfied by `refusalFor`, or by `errorMessage` — which resolves the code through the shared
 * error catalogue and so renders the same sentence.
 *
 * Accepting both matters: `support-form.tsx` and `support-close.tsx` already routed every code
 * through `errorMessage` before any of this existed, and were correct the day the code was added.
 * A test that demanded the newer helper would have sent somebody to rewrite two working components
 * to satisfy it.
 */
function handles(source: string): boolean {
  return source.includes('refusalFor') || source.includes('errorMessage');
}

describe('the partner portal suspension refusal', () => {
  const files = readdirSync(COMPONENTS).filter((name) => name.endsWith('.tsx'));

  /** If the walk breaks, every assertion below passes while checking nothing. */
  it('finds the write components', () => {
    const writing = files.filter((name) =>
      writes(readFileSync(join(COMPONENTS, name), 'utf8')),
    );

    expect(writing.length).toBeGreaterThanOrEqual(15);
    expect(writing).toContain('property-editor.tsx');
    expect(writing).toContain('booking-decision.tsx');
  });

  it('is consulted by every write component that is not exempt', () => {
    const missing = files.filter((name) => {
      if (name in EXEMPT) return false;

      const source = readFileSync(join(COMPONENTS, name), 'utf8');

      return writes(source) && !handles(source);
    });

    expect(
      missing,
      'These components write, so the API can refuse them because the account is suspended — and ' +
        'they would render a generic failure for a state the partner can see the reason for on ' +
        'the same screen. Consult `refusalFor` before the component’s own message, or add the ' +
        'file to EXEMPT in this test WITH the reason it can never be refused that way.',
    ).toEqual([]);
  });

  /** An exemption that covers a component which handles it anyway has stopped describing anything. */
  it('does not exempt a component that handles it anyway', () => {
    const redundant = Object.keys(EXEMPT).filter((name) =>
      handles(readFileSync(join(COMPONENTS, name), 'utf8')),
    );

    expect(redundant).toEqual([]);
  });

  /** An exemption for a file that no longer exists is a reason nobody will re-examine. */
  it('has no exemption for a component that was deleted', () => {
    expect(Object.keys(EXEMPT).filter((name) => !files.includes(name))).toEqual([]);
  });

  /** A path with nothing beside it is a list of things somebody skipped. */
  it('gives every exemption a reason', () => {
    const unexplained = Object.entries(EXEMPT)
      .filter(([, reason]) => reason.trim().length < 40)
      .map(([name]) => name);

    expect(unexplained).toEqual([]);
  });
});
