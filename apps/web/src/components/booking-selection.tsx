'use client';

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { MAX_BASKET_ROOMS } from '@/lib/basket-limits';

/**
 * One room TYPE a guest may put in the basket.
 *
 * Everything here is plain data. A server component may not hand a client one a function, and the
 * words — the type's name, its policy, its facilities — are already resolved by the page that knows
 * the reader's language.
 */
export interface BasketRoom {
  readonly unitId: string;
  readonly name: string;
  /** What ONE room of this type sleeps. Multiplied by the quantity for the basket's capacity. */
  readonly maxGuests: number;
  readonly minNights: number;
  /** How many of this type are free for the stay — the ceiling on this line's quantity. */
  readonly maxRooms: number;
  /**
   * Whole-stay accommodation for ONE room, in the unit's OWN currency, as a decimal string.
   *
   * The unit's currency rather than the reader's, because that is the figure the API prices in and
   * the one a total has to be built from. Converting each line separately and adding the results
   * would round three times and disagree with the charge.
   */
  readonly perRoomAmount: string;
  readonly currencyCode: string;
  readonly policyText: string;
  readonly amenities: readonly { readonly code: string; readonly name: string }[];
}

/** One line of the basket: a type, and how many of it. */
export interface BasketLine {
  readonly room: BasketRoom;
  readonly rooms: number;
}

/* Re-exported for the components that already import it from here. See `basket-limits.ts`. */
export { MAX_BASKET_ROOMS };

interface Basket {
  readonly lines: readonly BasketLine[];
  /** Total rooms across every line. */
  readonly rooms: number;
  /** What the whole basket sleeps — each type's capacity times its quantity. */
  readonly capacity: number;
  /** Adds one room of this type, or one more if it is already in the basket. */
  readonly add: (room: BasketRoom) => void;
  readonly setRooms: (unitId: string, rooms: number) => void;
  readonly remove: (unitId: string) => void;
  readonly clear: () => void;
  /** How many of this type are in the basket. Zero when it is not. */
  readonly countOf: (unitId: string) => number;
  /** Whether another room may be added at all — the basket ceiling. */
  readonly hasRoom: boolean;
}

const BasketContext = createContext<Basket | null>(null);

/**
 * The property page's booking basket, held in one place.
 *
 * ## Why a context rather than props
 *
 * The room list and the summary card are on opposite sides of the page and inside different server
 * subtrees — the list is in the main column, the card is in the aside. A choice made in one has to
 * appear in the other immediately. Threading a setter through the server component between them is
 * not possible; a client boundary around both is.
 *
 * ## It ACCUMULATES
 *
 * The first version held one room and replaced it, so «مزدوجة × 2 + جناح × 1» — a family needing
 * two rooms and a suite — was two bookings, two payments and two vouchers. Adding a second type
 * silently discarded the first, which is worse than refusing it: the guest had no way to see what
 * they had lost.
 *
 * ## It holds the WHOLE room, not an id
 *
 * The summary states each type's name, capacity, policy, facilities and subtotal. Holding only ids
 * would mean the card looking each of those up again — a second source for figures the row has
 * already computed with the currency converted — and two places deriving one price is how they
 * come to disagree.
 */
/**
 * Where one property's basket is remembered, and for which stay.
 *
 * Per PROPERTY, because a basket holds rooms of one hotel — restoring it on another hotel's page
 * would offer a guest rooms that are not there. Per STAY as well, because the amounts in it are
 * whole-stay figures: a basket built for two nights, restored onto a four-night page, would price
 * the wrong trip.
 */
function storageKey(propertySlug: string, stay: StayKey): string {
  return `safra.basket.${propertySlug}.${stay.checkIn}.${stay.checkOut}`;
}

/** The stay a basket belongs to. */
export interface StayKey {
  readonly checkIn: string;
  readonly checkOut: string;
}

/** What is actually STORED: the choice, never the money. See `BookingSelectionProvider`. */
interface StoredLine {
  readonly unitId: string;
  readonly rooms: number;
}

/** Whatever was in storage, believed only as far as its shape. */
function storedLines(raw: string | null): readonly StoredLine[] {
  if (raw === null) return [];

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((entry: unknown) => {
      if (typeof entry !== 'object' || entry === null) return [];

      const { unitId, rooms } = entry as { unitId?: unknown; rooms?: unknown };

      if (typeof unitId !== 'string' || unitId === '') return [];
      if (typeof rooms !== 'number' || !Number.isInteger(rooms) || rooms < 1) return [];

      return [{ unitId, rooms }];
    });
  } catch {
    /* Unreadable is EMPTY, never a throw: a corrupt entry must not take the page down with it. */
    return [];
  }
}

