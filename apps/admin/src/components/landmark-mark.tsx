/**
 * A landmark kind's mark, drawn from the path data the platform stores.
 *
 * ## Why an operator-supplied string is safe here
 *
 * `icon_paths` is edited in this console and rendered on the customer site, so it is worth
 * being explicit rather than implicitly careful. Two independent reasons it cannot execute:
 *
 * - React sets `d` as an ATTRIBUTE. It parses no markup, so the value can never become an
 *   element however it is shaped.
 * - `landmarkIconPathSchema` restricts it at the API boundary to the SVG path alphabet, which
 *   contains no `<`, quote, `&`, `(` or `:` — so the string cannot form markup or a `url()`
 *   even if a future caller interpolated it somewhere careless.
 *
 * `landmark-icon-safety.test.ts` holds the second to account with the payloads that would
 * matter. There is deliberately no `dangerouslySetInnerHTML` anywhere near this, and a mark
 * that is being TYPED is drawn through this same component — the preview and the shipped icon
 * are the same code, so what an operator sees while editing is what a guest gets.
 */
export function LandmarkMark({
  paths,
  size = '1.25rem',
  className,
}: {
  readonly paths: readonly string[];
  readonly size?: string;
  readonly className?: string;
}) {
  if (paths.length === 0) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d, index) => (
        /*
          Keyed on the INDEX and the path together. Two identical strokes in one icon are
          legitimate — a symmetrical mark drawn twice — so the path alone is not unique, and
          the index alone would remount every stroke when one is edited above it.
        */
        <path key={`${String(index)}:${d}`} d={d} />
      ))}
    </svg>
  );
}
