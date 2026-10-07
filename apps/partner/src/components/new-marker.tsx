/**
 * «رد جديد» / «بانتظار ردّك»: the row-level half of a sidebar notice (Bashar, 2026-10-07).
 *
 * The same red as the notice badge it explains, so the eye goes from «الدعم ٢» to the two rows
 * that make it up. Not a status pill: it says nothing about where the thing stands, only that it
 * is waiting on this reader, and it is gone once they have read it or answered.
 */
export function NewMarker({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-[rgba(var(--badA),0.14)] px-2 py-0.5 text-12 font-bold text-bad">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
