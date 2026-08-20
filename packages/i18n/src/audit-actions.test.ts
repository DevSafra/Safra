import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '@safra/contracts';

import { adminMessages } from './admin.js';

/**
 * Every audit action the platform can write has an Arabic label, and nothing else does.
 *
 * ## What this is here to stop happening again
 *
 * On 2026-08-20 the console's `auditAction` catalogue covered THIRTY of the seventy-three actions
 * the code emits. The other forty-three reached السجل, الموظفون and the dashboard's activity panel
 * as English prose — "auth password changed", "booking export requested", "calendar range updated" —
 * on a console that is Arabic-only by standing instruction.
 *
 * It survived every guard for one reason: `auditAction()` fell back to
 * `action.replace(/[._]/g, ' ')`, and `navigation.spec.ts` sweeps the console for SNAKE_CASE. The
 * fallback had already removed the underscore the sweep looks for, so a missing translation was
 * indistinguishable from a chosen label. Both halves are fixed — the fallback returns the raw key
 * now — and this test is the half that fails before anybody has to look at a screen.
 *
 * ## Why it asserts BOTH directions
 *
 * A missing label is the defect that shipped. An EXTRA label is the one that hides the next defect:
 * `emergency_mode.activated` and `emergency.activated` are both plausible names for the same event,
 * and the catalogue held one while the service wrote the other. A translation for an action nobody
 * emits looks like coverage and is not.
 */
describe('the console can name every audit action', () => {
  const catalogue = adminMessages('ar').auditAction;

  it('translates every declared action', () => {
    const untranslated = AUDIT_ACTIONS.filter((action) => !(action in catalogue));

    expect(
      untranslated,
      'These actions are written to audit_log with no Arabic label, so السجل will show the raw ' +
        'identifier. Add each to `auditAction` in messages/admin/ar.ts.',
    ).toEqual([]);
  });

  it('has no label for an action nothing emits', () => {
    const declared = new Set<string>(AUDIT_ACTIONS);
    const orphans = Object.keys(catalogue).filter((key) => !declared.has(key));

    expect(
      orphans,
      'These labels have no action behind them — either the name is wrong (the case that hid ' +
        '`emergency_mode.*` behind `emergency.*`) or the action was removed. Add it to ' +
        'AUDIT_ACTIONS or delete the label.',
    ).toEqual([]);
  });

  /** A label that is blank, or still Latin, is a placeholder somebody meant to come back to. */
  it('gives every action real Arabic', () => {
    const suspect = Object.entries(catalogue)
      .filter(([, value]) => value.trim().length === 0 || !/[؀-ۿ]/.test(value))
      .map(([key]) => key);

    expect(suspect, 'A label with no Arabic in it is a placeholder.').toEqual([]);
  });
});
