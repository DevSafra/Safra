/**
 * A landmark's mark, drawn from PATH DATA the platform stores.
 *
 * ## It used to be a lookup table in this file
 *
 * Eight kinds, eight hard-coded shapes, keyed by a `pgEnum`. Bashar closed that on 2026-09-23:
 * landmark kinds are managed in the console, and a kind staff can add whose icon they cannot
 * choose would render as a blank glyph — a capability with nothing behind it, which the craft
 * floor and this codebase both treat as worse than not having it.
 *
 * So the marks arrive with the data. `landmark_kinds.icon_paths` holds one `d` attribute per
 * stroke, and this draws them at the page's own stroke weight so a kind added today looks like
 * one shipped in the seed.
 *
 * ## Why this is not an XSS hole
 *
 * The value is operator-supplied and reaches a public page, so it is worth being explicit. Two
 * independent reasons it cannot execute:
 *
 * - React sets `d` as an ATTRIBUTE. It parses no markup, so the string can never become an
 *   element however it is shaped.
 * - `landmarkIconPathSchema` restricts it at the API boundary to the SVG path alphabet, which
 *   contains no `<`, quote, `&`, `(` or `:`. The value cannot form markup or a `url()` even if
 *   some future caller interpolated it somewhere careless.
 *
 * `landmark-icon-safety.test.ts` holds the second one to account with the payloads that would
 * matter. There is deliberately no `dangerouslySetInnerHTML` anywhere near this.
 */

/**
 * `size` is a CSS length, defaulting to the 1.25rem the address line's pin settled on.
 *
 * A rem rather than a pixel count, so the mark grows with the reader's browser font size
 * along with the words beside it — see the type-scale note in `globals.css`.
 */
export function LandmarkIcon({
  paths,
  size = '1.25rem',
  className,
}: {
  /** One `d` attribute per stroke, from `landmark_kinds.icon_paths`. */
  readonly paths: readonly string[];
  readonly size?: string;
  readonly className?: string;
}) {
  /*
    A kind with no marks draws NOTHING rather than a placeholder. An icon standing in for
    «somebody has not finished configuring this» is a shape a reader tries to interpret.
  */
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
      /*
        Decorative: every row states the place's name and its kind in words beside this, so
        announcing the mark as well would read the row twice.
      */
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
