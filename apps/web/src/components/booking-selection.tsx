'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

/**
 * One quantity's worth of money, pre-formatted.
 *
 * Every figure a guest reads is currency-converted and ICU-pluralised, and both of those need the
 * server. So rather than shipping a formatter to the browser to multiply a total by a room count,
 * the server prices EVERY quantity the guest could pick — at most ten, and usually two or three —
 * and the stepper indexes into them. Nothing is computed client-side, so nothing can round
 * differently from what checkout will charge.
 */
export interface RoomPrice {
  readonly roomLineLabel: string;
  readonly roomLineAmount: string;
  readonly feeAmount: string;
  readonly total: string;
  /**
   * The same total as a plain number, for anything READING the card rather than looking at it.
   *
   * The rendered figure is Arabic-Indic digits inside a currency format, and parsing that back is
   * how an assertion comes to agree with a screen that is wrong — the reasoning `data-figure-value`
   * records on the treasury tiles, which this follows.
   */
  readonly totalValue: number;
  /** «حتى ٨ ضيوف» across the whole booking — two rooms sleeping four each sleep eight. */
  readonly capacityText: string;
}

/** What the guest has chosen, and everything the summary needs to describe it. */
export interface ChosenRoom {
  readonly unitId: string;
  readonly name: string;
  readonly maxGuests: number;
  readonly minNights: number;
  /** «حتى ٤ ضيوف» — what the ROOM sleeps, which is a different fact from the party booking it. */
  readonly capacityText: string;
  /** Already resolved to words by the server; a client component cannot be handed a resolver. */
  readonly amenityNames: readonly string[];
  /**
   * A breakdown that ADDS UP.
   *
   * The row's headline price is fee-inclusive by convention — a flat fee is per BOOKING, so a
   * per-night «from» figure carries the whole of it, which is exact for the one night it is a floor
   * for. That convention is fine on a row and wrong in a summary: printing «السعر لليلة ١٨٦٫٩٩»
   * above «المجموع ٣٧١٫٩٩» invites a guest to multiply and get 373.98. A booking summary is the
   * one place a reader checks the arithmetic, so it shows the room, the fee and the total as three
   * lines that reconcile.
   */
  readonly prices: readonly RoomPrice[];
  /** How many of this type are free for these nights — the ceiling on the stepper. */
  readonly maxRooms: number;
  /** ISO, for the checkout link — the machine's copy. */
  readonly checkIn: string;
  readonly checkOut: string;
  /** «الأحد 5 أكتوبر», for the reader. Two renderings of one fact, and both are needed. */
  readonly checkInText: string;
  readonly checkOutText: string;
  readonly nightsText: string;
  readonly policyText: string;
}

interface Selection {
  readonly chosen: ChosenRoom | null;
  /** How many rooms of the chosen type, always between 1 and `chosen.maxRooms`. */
  readonly rooms: number;
  readonly choose: (room: ChosenRoom) => void;
  readonly setRooms: (next: number) => void;
  readonly clear: () => void;
}

const SelectionContext = createContext<Selection | null>(null);

/**
 * The property page's booking state, held in one place.
 *
 * ## Why a context rather than props
 *
 * The room list and the summary card are on opposite sides of the page and inside different server
 * subtrees — the list is in the main column, the card is in the aside. A choice made in one has to
 * appear in the other immediately, which is the whole of Bashar's requirement: *"the selected unit
 * must immediately appear inside the left booking card"*. Threading a setter through the server
 * component between them is not possible; a client boundary around both is.
 *
 * ## It holds the WHOLE room, not an id
 *
 * The summary states occupancy, minimum stay, facilities, a nightly rate and a stay total. Holding
 * only an id would mean the card looking each of those up again — a second source for figures the
 * row has already computed with the fee applied and the currency converted, and two places deriving
 * one price is how they come to disagree. The row hands over what it displayed.
 */
export function BookingSelectionProvider({ children }: { readonly children: ReactNode }) {
  const [chosen, setChosen] = useState<ChosenRoom | null>(null);
  const [rooms, setRoomsRaw] = useState(1);

  const value = useMemo<Selection>(
    () => ({
      chosen,
      rooms,
      /*
        Choosing a room RESETS the quantity.

        A guest who took three of a standard room and then switched to the suite has not asked for
        three suites — and the suite may not have three. Carrying the number across would either
        quote a stay they did not ask for or exceed what the hotel has, and both are worse than
        starting the new choice at one.
      */
      choose: (room: ChosenRoom) => {
        setChosen(room);
        setRoomsRaw(1);
      },
      /* Clamped here rather than at the control, so no caller can put the card out of range. */
      setRooms: (next: number) =>
        setRoomsRaw(Math.min(Math.max(1, next), chosen?.maxRooms ?? 1)),
      clear: () => {
        setChosen(null);
        setRoomsRaw(1);
      },
    }),
    [chosen, rooms],
  );

  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

/**
 * The selection, for a component inside the provider.
 *
 * Throws rather than returning null: a card or a room row rendered outside the provider would
 * silently never update, which looks like a broken button and is a wiring mistake.
 */
export function useBookingSelection(): Selection {
  const value = useContext(SelectionContext);

  if (!value) {
    throw new Error('useBookingSelection must be used inside BookingSelectionProvider.');
  }

  return value;
}
