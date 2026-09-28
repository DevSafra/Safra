'use client';

/**
 * «+ إضافة …» — the one add button (Bashar, 2026-09-28).
 *
 * ## Why this exists
 *
 * There were three of them. Eight panels used an outlined gold button; المعالم used a SOLID gold
 * fill; its own «إضافة فئة» beside it used a plain neutral outline. Three answers to one question,
 * two of them on the same screen — which is the shape `StatusPill`, `PasswordField`, `ImageSlider`
 * and `useConfirm` each exist to close. A control that means «add a row here» must look the same
 * everywhere or it stops meaning that.
 *
 * The outlined treatment won because it was already the majority, and because it is the right one:
 * a solid gold fill is the strongest emphasis this palette has, and «add an amenity» is not the
 * most important thing on any screen it appears on. Reserving the fill keeps it worth something.
 *
 * ## The press state is not decoration
 *
 * A button that does not answer the press feels broken on a touch screen, where there is no hover
 * to confirm the finger landed — and the console is used on a tablet. 160ms is fast enough to read
 * as the control responding rather than as an animation. Tailwind v4 already wraps `hover:` in
 * `@media (hover: hover)`, so the hover tint cannot stick on a phone after a tap.
 */
export function AddButton({
  label,
  onClick,
  expanded,
  attribute,
}: {
  readonly label: string;
  readonly onClick: () => void;
  /** Whether the form it opens is showing, for `aria-expanded`. */
  readonly expanded?: boolean | undefined;
  /** A `data-*` name the browser sweep uses to find this one button. */
  readonly attribute?: string | undefined;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      {...(expanded === undefined ? {} : { 'aria-expanded': expanded })}
      {...(attribute ? { [attribute]: true } : {})}
      className="inline-flex min-h-10 cursor-pointer items-center rounded-lg border border-[rgba(var(--goldA),0.4)] px-3.5 py-1.5 text-13 font-bold text-gold-read transition-[background-color,border-color,transform] duration-150 ease-out hover:bg-[rgba(var(--goldA),0.08)] active:scale-[0.97] lg:min-h-0"
    >
      {label}
    </button>
  );
}
