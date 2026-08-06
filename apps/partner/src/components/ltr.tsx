/**
 * A Latin run inside an RTL line — a reference, an email, a figure.
 *
 * `dir="ltr"` with `text-align: right` is the handoff's own rule (§4.1). Without it the
 * bidirectional algorithm reorders `PRO-000102` or moves a leading `+` to the wrong end. The
 * console carries the same component; it is duplicated rather than shared because it is four lines
 * and moving it to `@safra/ui` would be the third place to look for it.
 */
export function Ltr({ children }: { readonly children: React.ReactNode }) {
  return (
    <span dir="ltr" className="inline-block text-end">
      {children}
    </span>
  );
}
