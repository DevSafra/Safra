/**
 * Which price pills fit on the search map, and which become dots.
 *
 * Pure, so it is tested without a map: the overlay calls it on every move with the stays already
 * projected to screen pixels.
 */
export interface PillStay {
  readonly price: string | null;
  readonly staysHere: number;
}

/** The room a price pill takes, from its text: a measured width per pill would cost a layout per frame. */
function pillBox(stay: PillStay): { width: number; height: number } {
  const characters = (stay.price ?? '').length + (stay.staysHere > 1 ? 6 : 0);
  return { width: 24 + characters * 7.5, height: 32 };
}

/**
 * Which visible stays get a pill and which a dot, in the order given: a pill is drawn unless it
 * would overlap one already drawn. Exported for the test; the map calls it on every move, and at a
 * few hundred stays the pairwise check is a few thousand comparisons, well inside a frame.
 */
export function withoutOverlaps<T extends { stay: PillStay; x: number; y: number }>(
  visible: readonly T[],
): Array<T & { dot: boolean }> {
  const boxes: Array<{ left: number; top: number; right: number; bottom: number }> = [];

  return visible.map((one) => {
    const { width, height } = pillBox(one.stay);
    const box = {
      left: one.x - width / 2 - 2,
      top: one.y - height / 2 - 2,
      right: one.x + width / 2 + 2,
      bottom: one.y + height / 2 + 2,
    };
    const covered = boxes.some(
      (other) =>
        box.left < other.right &&
        box.right > other.left &&
        box.top < other.bottom &&
        box.bottom > other.top,
    );

    if (!covered) boxes.push(box);

    return { ...one, dot: covered };
  });
}