export function BookingSelectionProvider({
  children,
  propertySlug,
  stay,
  available,
}: {
  readonly children: ReactNode;
  readonly propertySlug: string;
  readonly stay: StayKey;
  /**
   * The types this page is currently offering, with THIS stay's prices.
   *
   * The basket is rebuilt from these on restore rather than from anything stored, which is the
   * whole design — see the provider's note.
   */
  readonly available: readonly BasketRoom[];
}) {
  const [lines, setLines] = useState<readonly BasketLine[]>([]);

  /*
    ── Surviving a reload (Bashar, 2026-09-14) ───────────────────────────────

    Only `{unitId, rooms}` is stored — the CHOICE. Never `BasketRoom`, which carries whole-stay
    amounts, capacity, the policy sentence and the facilities: those are this render's figures for
    this stay, and a stored copy would come back stale the moment a price, a policy or availability
    moved. Restoring rebuilds each line from `available`, so the money on screen is always the money
    this page just computed.

    What that buys, beyond freshness: a type that has since sold out simply does not come back, and
    a quantity larger than what is now free is clamped to it rather than being offered and refused
    at checkout.

    In an EFFECT, so the server and the first client render agree on an empty basket; reading
    storage during render is a hydration mismatch. The cost is one frame with the basket empty,
    which is invisible next to the page's own load.
  */
  useEffect(() => {
    const raw = (() => {
      try {
        return window.localStorage.getItem(storageKey(propertySlug, stay));
      } catch {
        /* Private windows, blocked site data, a browser that throws on access. Not an error. */
        return null;
      }
    })();

    const remembered = storedLines(raw);

    if (remembered.length === 0) return;

    const byId = new Map(available.map((room) => [room.unitId, room]));
    let taken = 0;

    const restored = remembered.flatMap<BasketLine>((line) => {
      const room = byId.get(line.unitId);

      /* Gone from this page — sold out, withdrawn, or too short a stay for it now. */
      if (!room) return [];

      const ceiling = Math.min(room.maxRooms, MAX_BASKET_ROOMS - taken);

      if (ceiling < 1) return [];

      const rooms = Math.min(line.rooms, ceiling);

      taken += rooms;

      return [{ room, rooms }];
    });

    if (restored.length > 0) setLines(restored);
    /*
      ONCE, on mount — the empty list is deliberate and not an oversight.

      `available` is a fresh array on every render of the server component above this one, so
      depending on it would re-run the restore and overwrite whatever the guest has since chosen.
      `propertySlug` and `stay` are equally fixed for the life of this page: a change to either
      arrives as a navigation, which mounts a new provider.
    */
  }, []);

  /* Written on every change, including the change that empties it — «إفراغ السلّة» must stick. */
  useEffect(() => {
    const key = storageKey(propertySlug, stay);

    try {
      if (lines.length === 0) {
        window.localStorage.removeItem(key);

        return;
      }

      window.localStorage.setItem(
        key,
        JSON.stringify(
          lines.map<StoredLine>((line) => ({
            unitId: line.room.unitId,
            rooms: line.rooms,
          })),
        ),
      );
    } catch {
      /* Storage full or refused. The basket still works for this visit; it just will not outlive it. */
    }
    /* The VALUES, not the object: a server component hands down a fresh `stay` every render. */
  }, [lines, propertySlug, stay.checkIn, stay.checkOut]);

  const value = useMemo<Basket>(() => {
    const rooms = lines.reduce((sum, line) => sum + line.rooms, 0);

    return {
      lines,
      rooms,
      capacity: lines.reduce((sum, line) => sum + line.room.maxGuests * line.rooms, 0),

      add: (room: BasketRoom) =>
        setLines((current) => {
          const taken = current.reduce((sum, line) => sum + line.rooms, 0);

          if (taken >= MAX_BASKET_ROOMS) return current;

          const existing = current.find((line) => line.room.unitId === room.unitId);

          if (!existing) return [...current, { room, rooms: 1 }];

          /* Already there: one MORE, capped by what the hotel has free of this type. */
          return current.map((line) =>
            line.room.unitId === room.unitId
              ? { ...line, rooms: Math.min(line.rooms + 1, line.room.maxRooms) }
              : line,
          );
        }),

      /*
        Clamped HERE rather than at the control, so no caller can put the basket out of range —
        and setting a line to zero REMOVES it, because a line of nothing is not a line.
      */
      setRooms: (unitId: string, next: number) =>
        setLines((current) => {
          if (next <= 0) return current.filter((line) => line.room.unitId !== unitId);

          const others = current
            .filter((line) => line.room.unitId !== unitId)
            .reduce((sum, line) => sum + line.rooms, 0);

          return current.map((line) => {
            if (line.room.unitId !== unitId) return line;

            const ceiling = Math.min(line.room.maxRooms, MAX_BASKET_ROOMS - others);

            return { ...line, rooms: Math.max(1, Math.min(next, ceiling)) };
          });
        }),

      remove: (unitId: string) =>
        setLines((current) => current.filter((line) => line.room.unitId !== unitId)),

      clear: () => setLines([]),

      countOf: (unitId: string) =>
        lines.find((line) => line.room.unitId === unitId)?.rooms ?? 0,

      hasRoom: rooms < MAX_BASKET_ROOMS,
    };
  }, [lines]);

  return <BasketContext.Provider value={value}>{children}</BasketContext.Provider>;
}

/**
 * The basket, for a component inside the provider.
 *
 * Throws rather than returning null: a card or a room row rendered outside the provider would
 * silently never update, which looks like a broken button and is a wiring mistake.
 */
export function useBookingSelection(): Basket {
  const value = useContext(BasketContext);

  if (!value) {
    throw new Error('useBookingSelection must be used inside BookingSelectionProvider.');
  }

  return value;
}
