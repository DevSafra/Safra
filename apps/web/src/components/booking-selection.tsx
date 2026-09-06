'use client';

import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';

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
  readonly roomLineLabel: string;
  readonly roomLineAmount: string;
  readonly feeAmount: string;
  readonly total: string;
  readonly checkIn: string;
  readonly checkOut: string;
  readonly nightsText: string;
  readonly policyText: string;
}

interface Selection {
  readonly chosen: ChosenRoom | null;
  readonly choose: (room: ChosenRoom) => void;
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

  const value = useMemo<Selection>(
    () => ({ chosen, choose: setChosen, clear: () => setChosen(null) }),
    [chosen],
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
