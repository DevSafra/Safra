/**
 * «رد جديد» / «تحديث جديد»: the row-level half of a sidebar notice (Bashar, 2026-10-07).
 *
 * The same colour as the notice badge it explains, so the eye goes from «الدعم ٢» to the two rows
 * that make it up. Not a `StatusPill`: it says nothing about where the thing stands, only that it
 * changed since this reader last looked, and it is gone on their next visit.
 */
export function NewMarker({ label }: { readonly label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-bad/12 px-2 py-0.5 text-12 font-bold text-bad">
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
