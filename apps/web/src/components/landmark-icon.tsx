/**
 * One drawn mark per landmark kind.
 *
 * Drawn rather than borrowed, and drawn rather than a glyph: the craft floor rules out
 * emoji or Unicode standing in for an icon set, and pulling a library in for eight marks
 * would cost more bytes than the whole distance list. They share the stroke weight and the
 * 24-unit box of `PinIcon` on the same page, so a row reads as one family.
 *
 * `currentColor` throughout, so a row decides its own tone — the list paints these at the
 * muted ink and the map's key paints them at full strength, from one component.
 */
export type LandmarkKind =
  | 'city_centre'
  | 'airport'
  | 'transit'
  | 'attraction'
  | 'beach'
  | 'shopping'
  | 'hospital'
  | 'university';

/** The paths, keyed by kind. One `d` each unless the mark genuinely needs two strokes. */
const MARKS: Record<LandmarkKind, readonly string[]> = {
  /* A crossroads inside a rounded frame — the centre of a street grid. */
  city_centre: ['M4 9h16M4 15h16M9 4v16M15 4v16', 'M3 3h18v18H3z'],
  /* A wing sweeping up and to the side. */
  airport: ['M3.5 14.5 21 9l-1 3.5-7 2.5-2.5 5-2-1 .8-3.6-3.3.9z'],
  /* A tram body on rails. */
  transit: [
    'M7 3h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z',
    'M5 10h14M9 20l-2 2M15 20l2 2M9.5 16v4M14.5 16v4',
  ],
  /* A colonnade: two columns under a pediment. */
  attraction: ['M3 9.5 12 4l9 5.5', 'M5 9.5V19M12 9.5V19M19 9.5V19M3 19h18'],
  /* A parasol over a wave. */
  beach: [
    'M12 3v9',
    'M4 12a8 8 0 0 1 16 0z',
    'M3 19c2 0 2 1.5 4.5 1.5S10 19 12 19s2 1.5 4.5 1.5S19 19 21 19',
  ],
  /* A shopping bag. */
  shopping: ['M5 8h14l-1 12H6z', 'M9 8V6a3 3 0 0 1 6 0v2'],
  /* A cross inside a rounded square. */
  hospital: ['M4 4h16v16H4z', 'M12 8.5v7M8.5 12h7'],
  /* A mortar board. */
  university: [
    'M2.5 9 12 5l9.5 4L12 13z',
    'M6.5 11v4.5c0 1.4 2.5 2.5 5.5 2.5s5.5-1.1 5.5-2.5V11',
  ],
};

/**
 * `size` is a CSS length, defaulting to the 1.25rem the address line's pin settled on.
 *
 * A rem rather than a pixel count, so the mark grows with the reader's browser font size
 * along with the words beside it — see the type-scale note in `globals.css`.
 */
export function LandmarkIcon({
  kind,
  size = '1.25rem',
  className,
}: {
  readonly kind: LandmarkKind;
  readonly size?: string;
  readonly className?: string;
}) {
  const paths = MARKS[kind] ?? MARKS.attraction;

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
