/**
 * Which of the bar's controls can actually do something.
 *
 * ## Why this is a function and not three expressions in the component
 *
 * Bashar asked for the dead controls to be deactivated (2026-08-25), and the interesting part is
 * not the `disabled` attribute — it is deciding WHICH controls are dead, because the two conditions
 * are different and the tempting answer collapses them into one.
 *
 * A browser test can prove the attribute reaches the DOM, and does. It cannot reliably reach the
 * case that matters most here — a table of twenty-five rows displayed at a hundred — because that
 * depends on how many rows the development database happens to hold, and a spec that hunts for a
 * qualifying table SKIPS when it finds none. A skipped assertion reports coverage it does not have.
 * So the decision lives here, where it can be asked directly.
 */
export type BarState = {
  /** One page, so the page number has exactly one legal value and both arrows are already dead. */
  readonly onlyPage: boolean;
  /** Every offered size would show the same rows, so the select has nothing to choose between. */
  readonly sizeIsMoot: boolean;
  /** تطبيق submits both controls, so it is useless only when NEITHER can do anything. */
  readonly nothingToApply: boolean;
};

export function barState({
  pages,
  total,
  capped,
  smallestSize,
}: {
  readonly pages: number;
  readonly total: number;
  /** True when the count stopped at `COUNT_CAP`, so `total` is a floor rather than a figure. */
  readonly capped: boolean;
  /** The smallest size the select offers — below it, every option is the same screen. */
  readonly smallestSize: number;
}): BarState {
  const onlyPage = pages <= 1;

  /*
    NOT `onlyPage`.

    A twenty-five-row table shown at a hundred is also one page, and there the select is the only way
    back down to something scannable — الحجوزات filtered to a handful of cancellations, or سجل
    التدقيق after somebody set a hundred rows last month. Disabling it there would take away the one
    control that still works, on the reasoning that the OTHER one does not.

    A capped total is at least `COUNT_CAP`, far above any offered size, so it can never be moot —
    and it must be checked, because `total` is a floor when `capped` is true and comparing a floor
    against a size would be comparing the wrong number.
  */
  const sizeIsMoot = !capped && total <= smallestSize;

  return { onlyPage, sizeIsMoot, nothingToApply: onlyPage && sizeIsMoot };
}
