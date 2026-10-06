/** One room type on a booking, and how many of it. */
export interface BasketLine {
  readonly unitId: string;
  readonly rooms: number;
}

/**
 * The basket with each unit named once, its quantities added, in the order first named.
 *
 * ## Why merged rather than refused
 *
 * «مزدوجة × 1» twice is unambiguously «مزدوجة × 2», so refusing it would only make the guest do
 * the arithmetic. What must not happen is what used to: pricing summed both lines while the
 * allocator, which excludes this booking's own rooms from "taken", handed the second line the
 * room the first already held. The guest paid for two rooms and held one.
 *
 * One function for both pricing and creation, because the two must agree on what the basket IS
 * or the price and the held rooms drift apart again.
 */
export function mergeBasketLines(lines: readonly BasketLine[]): BasketLine[] {
  const merged = new Map<string, number>();

  for (const line of lines) {
    const rooms = Math.max(1, Math.trunc(line.rooms));

    merged.set(line.unitId, (merged.get(line.unitId) ?? 0) + rooms);
  }

  return [...merged].map(([unitId, rooms]) => ({ unitId, rooms }));
}
