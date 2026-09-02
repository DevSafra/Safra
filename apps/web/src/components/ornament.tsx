/**
 * The eight-point star field.
 *
 * ## What it is, and why the page has one at all
 *
 * `khātim sulaymān` — two squares, one turned forty-five degrees against the other — is the unit
 * of the geometric tiling that covers the courtyards, screens and doors of every building in the
 * cities this platform sells nights in. It is the same figure as `ORNAMENT_BRAND` (۞), drawn
 * instead of typed, and §1.1's «oriental character» is the reason it is on the page.
 *
 * ## Why it exists rather than a photograph
 *
 * The hero was a photograph of a city, chosen as the first city that HAS one. Two things are wrong
 * with that and neither is fixable by choosing a different city. A destination photograph in the
 * hero says «Damascus» to somebody who came to book Aleppo; and where staff have uploaded nothing
 * — a new market, a fresh install, the day before a launch — the largest element on the first
 * screen is empty. This draws in `currentColor`, weighs nothing, cannot 404, ships no request, and
 * is the same on the first day as on the thousandth. Photography belongs to the destinations,
 * where a picture is the answer to «what is it like there»; a hero needs a SURFACE.
 *
 * ## Why it tessellates rather than sitting as one mark
 *
 * A single large ornament is a logo, and there is already a logo in the header. A field is a
 * material — it takes the size of whatever it is put behind, so the same component is the hero's
 * ground, the partner band's ground, and the back of a destination card that has no photograph
 * yet. That last use is the one that earns it: a city with no picture gets a surface that was
 * DESIGNED for it rather than the grey rectangle that reads as a page still loading.
 */

/** Half the side of the upright square. The turned square's radius follows from it. */
const R = 28;

/** The tile. Larger than the star, so the stars have air between them rather than colliding. */
const TILE = 112;

/** One star: the upright square, then the same square turned onto its corner. */
function star(cx: number, cy: number, radius: number): string {
  const d = radius * Math.SQRT2;

  return [
    `M${cx - radius} ${cy - radius}H${cx + radius}V${cy + radius}H${cx - radius}Z`,
    `M${cx} ${cy - d}L${cx + d} ${cy}L${cx} ${cy + d}L${cx - d} ${cy}Z`,
  ].join('');
}

/*
  The tile's contents, computed once at module scope.

  A star in the middle, and a quarter of a smaller one at each corner — the corners are what makes
  it a TILING rather than a grid of separate motifs, because the pattern clips them and the four
  quarters meet as one whole star across every tile boundary. They are drawn at a smaller radius
  so the join reads as the lattice BETWEEN the stars rather than as a second row of them.
*/
const TILE_PATH = [
  star(TILE / 2, TILE / 2, R),
  star(0, 0, R * 0.4),
  star(TILE, 0, R * 0.4),
  star(0, TILE, R * 0.4),
  star(TILE, TILE, R * 0.4),
].join('');

/**
 * A field of stars filling whatever box it is placed in.
 *
 * `id` is REQUIRED and has no default. An SVG `<pattern>` is referenced by a document-wide id, and
 * two of these on one page under one id is not a duplicate-key warning — it is the second field
 * silently painting the first one's pattern. The home page renders three, so the collision is not
 * hypothetical.
 *
 * `aria-hidden` and `pointer-events-none` are fixed rather than props: it is texture, it says
 * nothing a screen reader should hear, and it must never take a click meant for the search bar
 * lying over it.
 */
export function OrnamentField({
  id,
  className = '',
}: {
  id: string;
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      className={`pointer-events-none absolute inset-0 size-full ${className}`}
      /*
        No `viewBox`. The pattern is sized in USER SPACE, so without one the tile keeps a constant
        112px wherever this is rendered — the stars stay the same size in a 260px card and across a
        1440px hero, which is what a material does. A `viewBox` would scale the tile with the box
        and make the card's ornament a magnified crop of the hero's.
      */
      preserveAspectRatio="none"
    >
      <defs>
        <pattern
          id={id}
          width={TILE}
          height={TILE}
          patternUnits="userSpaceOnUse"
          /*
            Half a tile of offset. The tiling is symmetric about both axes, so without it the
            pattern's origin lands a full star exactly in the top-left corner of every box it
            fills — which reads as an element that has been positioned rather than as a surface
            that continues past its own edges.
          */
          patternTransform={`translate(${TILE / 2} ${TILE / 2})`}
        >
          <path
            d={TILE_PATH}
            fill="none"
            stroke="currentColor"
            strokeWidth="1"
            /*
              The turned square crosses the upright one eight times. `round` keeps those crossings
              from growing a hard corner at the sub-pixel widths this is drawn at.
            */
            strokeLinejoin="round"
          />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}
