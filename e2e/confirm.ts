import { expect, type Page } from '@playwright/test';

import { ar as t } from '../packages/i18n/src/messages/admin/ar.js';

/**
 * Accepts the console's confirmation popup — and WAITS for it, rather than guessing.
 *
 * ## The race this replaces
 *
 * Three journey specs did this:
 *
 * ```ts
 * const dialog = page.getByRole('alertdialog');
 * if (await dialog.isVisible().catch(() => false)) {
 *   await dialog.getByRole('button', { name: 'تأكيد' }).click();
 * }
 * ```
 *
 * `isVisible()` is an INSTANT check with no waiting, and `useConfirm()`'s dialog has an entrance
 * animation because the craft floor asks for one. So the answer depends on whether the frame had
 * painted yet — on a fast machine it is there, on a loaded one it is not, and when it is not the
 * `if` quietly skips the confirmation, the action never happens, and the spec fails twenty seconds
 * later on a status that never changed. That is the shape of an environment-dependent failure:
 * nothing in the product is wrong and the run is red anyway.
 *
 * **And the dialog is not optional.** `confirmThenCapture` always calls `ask()`, so a spec that
 * treats the popup as «maybe» is wrong about the product as well as unstable. This asserts it,
 * which turns a silent skip into a named failure.
 *
 * ## Why it cannot NAME the confirm button
 *
 * The specs clicked «تأكيد», and so did the first version of this helper. **That word is not on
 * the button.** `useConfirm()` requires every caller to pass its own `confirmLabel` — «Every word
 * is the caller's … required, never defaulted», because «OK» living in a shared package is the bug
 * that rule replaced — so the capture dialog reads «نعم، وصلت الحوالة» and the next one reads
 * something else. A shared helper that names the confirm word is wrong for every caller but one.
 *
 * What IS section-neutral is the CANCEL: each app keeps one «إلغاء» for every dialog it draws — the
 * console at `sections.dialog.cancel`, the portal at `dialog.cancel`, the same word in both. The
 * popup holds exactly two buttons, so «the one that is not cancel» identifies the confirm without
 * knowing what it says, and keeps working when a caller rewords its own.
 *
 * ## It is needed on the PORTAL too
 *
 * A partner accepting a booking meets a confirmation as well — `booking-decision.tsx` asks before
 * it posts, naming the nights and the money it commits them to. Three journey specs clicked «قبول»
 * and then waited for `POST …/decision`, so they waited on a request the popup was still holding
 * back. Both apps draw the same dialog from `packages/ui`, so one helper serves both.
 */
export async function acceptConfirm(page: Page): Promise<void> {
  const dialog = page.getByRole('alertdialog');

  await expect(dialog, 'the console asks before it acts').toBeVisible();

  /*
    EXACT, not substring. `hasNotText` matches anywhere in the button, and «تأكيد الإلغاء» — the
    confirm on a gift-card cancellation — contains «إلغاء». A substring filter would drop BOTH
    buttons and the count assertion below would then fail on a dialog that is perfectly well
    formed. Anchoring excludes only the button whose whole name IS the cancel word.
  */
  const cancel = t.sections.dialog.cancel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const confirm = dialog
    .getByRole('button')
    .filter({ hasNotText: new RegExp(`^\\s*${cancel}\\s*$`) });

  await expect(confirm, 'the popup offers exactly one way to go ahead').toHaveCount(1);
  await confirm.click();
  await expect(dialog, 'and the popup closes once confirmed').toBeHidden();
}
